import {
  SCALE,
  divRound,
  mul,
  mulRound,
  type Fixed,
  type MarginMode,
  type PositionSide,
} from "@binance-contract-trading-full-stack/shared";
import type { LeverageBracket } from "./types";

/**
 * 04-backend-design.md 4.5/4.6 节：杠杆分层查找、维持保证金、保证金率、强平价。
 * 和 formulas.ts 一样不碰 EngineState——分层表、其他仓位的 TMM/UPNL 汇总，全部由调用方
 * （第 07 讲的风控扫描）算好传进来。
 */

/**
 * 按名义价值找所在层。brackets 必须已按 notionalCap 升序排好——state.ts 的 createState
 * 在装载配置时就排过序，这里不重复排序，重复排是浪费（这是热路径：每次标记价更新都要跑）。
 * notional 超出最后一层上限时兜底用最后一层，不抛错——调用方（第 04 讲下单校验链）
 * 应该在这之前就已经按"跨层杠杆超限拒单"的规则挡掉了，走到这里说明已经在最后一层里。
 */
export function findBracket(brackets: readonly LeverageBracket[], notionalValue: Fixed): LeverageBracket {
  if (brackets.length === 0) throw new Error("空的杠杆分层表，findBracket 无法工作");
  for (const bracket of brackets) {
    if (notionalValue <= bracket.notionalCap) return bracket;
  }
  return brackets[brackets.length - 1]!;
}

/**
 * 维持保证金 = 名义价值 × 维持保证金率 − 速算额。
 * 算例（BTCUSDT）：40,000 一层 160；50,000 边界两层都算出 200；200,000 二层 950；
 * 1,000,000 三层 6,950——见 01-domain-knowledge.md 第五节，种子脚本用同一条公式校验分层表连续性。
 */
export function maintMargin(notionalValue: Fixed, bracket: Pick<LeverageBracket, "mmr" | "cum">): Fixed {
  return mulRound(notionalValue, bracket.mmr) - bracket.cum;
}

/**
 * 保证金率 = 维持保证金总额 ÷ 保证金余额，达到 100%（= SCALE）触发强平。
 * marginBalance ≤ 0（已经穿仓）时直接返回 SCALE：此时无论维持保证金是多少都已经该强平，
 * 用真实除法会除以非正数甚至除以零，不如直接给一个"确定 ≥ 100%"的哨兵值。
 */
export function marginRatio(maintMarginSum: Fixed, marginBalanceValue: Fixed): Fixed {
  if (marginBalanceValue <= 0n) return SCALE;
  return divRound(maintMarginSum, marginBalanceValue);
}

export interface LiquidationPriceInput {
  positionSide: PositionSide; // 调用前把 BOTH 按仓位实际方向解析成 LONG/SHORT
  marginMode: MarginMode;
  qty: Fixed;
  entryPrice: Fixed;
  /** 仅 ISOLATED 用：这个仓位自己的逐仓保证金。 */
  isolatedMargin: Fixed;
  /** 仅 CROSS 用：账户钱包余额。 */
  walletBalance: Fixed;
  /** 仅 CROSS 用：除本仓位外，其余全仓仓位的维持保证金之和（TMM₁）。 */
  otherCrossMaintMarginSum: Fixed;
  /** 仅 CROSS 用：除本仓位外，其余全仓仓位的未实现盈亏之和（UPNL₁）。 */
  otherCrossUnrealizedPnlSum: Fixed;
  /** 本仓位名义价值所在的分层。 */
  bracket: Pick<LeverageBracket, "mmr" | "cum">;
}

/**
 * 强平价——币安通用公式，01-domain-knowledge.md 第六节推导过，三个算例都验过反算：
 *
 *   强平价 = (WB − TMM₁ + UPNL₁ + cumB − cumL − Side₁×Pos₁×EP₁) ÷ (Pos₁×MMR₁ − Side₁×Pos₁)
 *
 * ⚠️ 设计缺口 #5 的结论：**不对齐 tickSize**。4.6 节伪代码里写了 alignPrice(...)，
 * 但算例 A 的强平价 45,180.72 本身就不是 0.1（典型 tickSize）的整数倍——强平价是一个纯粹的
 * 计算阈值，不是要挂到盘口上的委托价，不需要对齐任何交易所的价格粒度。这里只在最终一步
 * 用 divRound 四舍五入到 8 位（02-architecture.md 舍入表："强平价……四舍五入到 8 位"），
 * 公式中间的每一项乘法都用默认截断的 mul——多步都四舍五入只会累积误差，不会更准。
 */
export function liquidationPrice(input: LiquidationPriceInput): Fixed {
  const isShort = input.positionSide === "SHORT";
  const isIsolated = input.marginMode === "ISOLATED";

  const WB = isIsolated ? input.isolatedMargin : input.walletBalance;
  const TMM = isIsolated ? 0n : input.otherCrossMaintMarginSum;
  const UPNL = isIsolated ? 0n : input.otherCrossUnrealizedPnlSum;
  const cumB = isIsolated ? input.bracket.cum : 0n;
  const cumL = isIsolated ? 0n : input.bracket.cum;

  // Side₁ × Pos₁ × EP₁：用符号分支代替真的去乘一个 ±1，省掉一次没有意义的 Fixed 乘法
  const sideTerm = mul(input.qty, input.entryPrice);
  const numerator = WB - TMM + UPNL + cumB - cumL - (isShort ? -sideTerm : sideTerm);

  // Pos₁ × MMR₁ − Side₁ × Pos₁
  const mmrTerm = mul(input.qty, input.bracket.mmr);
  const denominator = mmrTerm - (isShort ? -input.qty : input.qty);

  if (denominator === 0n) {
    throw new Error("强平价分母为 0：说明分层 mmr 和仓位方向凑巧抵消，检查分层表或调用参数");
  }
  return divRound(numerator, denominator);
}
