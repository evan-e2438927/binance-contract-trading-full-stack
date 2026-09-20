import { type Fixed, type MarginMode, mul, type PositionSide } from "@binance-contract-trading-full-stack/shared";

import { notional, unrealizedPnl } from "./formulas";
import { liquidationPrice } from "./liquidation";
import { addToPosition } from "./position";
import { crossWalletBalance, positionMaintMargin } from "./risk";
import { requireSymbol, settingOf, sortedPositions, type EngineState } from "./state";
import type { Account, Position, SymbolSpec } from "./types";
import { accountAvailable, limitOpenCost, maxNotionalFor, pendingOpenNotional } from "./validate-order";

/**
 * 下单面板要的两样只读视图（前端 M07）：
 *
 * 1. `symbolConfigView`：这个币对当前的杠杆和保证金模式。没有持仓时仓位列表里读不到它们
 *    （对应币安 `GET /fapi/v1/symbolConfig`）。
 * 2. `previewOrder`：还没下单时的预估——开仓成本、可开最大数量、成交后的强平价。
 *
 * 为什么放引擎里：强平价、可用余额、分层表必须和风控、校验链用同一套公式和同一份数据，
 * 服务端或前端另算一遍迟早漂移（views.ts 开头那段同理）。
 *
 * **算不出来就给 null 并在 warnings 里说原因**，不拿 0 或估计值顶替。
 */

export interface SymbolConfigView {
  symbol: string;
  leverageNum: number;
  marginMode: MarginMode;
  /** 该币对分层表第 1 层允许的最大杠杆 */
  maxLeverageNum: number;
  /** 当前杠杆下允许的最大名义价值（缺口 #44，和 POST /positions/leverage 返回的同义） */
  maxNotional: Fixed;
}

export function symbolConfigView(state: EngineState, accountId: string, symbol: string): SymbolConfigView | null {
  if (!state.accounts.has(accountId)) return null;
  requireSymbol(state, symbol);
  const brackets = state.brackets.get(symbol)!;
  const setting = settingOf(state, accountId, symbol);
  return {
    symbol,
    leverageNum: setting.leverageNum,
    marginMode: setting.marginMode,
    maxLeverageNum: brackets[0]!.maxLeverageNum,
    maxNotional: maxNotionalFor(brackets, setting.leverageNum),
  };
}

export interface PreviewInput {
  accountId: string;
  symbol: string;
  side: "BUY" | "SELL";
  /** 单向模式传 BOTH；双向模式按开平表传 LONG / SHORT */
  positionSide: PositionSide;
  /** 限价类传委托价；市价类传 null，用标记价估 */
  price: Fixed | null;
  /** 不传就只回 maxQty，不算成本和强平价 */
  qty: Fixed | null;
}

export interface PreviewView {
  symbol: string;
  leverageNum: number;
  marginMode: MarginMode;
  /** 估算用的价格：限价用委托价，市价用标记价 */
  price: Fixed | null;
  /** 开仓成本 = 起始保证金 + 开仓亏损 + 预留 Taker 手续费，和校验链第 ⑩ 步同一个函数 */
  cost: Fixed | null;
  /** 可用余额、分层上限、币对数量上限允许的最大开仓数量，已对齐 LOT_SIZE */
  maxQty: Fixed | null;
  /** 这一单成交后的强平价；算不出来为 null */
  liquidationPrice: Fixed | null;
  /** 某一项算不出来的原因，前端可以原样显示 */
  warnings: string[];
}

/** 引擎内部按 LONG / SHORT 存仓位；单向模式下 BUY 开的就是 LONG */
function directionOf(side: "BUY" | "SELL", positionSide: PositionSide): "LONG" | "SHORT" {
  if (positionSide === "BOTH") return side === "BUY" ? "LONG" : "SHORT";
  return positionSide;
}

/** 合法数量：minQty + k × stepSize（校验链第 5 步的 LOT_SIZE 口径），向下取 */
export function floorToLot(qty: Fixed, lot: { minQty: Fixed; stepSize: Fixed }): Fixed {
  if (qty < lot.minQty) return 0n;
  return lot.minQty + ((qty - lot.minQty) / lot.stepSize) * lot.stepSize;
}

export function previewOrder(state: EngineState, input: PreviewInput): PreviewView {
  const warnings: string[] = [];
  const spec = requireSymbol(state, input.symbol);
  const setting = settingOf(state, input.accountId, input.symbol);
  const base: PreviewView = {
    symbol: input.symbol,
    leverageNum: setting.leverageNum,
    marginMode: setting.marginMode,
    price: null,
    cost: null,
    maxQty: null,
    liquidationPrice: null,
    warnings,
  };

  const account = state.accounts.get(input.accountId);
  if (!account) {
    warnings.push("账户不存在");
    return base;
  }

  const markPrice = state.marks.get(input.symbol)?.markPrice;
  if (markPrice === undefined) {
    warnings.push(`${input.symbol} 还没有标记价，估不出成本和强平价`);
    return base;
  }
  const price = input.price ?? markPrice;

  const available = accountAvailable(state, account);
  if (typeof available === "string") {
    warnings.push(`缺少 ${available} 的标记价，暂时算不出可用余额`);
    return { ...base, price };
  }

  const direction = directionOf(input.side, input.positionSide);
  const positions = sortedPositions(state, (p) => p.accountId === account.id && p.qty > 0n);
  const held = positions.find((p) => p.symbol === input.symbol && p.positionSide === direction) ?? null;
  const opposite = positions.find((p) => p.symbol === input.symbol && p.positionSide !== direction) ?? null;
  // 单向模式：手上是反方向仓位时，这一单先平后开，成本口径不一样，不在这里估
  const closing = input.positionSide === "BOTH" ? held === null && opposite !== null : false;

  const maxQty = maxOpenQty({ state, account, spec, price, markPrice, leverageNum: setting.leverageNum, available, direction, held });
  const withMax = { ...base, price, maxQty };

  if (input.qty === null || input.qty <= 0n) return withMax;
  if (closing) {
    warnings.push("这一单是平仓方向，不估算开仓成本和强平价");
    return withMax;
  }

  const cost = limitOpenCost({
    openSide: direction,
    qty: input.qty,
    price,
    markPrice,
    lastPrice: state.lastPrices.get(input.symbol),
    leverageNum: setting.leverageNum,
    takerFeeRate: state.config.fees.takerFeeRate,
  }).total;

  return {
    ...withMax,
    cost,
    liquidationPrice: previewLiquidationPrice({
      state,
      accountId: account.id,
      symbol: input.symbol,
      marginMode: setting.marginMode,
      direction,
      qty: input.qty,
      price,
      cost,
      held,
      positions,
    }),
  };
}

