import { wsClient } from "@/lib/ws-client/instance";

import type { KlineInterval, KlinePush, MarketStatusPush, OrderBook, TickerPush, Trade } from "./types";

/**
 * 行情频道（apps/server/src/ws/protocol.ts）。公共频道，要 wsClient.subscribe 才会推。
 * onXxx 只挂监听、返回取消函数；订阅（subscribe）由调用方另外做，因为同一批频道常常一次订。
 */
export const marketChannels = {
  /** 行情源状态 */
  market: "market",
  /**
   * 盘口：服务端按精度聚合好的 20 行全量快照（2026-09-20）。
   * 不传 step 走老写法，服务端按该币对 tickSize（最细）聚合。
   */
  depth: (symbol: string, step?: string) => (step ? `depth:${symbol}:${step}` : `depth:${symbol}`),
  /** 最新成交 */
  trade: (symbol: string) => `trade:${symbol}`,
  /** 价格：约 1 秒一条 */
  ticker: (symbol: string) => `ticker:${symbol}`,
  /** K 线 */
  kline: (symbol: string, interval: KlineInterval) => `kline:${symbol}:${interval}`,
} as const;

/** 监听行情源状态 */
export const onMarketStatus = (handler: (status: MarketStatusPush) => void) =>
  wsClient.on<MarketStatusPush>(marketChannels.market, ({ d }) => handler(d));

/** 监听盘口。step 要和 subscribe 时用的一致，否则收不到 */
export const onDepth = (symbol: string, step: string | undefined, handler: (book: OrderBook) => void) =>
  wsClient.on<OrderBook>(marketChannels.depth(symbol, step), ({ d }) => handler(d));

/** 监听最新成交 */
export const onTrade = (symbol: string, handler: (trade: Trade) => void) =>
  wsClient.on<Trade>(marketChannels.trade(symbol), ({ d }) => handler(d));

/** 监听价格 */
export const onTicker = (symbol: string, handler: (ticker: TickerPush) => void) =>
  wsClient.on<TickerPush>(marketChannels.ticker(symbol), ({ d }) => handler(d));

/** 监听 K 线 */
export const onKline = (symbol: string, interval: KlineInterval, handler: (kline: KlinePush) => void) =>
  wsClient.on<KlinePush>(marketChannels.kline(symbol, interval), ({ d }) => handler(d));
