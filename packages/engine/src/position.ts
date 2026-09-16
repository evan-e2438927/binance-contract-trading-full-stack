import { divRound, mul, type Fixed } from "@binance-contract-trading-full-stack/shared";
import type { PositionSide } from "@binance-contract-trading-full-stack/shared";

/**
 * 04-backend-design.md 4.4 节：仓位变更的三种算法。这几个函数只算数，不碰 EngineState、
 * 不决定"这笔成交到底是加仓还是减仓还是反手"——那是订单簿/撮合逻辑的事（第 05 讲），
 * 这一讲只保证"给定已经分类好的场景，数字算对"。
 */

// ─────────────────────────────────────────────────────────────
// 开仓 / 加仓（同方向）
// ─────────────────────────────────────────────────────────────

export interface AddResult {
  qty: Fixed;
  entryPrice: Fixed;
}

/**
 * 加权平均开仓价。算例：1 BTC @ 50,000 再买 1 BTC @ 52,000 → 2 BTC @ 51,000。
 * 均价不在 02-architecture.md 的舍入表里点名，按"展示类数值"处理，四舍五入到 8 位。
 */
export function addToPosition(
  currentQty: Fixed,
  currentEntryPrice: Fixed,
  fillQty: Fixed,
  fillPrice: Fixed,
): AddResult {
  const newQty = currentQty + fillQty;
  if (newQty <= 0n) throw new Error(`加仓后数量必须为正，收到 ${newQty}`);
  const costSum = mul(currentEntryPrice, currentQty) + mul(fillPrice, fillQty);
  return { qty: newQty, entryPrice: divRound(costSum, newQty) };
}

// ─────────────────────────────────────────────────────────────
// 减仓 / 平仓（反方向，不超过现有仓位）—— 均价不变
// ─────────────────────────────────────────────────────────────

export interface ReduceResult {
  qty: Fixed;
  /** 已实现盈亏，向下截断（保守，和手续费的"向上"相反方向）。 */
  realizedPnl: Fixed;
  /** 逐仓仓位按平仓比例释放的保证金；全仓仓位传 0n 进来时结果恒为 0n。 */
  releasedMargin: Fixed;
}

/**
 * 减仓。closeQty 必须 ≤ currentQty——反手（超过现有仓位）不归这个函数管，见 splitReverseFill。
 * 算例：2 BTC @ 51,000 卖 1 BTC @ 53,000 → 已实现 +2,000，剩 1 BTC 均价仍 51,000。
 */
export function reducePosition(
  positionSide: PositionSide,
  currentQty: Fixed,
  entryPrice: Fixed,
  currentIsolatedMargin: Fixed,
  closeQty: Fixed,
  fillPrice: Fixed,
): ReduceResult {
  if (closeQty <= 0n || closeQty > currentQty) {
    throw new Error(`closeQty 必须在 (0, currentQty] 区间内，收到 ${closeQty}，currentQty=${currentQty}`);
  }
  const diff = positionSide === "SHORT" ? entryPrice - fillPrice : fillPrice - entryPrice;
  const realizedPnl = mul(diff, closeQty);
  // 逐仓保证金按平仓比例释放：closeQty 用完整仓位平掉时，released 正好等于 currentIsolatedMargin，
  // 不会因为除法截断在"全平"这个最常见的场景里漏掉几分钱。
  const releasedMargin =
    closeQty === currentQty
      ? currentIsolatedMargin
      : divRound(mul(currentIsolatedMargin, closeQty), currentQty);
  return { qty: currentQty - closeQty, realizedPnl, releasedMargin };
}

// ─────────────────────────────────────────────────────────────
// 反手（仅单向模式）：成交量超过现有仓位
// ─────────────────────────────────────────────────────────────

export interface ReverseSplit {
  /** 用来平掉现有仓位的数量，等于 currentQty——喂给 reducePosition。 */
  closeQty: Fixed;
  /** 平完之后剩下的数量，用来按成交价开一个反方向新仓位——喂给 addToPosition（currentQty 传 0）。 */
  openQty: Fixed;
}

/**
 * 拆分一笔"超过现有仓位"的成交：先算出平掉现有仓位的部分，剩下的部分开反方向新仓位。
 * 只在单向模式下调用——双向模式不存在反手，超出部分按 reduceOnly 语义直接拒单（第 04 讲）。
 */
export function splitReverseFill(currentQty: Fixed, fillQty: Fixed): ReverseSplit {
  if (fillQty <= currentQty) {
    throw new Error(
      `splitReverseFill 只用于成交量超过现有仓位的场景：fillQty=${fillQty} ≤ currentQty=${currentQty}`,
    );
  }
  return { closeQty: currentQty, openQty: fillQty - currentQty };
}
