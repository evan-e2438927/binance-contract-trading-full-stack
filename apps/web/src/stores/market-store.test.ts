import { beforeEach, describe, expect, it } from "vitest";

import type { Stats24h, TickerPush } from "@/server-api-module/market/types";

import { useMarketStore } from "./market-store";

const stats = (quoteVolume: string): Stats24h => ({
  priceChange: "1",
  priceChangePercent: "2.5",
  openPrice: "40",
  highPrice: "42",
  lowPrice: "39",
  volume: "10",
  quoteVolume,
  openTime: 1,
  closeTime: 2,
  count: 3,
});

const push = (overrides: Partial<TickerPush> = {}): TickerPush => ({
  lastPrice: "41",
  lastTradeTime: 1,
  markPrice: "41",
  indexPrice: "41",
  fundingRate: "0.0001",
  nextFundingTime: 10,
  markTime: 1,
  stats24h: null,
  ...overrides,
});

describe("applyTickerPush", () => {
  beforeEach(() => useMarketStore.setState({ tickers: {} }));

  it("推送带 24 小时统计：覆盖旧值（缺口 #47，统计也实时了）", () => {
    const store = useMarketStore.getState();
    store.applyTickerPush("BTCUSDT", push({ stats24h: stats("100") }));
    store.applyTickerPush("BTCUSDT", push({ stats24h: stats("200") }));
    expect(useMarketStore.getState().tickers.BTCUSDT?.stats24h?.quoteVolume).toBe("200");
  });

  it("推送的 24 小时统计为 null（服务端还没收到币安推送）：保留 REST 首屏拉到的，不清成 --", () => {
    const store = useMarketStore.getState();
    store.applyTickerPush("BTCUSDT", push({ stats24h: stats("100") }));
    store.applyTickerPush("BTCUSDT", push({ stats24h: null, markPrice: "42" }));
    const ticker = useMarketStore.getState().tickers.BTCUSDT;
    expect(ticker?.stats24h?.quoteVolume).toBe("100");
    expect(ticker?.markPrice).toBe("42");
  });
});
