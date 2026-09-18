import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import type { MarketEvent } from "./parse";

/**
 * 行情层收到的最新标记价 / 指数价格 / 成交，给 `/market/ticker`、`/market/status` 展示用（第 13b 讲）。
 *
 * 和引擎里的行情不是一份：引擎只收"就绪币对"的标记价和成交（第 11 讲行情门控），这里不管就绪不就绪，
 * 收到就记——状态接口正是要告诉用户"最后一笔成交是什么时候"。撮合用的盘口和价格以引擎为准（`/market/depth`）。
 */

export interface MarkSnapshot {
  markPrice: Fixed;
  indexPrice: Fixed;
  fundingRate: Fixed;
  nextFundingTs: number;
  ts: number;
}

export interface MarketState {
  onEvent(event: MarketEvent): void;
  mark(symbol: string): MarkSnapshot | undefined;
  lastTrade(symbol: string): { price: Fixed; ts: number } | undefined;
}

export function createMarketState(): MarketState {
  const marks = new Map<string, MarkSnapshot>();
  const trades = new Map<string, { price: Fixed; ts: number }>();
  return {
    onEvent(event) {
      if (event.t === "markPrice") {
        marks.set(event.symbol, {
          markPrice: event.markPrice,
          indexPrice: event.indexPrice,
          fundingRate: event.fundingRate,
          nextFundingTs: event.nextFundingTs,
          ts: event.ts,
        });
      } else if (event.t === "trade") {
        trades.set(event.symbol, { price: event.price, ts: event.ts });
      }
    },
    mark: (symbol) => marks.get(symbol),
    lastTrade: (symbol) => trades.get(symbol),
  };
}
