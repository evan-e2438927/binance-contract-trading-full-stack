import type {
  Fill as FillRow,
  FundingPayment as FundingRow,
  LedgerEntry as LedgerRow,
  Liquidation as LiquidationRow,
  Order as OrderRow,
} from "@binance-contract-trading-full-stack/db";
import type { AccountView, Order, PositionView } from "@binance-contract-trading-full-stack/engine";
import type { PositionMode } from "@binance-contract-trading-full-stack/shared";
import { toDecimal, toDecimalOrNull } from "../http/decimal";
import type { Ticker24h } from "../market/binance-rest";
import { toDbId } from "../persistence/ids";
import { toDbPosition } from "../persistence/positions";

/**
 * 对外 JSON 的形状（04-backend-design.md 第 11 节）。数值一律字符串（http/decimal.ts），时间一律毫秒时间戳。
 * 引擎对象和数据库行各有一个映射函数，输出同一种形状——挂单来自引擎（排队位置是实时的），历史订单来自数据库。
 */

export function orderFromEngine(o: Order) {
  return {
    id: toDbId(o.id),
    clientOrderId: o.clientOrderId,
    symbol: o.symbol,
    side: o.side,
    positionSide: o.positionSide,
    type: o.type,
    timeInForce: o.timeInForce,
    price: toDecimalOrNull(o.price),
    stopPrice: toDecimalOrNull(o.stopPrice),
    workingType: o.workingType,
    qty: toDecimal(o.qty),
    executedQty: toDecimal(o.executedQty),
    avgPrice: toDecimal(o.avgPrice),
    reduceOnly: o.reduceOnly,
    closePosition: o.closePosition,
    status: o.status,
    triggered: o.triggered,
    // 设计文档："前方排队约 3.0 BTC"——这个模拟盘区别于玩具的地方，要让用户看见；queueEstimated 说明它是不是估算值
    queueAhead: toDecimal(o.queueAhead),
    queueEstimated: o.queueEstimated,
    frozenMargin: toDecimal(o.frozenMargin),
    rejectReason: o.rejectReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export type OrderJson = ReturnType<typeof orderFromEngine>;

export function orderFromDb(o: OrderRow): OrderJson {
  return {
    id: o.id,
    clientOrderId: o.clientOrderId,
    symbol: o.symbol,
    side: o.side,
    positionSide: o.positionSide,
    type: o.type,
    timeInForce: o.timeInForce,
    price: toDecimalOrNull(o.price),
    stopPrice: toDecimalOrNull(o.stopPrice),
    workingType: o.workingType,
    qty: toDecimal(o.qty),
    executedQty: toDecimal(o.executedQty),
    avgPrice: toDecimal(o.avgPrice),
    reduceOnly: o.reduceOnly,
    closePosition: o.closePosition,
    status: o.status,
    triggered: o.triggered,
    queueAhead: toDecimal(o.queueAhead),
    queueEstimated: o.queueEstimated,
    frozenMargin: toDecimal(o.frozenMargin),
    rejectReason: o.rejectReason,
    createdAt: o.createdAt.getTime(),
    updatedAt: o.updatedAt.getTime(),
  };
}

/**
 * 仓位按币安 positionRisk 表示法输出（缺口 #12 定的"REST 建议一致"）：
 * 单向模式 positionSide = BOTH、positionAmt 多正空负；双向模式 LONG 为正、SHORT 为负。
 */
export function positionJson(mode: PositionMode, p: PositionView) {
  const { positionSide, positionAmt } = toDbPosition(mode, p.positionSide, p.qty);
  return {
    symbol: p.symbol,
    positionSide,
    positionAmt: toDecimal(positionAmt),
    marginMode: p.marginMode,
    leverage: p.leverageNum,
    entryPrice: toDecimal(p.entryPrice),
    markPrice: toDecimalOrNull(p.markPrice),
    notional: toDecimalOrNull(p.notional),
    unrealizedPnl: toDecimalOrNull(p.unrealizedPnl),
    initialMargin: toDecimalOrNull(p.initialMargin),
    maintMargin: toDecimalOrNull(p.maintMargin),
    isolatedMargin: toDecimal(p.isolatedMargin),
    liquidationPrice: toDecimalOrNull(p.liquidationPrice),
    roe: toDecimalOrNull(p.roe),
    openedAt: p.openedAt,
    updatedAt: p.updatedAt,
  };
}

export function accountJson(view: AccountView) {
  return {
    walletBalance: toDecimal(view.walletBalance),
    crossWalletBalance: toDecimal(view.crossWalletBalance),
    unrealizedPnl: toDecimalOrNull(view.unrealizedPnl),
    crossUnrealizedPnl: toDecimalOrNull(view.crossUnrealizedPnl),
    marginBalance: toDecimalOrNull(view.marginBalance),
    availableBalance: toDecimalOrNull(view.availableBalance),
    positionInitialMargin: toDecimalOrNull(view.positionInitialMargin),
    openOrderMargin: toDecimal(view.openOrderMargin),
    totalMaintMargin: toDecimalOrNull(view.maintMargin),
    marginRatio: toDecimalOrNull(view.marginRatio),
    positionMode: view.positionMode,
    missingMarkPrices: view.missingMarkPrices,
  };
}

export function fillJson(f: FillRow) {
  return {
    id: f.id,
    orderId: f.orderId,
    symbol: f.symbol,
    side: f.side,
    positionSide: f.positionSide,
    price: toDecimal(f.price),
    qty: toDecimal(f.qty),
    role: f.role,
    fee: toDecimal(f.fee),
    realizedPnl: toDecimal(f.realizedPnl),
    isLiquidation: f.isLiquidation,
    createdAt: f.createdAt.getTime(),
  };
}

export function ledgerJson(l: LedgerRow) {
  return {
    id: l.id,
    type: l.type,
    symbol: l.symbol,
    amount: toDecimal(l.amount),
    balanceAfter: toDecimal(l.balanceAfter),
    refType: l.refType,
    refId: l.refId,
    createdAt: l.createdAt.getTime(),
  };
}

export function fundingJson(f: FundingRow) {
  return {
    id: f.id,
    symbol: f.symbol,
    positionSide: f.positionSide,
    fundingRate: toDecimal(f.fundingRate),
    markPrice: toDecimal(f.markPrice),
    notional: toDecimal(f.notional),
    amount: toDecimal(f.amount),
    settledAt: f.settledAt.getTime(),
  };
}

export function liquidationJson(l: LiquidationRow) {
  return {
    id: l.id,
    symbol: l.symbol,
    positionSide: l.positionSide,
    marginMode: l.marginMode,
    qty: toDecimal(l.qty),
    entryPrice: toDecimal(l.entryPrice),
    markPrice: toDecimal(l.markPrice),
    realizedPnl: toDecimal(l.realizedPnl),
    liquidationFee: toDecimal(l.liquidationFee),
    marginBalanceBefore: toDecimal(l.marginBalanceBefore),
    maintMarginAt: toDecimal(l.maintMarginAt),
    createdAt: l.createdAt.getTime(),
  };
}

/** 24 小时统计：/market/ticker(s) 的 stats24h 和 WS ticker 推送共用，保证两边字段一样 */
export function stats24hJson(stats: Ticker24h) {
  return {
    priceChange: toDecimal(stats.priceChange),
    priceChangePercent: toDecimal(stats.priceChangePercent),
    openPrice: toDecimal(stats.openPrice),
    highPrice: toDecimal(stats.highPrice),
    lowPrice: toDecimal(stats.lowPrice),
    volume: toDecimal(stats.volume),
    quoteVolume: toDecimal(stats.quoteVolume),
    openTime: stats.openTime,
    closeTime: stats.closeTime,
    count: stats.count,
  };
}
