import { create } from "zustand";

import type { FeedStatus, OrderBook, Stats24h, Ticker, TickerPush, Trade } from "@/server-api-module/market/types";

/**
 * 行情 store（05-frontend-design.md 第 4 节）：盘口、最新成交、ticker、行情源状态。
 * WS 推送驱动，不进 React Query。K 线不在这里——TradingView Charting Library 自己管 K 线数据，
 * 走 lib/tv-datafeed（第 2 阶段）。
 *
 * 组件一律用 selector 只订自己那一片：
 *   ✅ useMarketStore((s) => s.books.BTCUSDT)
 *   ❌ const { books } = useMarketStore()
 */

/** 最新成交只留最近 50 条（新的在前） */
export const MAX_TRADES = 50;

export type TickerState = Omit<Ticker, "symbol" | "ready"> & { ready?: boolean };

export interface MarketState {
  /** 行情源状态；unknown = 还没收到过 market 频道 */
  feedStatus: FeedStatus | "unknown";
  matchingEnabled: boolean;
  books: Record<string, OrderBook>;
  tickers: Record<string, TickerState>;
  trades: Record<string, Trade[]>;

  setFeedStatus(status: FeedStatus, matchingEnabled: boolean): void;
  setBook(symbol: string, book: OrderBook): void;
  /** REST /market/ticker 的全量（含 24 小时统计） */
  setTicker(ticker: Ticker): void;
  /** REST /market/tickers：一次写入多个币对（一次状态更新，订阅方不会看到只到了一半的列表） */
  setTickers(tickers: readonly Ticker[]): void;
  /** WS ticker 推送：只有实时部分，24 小时统计保留上一次 REST 拉到的 */
  applyTickerPush(symbol: string, push: TickerPush): void;
  addTrades(symbol: string, trades: Trade[]): void;
}

const EMPTY_TICKER: TickerState = {
  lastPrice: null,
  lastTradeTime: null,
  markPrice: null,
  indexPrice: null,
  fundingRate: null,
  nextFundingTime: null,
  markTime: null,
  stats24h: null as Stats24h | null,
};

export const useMarketStore = create<MarketState>()((set) => ({
  feedStatus: "unknown",
  matchingEnabled: true,
  books: {},
  tickers: {},
  trades: {},

  setFeedStatus: (feedStatus, matchingEnabled) => set({ feedStatus, matchingEnabled }),

  setBook: (symbol, book) => set((s) => ({ books: { ...s.books, [symbol]: book } })),

  setTicker: ({ symbol, ...ticker }) => set((s) => ({ tickers: { ...s.tickers, [symbol]: ticker } })),

  setTickers: (list) =>
    set((s) => {
      const tickers = { ...s.tickers };
      for (const { symbol, ...ticker } of list) tickers[symbol] = ticker;
      return { tickers };
    }),

  applyTickerPush: (symbol, push) =>
    set((s) => {
      const prev = s.tickers[symbol] ?? EMPTY_TICKER;
      // 推送里 lastPrice、stats24h 可能是 null（还没成交过 / 服务端还没收到币安统计），不要把已有的覆盖掉
      return {
        tickers: {
          ...s.tickers,
          [symbol]: {
            ...prev,
            ...push,
            lastPrice: push.lastPrice ?? prev.lastPrice,
            stats24h: push.stats24h ?? prev.stats24h,
          },
        },
      };
    }),

  addTrades: (symbol, incoming) =>
    set((s) => {
      const merged = [...[...incoming].reverse(), ...(s.trades[symbol] ?? [])].slice(0, MAX_TRADES);
      return { trades: { ...s.trades, [symbol]: merged } };
    }),
}));

/**
 * 盘口 100ms 一推、成交可能一秒几十条。按 requestAnimationFrame 合并成一帧写一次 store，
 * 避免推送频率高于渲染频率时整页掉帧（05 第 9 节措施 ①）。
 */
function createFrameBatcher<T>(flush: (pending: Map<string, T[]>) => void) {
  let pending = new Map<string, T[]>();
  let scheduled = false;
  const schedule =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  return (symbol: string, item: T) => {
    const list = pending.get(symbol);
    if (list) list.push(item);
    else pending.set(symbol, [item]);
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      const batch = pending;
      pending = new Map();
      scheduled = false;
      flush(batch);
    });
  };
}

/** 盘口：一帧里只保留最后一份 */
export const queueBook = createFrameBatcher<OrderBook>((batch) => {
  const { setBook } = useMarketStore.getState();
  for (const [symbol, books] of batch) {
    const last = books[books.length - 1];
    if (last) setBook(symbol, last);
  }
});

/** 成交：一帧里的全部追加 */
export const queueTrade = createFrameBatcher<Trade>((batch) => {
  const { addTrades } = useMarketStore.getState();
  for (const [symbol, trades] of batch) addTrades(symbol, trades);
});