/**
 * 可开最大数量：可用余额、分层上限、币对数量上限三个约束取小，再对齐 LOT_SIZE。
 *
 * 先按「每份成本 ≈ 价格 ÷ 杠杆 + 价格 × Taker 费率」估个上界，再用校验链那个成本函数逐档往下校，
 * 直到成本真的落在可用余额内。这样显示出来的数量一定下得进去，不会点下去被"可用余额不足"拒掉。
 */
function maxOpenQty(args: {
  state: EngineState;
  account: Account;
  spec: SymbolSpec;
  price: Fixed;
  markPrice: Fixed;
  leverageNum: number;
  available: Fixed;
  direction: "LONG" | "SHORT";
  held: Readonly<Position> | null;
}): Fixed {
  const { state, account, spec, price, markPrice, leverageNum, available, direction, held } = args;
  if (price <= 0n || available <= 0n) return 0n;
  const takerFeeRate = state.config.fees.takerFeeRate;

  // 每份成本，除法向上取整：宁可少估一点，也不要多给一份下不进去的数量
  const perQty = (price + BigInt(leverageNum) - 1n) / BigInt(leverageNum) + mul(price, takerFeeRate) + 1n;
  let qty = floorToLot((available * 100_000_000n) / perQty, spec);

  // 分层上限：成交后这个方向的名义价值不能超过当前杠杆所在档位的上限（缺口 #44）
  const brackets = state.brackets.get(spec.symbol)!;
  const used = (held ? notional(held.qty, markPrice) : 0n) + pendingOpenNotional(state, account, spec.symbol, direction);
  const room = maxNotionalFor(brackets, leverageNum) - used;
  if (room <= 0n) return 0n;
  const byCap = floorToLot((room * 100_000_000n) / price, spec);
  if (byCap < qty) qty = byCap;
  if (qty > spec.maxQty) qty = floorToLot(spec.maxQty, spec);

  // 估算里的舍入可能让最后一档差一点点，用真正的成本函数校
  while (qty >= spec.minQty) {
    const cost = limitOpenCost({
      openSide: direction,
      qty,
      price,
      markPrice,
      lastPrice: state.lastPrices.get(spec.symbol),
      leverageNum,
      takerFeeRate,
    }).total;
    if (cost <= available) return qty;
    qty -= spec.stepSize;
  }
  return 0n;
}

/** 成交后的强平价：把这一单并进现有仓位，再走和仓位视图同一个公式 */
function previewLiquidationPrice(args: {
  state: EngineState;
  accountId: string;
  symbol: string;
  marginMode: MarginMode;
  direction: "LONG" | "SHORT";
  qty: Fixed;
  price: Fixed;
  cost: Fixed;
  held: Readonly<Position> | null;
  positions: readonly Readonly<Position>[];
}): Fixed | null {
  const { state, accountId, symbol, marginMode, direction, qty, price, cost, held, positions } = args;
  const brackets = state.brackets.get(symbol)!;
  const merged = held ? addToPosition(held.qty, held.entryPrice, qty, price) : { qty, entryPrice: price };
  const leg = { side: direction, qty: merged.qty, entryPrice: merged.entryPrice };

  if (marginMode === "ISOLATED") {
    // 逐仓：这个仓位自己扛，保证金 = 原有逐仓保证金 + 这一单占用的成本
    return liquidationPrice({
      walletBalance: (held?.isolatedMargin ?? 0n) + cost,
      otherMaintMarginSum: 0n,
      otherUnrealizedPnlSum: 0n,
      legs: [leg],
      brackets,
    });
  }

  let otherMaint = 0n;
  let otherPnl = 0n;
  const legs = [leg];
  for (const p of positions) {
    if (p.marginMode !== "CROSS") continue;
    if (p.symbol === symbol) {
      // 本币对：同方向的已经并进 leg 了，反方向的（双向模式）原样带上
      if (p.positionSide !== direction) {
        legs.push({ side: p.positionSide as "LONG" | "SHORT", qty: p.qty, entryPrice: p.entryPrice });
      }
      continue;
    }
    const mark = state.marks.get(p.symbol)?.markPrice;
    if (mark === undefined) return null;
    otherMaint += positionMaintMargin(state, p, mark);
    otherPnl += unrealizedPnl(p, mark);
  }
  return liquidationPrice({
    walletBalance: crossWalletBalance(state, accountId),
    otherMaintMarginSum: otherMaint,
    otherUnrealizedPnlSum: otherPnl,
    legs,
    brackets,
  });
}
