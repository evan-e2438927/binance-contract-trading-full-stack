import { wsClient } from "@/lib/ws-client/instance";

import type { KlineInterval, KlinePush, MarketStatusPush, OrderBook, TickerPush, Trade } from "./types";

/**
 * 行情频道（apps/server/src/ws/protocol.ts）。公共频道，要 wsClient.subscribe 才会推。
 * onXxx 只挂监听、返回取消函数；订阅（subscribe）由调用方另外做，因为同一批频道常常一次订。
 */
export const marketChannels = {
  /** 行情源状态 */
  market: "market",
  /** 盘口：20 档全量快照 */
  depth: (symbol: string) => `depth:${symbol}`,
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

/** 监听盘口 */
export const onDepth = (symbol: string, handler: (book: OrderBook) => void) =>
  wsClient.on<OrderBook>(marketChannels.depth(symbol), ({ d }) => handler(d));

/** 监听最新成交 */
export const onTrade = (symbol: string, handler: (trade: Trade) => void) =>
  wsClient.on<Trade>(marketChannels.trade(symbol), ({ d }) => handler(d));

/** 监听价格 */
export const onTicker = (symbol: string, handler: (ticker: TickerPush) => void) =>
  wsClient.on<TickerPush>(marketChannels.ticker(symbol), ({ d }) => handler(d));

/** 监听 K 线 */
export const onKline = (symbol: string, interval: KlineInterval, handler: (kline: KlinePush) => void) =>
  wsClient.on<KlinePush>(marketChannels.kline(symbol, interval), ({ d }) => handler(d));
