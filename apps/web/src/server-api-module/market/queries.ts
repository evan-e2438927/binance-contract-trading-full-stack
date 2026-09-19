import { queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";

import type { DepthSnapshot, FundingRateRecord, Kline, KlineQuery, MarketStatus, SymbolSpec, Ticker } from "./types";

/** 行情模块的 queryKey，失效时按前缀匹配 */
export const marketKeys = {
  all: ["market"] as const,
  symbols: () => [...marketKeys.all, "symbols"] as const,
  ticker: (symbol: string) => [...marketKeys.all, "ticker", symbol] as const,
  fundingHistory: (symbol: string) => [...marketKeys.all, "funding-history", symbol] as const,
};

/** GET /market/symbols：开放交易的币对规格 + 杠杆分层表 */
export const fetchSymbols = () => request.get<SymbolSpec[]>("/market/symbols");

/** GET /market/ticker：一个币对的实时价格 + 24 小时统计 */
export const fetchTicker = (symbol: string) => request.get<Ticker>("/market/ticker", { symbol });

/** GET /market/tickers：全部开放币对的 ticker（格式同上，顺序同 /market/symbols）。首页列表用，一次请求代替 N 次 */
export const fetchTickers = () => request.get<Ticker[]>("/market/tickers");

/** GET /market/depth：盘口快照（引擎撮合用的那份），切币对时填首屏 */
export const fetchDepth = (symbol: string, limit: 5 | 10 | 20 = 20) =>
  request.get<DepthSnapshot>("/market/depth", { symbol, limit });

/** GET /market/klines：历史 K 线（代理币安） */
export const fetchKlines = (query: KlineQuery) => request.get<Kline[]>("/market/klines", query);

/** GET /market/funding-history：币安的历史资金费率 */
export const fetchFundingHistory = (symbol: string, limit = 100) =>
  request.get<FundingRateRecord[]>("/market/funding-history", { symbol, limit });

/** GET /market/status：行情源状态 */
export const fetchMarketStatus = () => request.get<MarketStatus>("/market/status");

/** 币对规格：基本不变（分层表每天同步一次），缓存 10 分钟 */
export const symbolsQuery = () =>
  queryOptions({ queryKey: marketKeys.symbols(), queryFn: fetchSymbols, staleTime: 10 * 60_000 });

/** 历史资金费率 */
export const fundingHistoryQuery = (symbol: string) =>
  queryOptions({ queryKey: marketKeys.fundingHistory(symbol), queryFn: () => fetchFundingHistory(symbol) });
