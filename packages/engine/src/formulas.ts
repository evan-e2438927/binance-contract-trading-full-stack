import {
  SCALE,
  divRound,
  mul,
  mulCeil,
  mulRound,
  type Fixed,
} from "@binance-contract-trading-full-stack/shared";
import type { FeeConfig, Position } from "./types";

/**
 * 04-backend-design.md 第 4 节全部公式。每个函数只做一步计算，不碰 EngineState——
 * "这个账户有哪些仓位/挂单""某个币对现在的标记价是多少"这类查找由调用方（后面几讲的
 * apply.ts）负责，传结果进来。这样每条公式都能脱离引擎状态单独测试。
 *
 * 舍入规则（02-architecture.md 第五节）：
 * - 手续费：向上取整（mulCeil）——摩擦成本不被低估
 * - 已实现盈亏：向下截断（mul 的默认行为）——保守
 * - 未实现盈亏 / 保证金：四舍五入（mulRound / divRound）——展示类数值，居中处理
 * 公式里没有点名要舍入的中间步骤（比如 notional、frozenMargin 里的起始保证金部分）
 * 一律用截断的 mul/div，只在公式的"最终产出值"上按上面的表选舍入方式。
 */

// ─────────────────────────────────────────────────────────────
// 4.1 基础
// ─────────────────────────────────────────────────────────────

/** 名义价值 = 数量 × 价格。 */
export function notional(qty: Fixed, price: Fixed): Fixed {
  return mul(qty, price);
}

/** 起始保证金 = 名义价值 ÷ 杠杆。leverageNum 是普通整数（未定标），四舍五入到 8 位。 */
export function initialMargin(qty: Fixed, price: Fixed, leverageNum: number): Fixed {
  if (leverageNum <= 0) throw new Error(`leverageNum 必须是正整数，收到 ${leverageNum}`);
  return divRound(notional(qty, price), BigInt(leverageNum) * SCALE);
}

/**
 * 未实现盈亏。方向由 positionSide 决定：多头是"现价 − 开仓价"，空头相反。
 * BOTH（单向模式）按多头公式算——单向模式下 qty 本身已经隐含了方向语义，
 * 调用方要在喂进来之前把 BOTH 的仓位按它实际持有的方向处理（这是仓位对象自己知道的事，
 * 不是这个纯函数该管的）。
 */
export function unrealizedPnl(
  position: Pick<Position, "positionSide" | "qty" | "entryPrice">,
  markPrice: Fixed,
): Fixed {
  const diff =
    position.positionSide === "SHORT"
      ? position.entryPrice - markPrice
      : markPrice - position.entryPrice;
  return mulRound(diff, position.qty);
}

/** 保证金余额 = 钱包余额 + 全部仓位未实现盈亏之和（正负都算，逐仓/全仓都算）。 */
export function marginBalance(walletBalance: Fixed, unrealizedPnlSum: Fixed): Fixed {
  return walletBalance + unrealizedPnlSum;
}

// ─────────────────────────────────────────────────────────────
// 4.2 可用余额
// ─────────────────────────────────────────────────────────────

export interface AvailableBalanceInput {
  walletBalance: Fixed;
  /** Σ 全仓仓位的未实现盈亏（正负都算）。逐仓仓位的浮盈不计入——钱已经锁在那个仓位里了。 */
  crossUnrealizedPnlSum: Fixed;
  /** Σ 全仓仓位的起始保证金（按当前 qty/entryPrice/leverageNum 重新算，不是存出来的字段）。 */
  crossInitialMarginSum: Fixed;
  /** Σ 逐仓仓位的 isolatedMargin。 */
  isolatedMarginSum: Fixed;
  /** Σ 挂单冻结保证金（只减仓/全部平仓单恒为 0，已经体现在每张单自己的 frozenMargin 里）。 */
  frozenMarginSum: Fixed;
}

/**
 * 可用余额——04-backend-design.md 4.2 节点名"最容易算错的一个"：
 * 钱包余额 + 全仓浮盈浮亏 − 全仓起始保证金 − 逐仓保证金 − 挂单冻结保证金。
 */
export function availableBalance(input: AvailableBalanceInput): Fixed {
  return (
    input.walletBalance +
    input.crossUnrealizedPnlSum -
    input.crossInitialMarginSum -
    input.isolatedMarginSum -
    input.frozenMarginSum
  );
}

// ─────────────────────────────────────────────────────────────
// 4.3 挂单冻结保证金
// ─────────────────────────────────────────────────────────────

export interface FrozenMarginInput {
  reduceOnly: boolean;
  closePosition: boolean;
  qty: Fixed;
  /** 市价单没有 price，调用方要先把参考价（如标记价）代进来。 */
  price: Fixed;
  leverageNum: number;
}

/**
 * 挂单冻结保证金 = 起始保证金 + 按 Taker 费率预留的手续费（向上取整，按最坏情况留够）。
 * 只减仓 / 全部平仓单不冻结保证金——它们只会释放保证金，不会开新仓。
 */
export function frozenMargin(order: FrozenMarginInput, takerFeeRate: Fixed): Fixed {
  if (order.reduceOnly || order.closePosition) return 0n;
  const n = notional(order.qty, order.price);
  return initialMargin(order.qty, order.price, order.leverageNum) + mulCeil(n, takerFeeRate);
}

// ─────────────────────────────────────────────────────────────
// 4.7 资金费
// ─────────────────────────────────────────────────────────────

/**
 * 资金费。费率为正：多头付出（返回负数，扣钱包），空头收到（返回正数，加钱包）。
 * 04-backend-design.md 没有点名这一步的舍入方式，按公式里 `×` 的默认约定截断——
 * 和"手续费按最坏情况预留""已实现盈亏截断"同一种保守方向，不会让用户多收一分钱。
 */
export function fundingFee(
  position: Pick<Position, "positionSide" | "qty">,
  fundingRate: Fixed,
  markPrice: Fixed,
): Fixed {
  const amount = mul(notional(position.qty, markPrice), fundingRate);
  return position.positionSide === "SHORT" ? amount : -amount;
}

// ─────────────────────────────────────────────────────────────
// 4.8 手续费
// ─────────────────────────────────────────────────────────────

/** 成交手续费，按角色取费率，向上取整到 8 位——和币安一致，摩擦成本不被低估。 */
export function fee(
  fillQty: Fixed,
  fillPrice: Fixed,
  role: "MAKER" | "TAKER",
  feeConfig: Pick<FeeConfig, "makerFeeRate" | "takerFeeRate">,
): Fixed {
  const rate = role === "MAKER" ? feeConfig.makerFeeRate : feeConfig.takerFeeRate;
  return mulCeil(notional(fillQty, fillPrice), rate);
}
