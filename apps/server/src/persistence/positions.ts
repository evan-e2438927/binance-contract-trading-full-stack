import type { Fixed, PositionMode, PositionSide } from "@binance-contract-trading-full-stack/shared";

/**
 * 仓位的两种表示法互转（设计缺口 #12）：
 *
 * | | 引擎（04-backend-design.md 第 3 节） | 数据库（币安 positionRisk） |
 * | --- | --- | --- |
 * | 单向模式 | LONG 或 SHORT，数量非负 | 一行 BOTH，position_amt 多正空负 |
 * | 双向模式 | LONG / SHORT，数量非负 | LONG 行为正，SHORT 行为负 |
 *
 * 转换需要知道账户的持仓模式——单向模式的 LONG 和双向模式的 LONG 落到数据库里是不同的行。
 */

export interface DbPositionKey {
  positionSide: PositionSide;
  positionAmt: Fixed;
}

export function toDbPosition(mode: PositionMode, side: PositionSide, qty: Fixed): DbPositionKey {
  if (side === "BOTH") throw new Error("引擎里的仓位不应该是 BOTH（缺口 #12：引擎内部按实际方向存）");
  if (qty < 0n) throw new Error(`引擎仓位数量不能为负：${qty}`);
  const signed = side === "SHORT" ? -qty : qty;
  return { positionSide: mode === "ONE_WAY" ? "BOTH" : side, positionAmt: signed };
}

export function fromDbPosition(
  mode: PositionMode,
  row: DbPositionKey,
): { positionSide: "LONG" | "SHORT"; qty: Fixed } {
  const { positionSide, positionAmt } = row;
  if (positionAmt === 0n) throw new Error("数量为 0 的仓位行不该加载进引擎");
  const direction = positionAmt > 0n ? "LONG" : "SHORT";
  const qty = positionAmt > 0n ? positionAmt : -positionAmt;
  if (mode === "ONE_WAY") {
    if (positionSide !== "BOTH") throw new Error(`单向持仓模式的账户有 ${positionSide} 仓位行，数据不一致`);
    return { positionSide: direction, qty };
  }
  if (positionSide !== direction) {
    throw new Error(`双向持仓模式的 ${positionSide} 仓位行数量符号不对：${positionAmt}`);
  }
  return { positionSide: direction, qty };
}

/** 资金费、强平记录里的 positionSide：单向模式记 BOTH，和 positions 表同一套 */
export function toDbPositionSide(mode: PositionMode, side: PositionSide): PositionSide {
  return mode === "ONE_WAY" ? "BOTH" : side;
}
