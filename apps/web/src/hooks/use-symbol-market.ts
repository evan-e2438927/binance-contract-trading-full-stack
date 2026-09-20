import { useEffect } from "react";

import { aggregateSide } from "@binance-contract-trading-full-stack/shared";

/** 和服务端 ws/publisher.ts 的 WS_DEPTH_ROWS 一致：每侧最多 20 行 */
const WS_DEPTH_ROWS = 20;

import { wsClient } from "@/lib/ws-client/instance";
import { fetchDepth, fetchTicker, fetchTickers } from "@/server-api-module/market/queries";
import { marketChannels, onDepth, onTicker, onTrade } from "@/server-api-module/market/subscriptions";
import { queueBook, queueTrade, useMarketStore } from "@/stores/market-store";

/**
 * 订阅一个币对的实时行情（盘口、最新成交、ticker）并写进 market-store。交易页挂一次。
 *
 * 切币对时（05 第 5 节）：退订旧币对的频道 → 订新币对 → 同时用 REST 拉一次盘口和 ticker 填首屏。
 * 不能只等 WS 第一条推送：ticker 一秒一条还好，页面会先空一下。
 */
export function useSymbolMarket(symbol: string, step?: string) {
  useEffect(() => {
    let cancelled = false;
    const store = useMarketStore.getState();

    // REST 首屏拿到的是**原始档位**（WS 推的是服务端聚合好的行），这里自己合一次，
    // 用的是 shared 里同一个 aggregateSide，和服务端一套算法
    fetchDepth(symbol)
      .then(({ bids, asks, updateTime }) => {
        // 已经收到过更新的推送就不要用旧快照覆盖
        const current = useMarketStore.getState().books[symbol];
        if (cancelled || (current && current.updateTime >= updateTime)) return;
        if (step === undefined) return; // 精度还没定，等 WS 第一条
        store.setBook(symbol, {
          step,
          bids: aggregateSide(bids, step, "bid", WS_DEPTH_ROWS),
          asks: aggregateSide(asks, step, "ask", WS_DEPTH_ROWS),
          updateTime,
        });
      })
      .catch(() => {});
    fetchTicker(symbol)
      .then((ticker) => {
        if (!cancelled) store.setTicker(ticker);
      })
      .catch(() => {});

    const offs = [
      onDepth(symbol, step, (book) => queueBook(symbol, book)),
      onTrade(symbol, (trade) => queueTrade(symbol, trade)),
      onTicker(symbol, (ticker) => store.applyTickerPush(symbol, ticker)),
      wsClient.subscribe([marketChannels.depth(symbol, step), marketChannels.trade(symbol), marketChannels.ticker(symbol)]),
    ];

    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
    // step 变了要重订：精度是跟着频道名走的
  }, [symbol, step]);
}

/**
 * 只订一批币对的 ticker（首页币对列表、顶栏币对切换下拉）。
 * 首屏用 /market/tickers 一次拉全部，之后靠 WS ticker 推送（含 24 小时统计，缺口 #47）。
 * 不按币对逐个请求：19 个请求一次加载就会用掉公开接口每分钟 60 次限额的三分之一。
 */
export function useTickers(symbols: readonly string[]) {
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let cancelled = false;
    const store = useMarketStore.getState();

    const wanted = new Set(list);
    fetchTickers()
      .then((tickers) => {
        if (!cancelled) store.setTickers(tickers.filter((t) => wanted.has(t.symbol)));
      })
      .catch(() => {});
    const offs = [
      ...list.map((symbol) => onTicker(symbol, (ticker) => store.applyTickerPush(symbol, ticker))),
      wsClient.subscribe(list.map(marketChannels.ticker)),
    ];
    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, [key]);
}
