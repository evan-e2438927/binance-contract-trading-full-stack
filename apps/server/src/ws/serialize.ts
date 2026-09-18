import type { Fill, FundingPayment, LiquidationRecord, Position } from "@binance-contract-trading-full-stack/engine";
import type { PositionMode } from "@binance-contract-trading-full-stack/shared";
import { toDecimal } from "../http/decimal";
import { toDbId } from "../persistence/ids";
import { toDbPosition, toDbPositionSide } from "../persistence/positions";

/**
 * 引擎事件 → 推送载荷。形状和 REST 一致（`api/serialize.ts`）：同一个对象前端只写一套解析。
 * 引擎里的 id 是确定性字符串，这里和落库一样换算成 uuid（`persistence/ids.ts`），前端拿到的 id 和 REST 查到的是同一个。
 */

export function fillPayload(mode: PositionMode, fill: Fill) {
  return {
    id: toDbId(fill.id),
    orderId: toDbId(fill.orderId),
    symbol: fill.symbol,
    side: fill.side,
    positionSide: toDbPositionSide(mode, fill.positionSide),
    price: toDecimal(fill.price),
    qty: toDecimal(fill.qty),
    role: fill.role,
    fee: toDecimal(fill.fee),
    realizedPnl: toDecimal(fill.realizedPnl),
    isLiquidation: fill.isLiquidation,
    createdAt: fill.ts,
  };
}

export function liquidationPayload(mode: PositionMode, record: LiquidationRecord) {
  return {
    id: toDbId(record.id),
    symbol: record.symbol,
    positionSide: toDbPositionSide(mode, record.positionSide),
    marginMode: record.marginMode,
    qty: toDecimal(record.qty),
    entryPrice: toDecimal(record.entryPrice),
    markPrice: toDecimal(record.markPrice),
    realizedPnl: toDecimal(record.realizedPnl),
    liquidationFee: toDecimal(record.liquidationFee),
    marginBalanceBefore: toDecimal(record.marginBalanceBefore),
    maintMarginAt: toDecimal(record.maintMarginAt),
    createdAt: record.ts,
  };
}

export function fundingPayload(mode: PositionMode, payment: FundingPayment) {
  return {
    id: toDbId(payment.id),
    symbol: payment.symbol,
    positionSide: toDbPositionSide(mode, payment.positionSide),
    fundingRate: toDecimal(payment.fundingRate),
    markPrice: toDecimal(payment.markPrice),
    notional: toDecimal(payment.notional),
    amount: toDecimal(payment.amount),
    settledAt: payment.ts,
  };
}

/** 仓位平掉之后引擎不再有这个仓位，视图里也查不到——推一条数量为 0 的，前端才知道该把它从列表里去掉 */
export function closedPositionPayload(mode: PositionMode, position: Position) {
  const { positionSide } = toDbPosition(mode, position.positionSide, 0n);
  return {
    symbol: position.symbol,
    positionSide,
    positionAmt: "0",
    marginMode: position.marginMode,
    leverage: position.leverageNum,
    entryPrice: toDecimal(position.entryPrice),
    markPrice: null,
    notional: null,
    unrealizedPnl: null,
    initialMargin: null,
    maintMargin: null,
    isolatedMargin: "0",
    liquidationPrice: null,
    roe: null,
    openedAt: position.openedAt,
    updatedAt: position.updatedAt,
  };
}
