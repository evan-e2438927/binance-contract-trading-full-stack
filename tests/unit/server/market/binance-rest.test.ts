import { AppError, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it, vi } from "vitest";
import { createBinanceRest, parseKlines, parseTicker24hAll } from "../../../../apps/server/src/market/binance-rest";

const quiet = { error: () => {} };
const kline = [1789600000000, "76500.1", "76600", "76400.5", "76575.6", "12.345", 1789600059999, "945000.12", 321, "6.1", "467000.5", "0"];
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

const stats = (symbol: string, quoteVolume: string) => ({
  symbol,
  priceChange: "-120.5",
  priceChangePercent: "-0.241",
  weightedAvgPrice: "50000",
  lastPrice: "50050",
  lastQty: "0.1",
  openPrice: "50170.5",
  highPrice: "51000",
  lowPrice: "49500",
  volume: "123456.789",
  quoteVolume,
  openTime: 1,
  closeTime: 2,
  firstId: 1,
  lastId: 999,
  count: 999,
});

describe("币安 REST 代理", () => {
  it("全量 24 小时统计：按币对建索引；某一条格式不对只跳过这一条（记日志），不连累其它币对", () => {
    const errors: string[] = [];
    const bad = { ...stats("WEIRDUSDT", "1"), highPrice: "1.123456789" };
    const all = parseTicker24hAll([stats("BTCUSDT", "6180000000.12"), bad, stats("ETHUSDT", "3250000000")], {
      error: (msg: string) => errors.push(msg),
    });
    expect([...all.keys()]).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(all.get("BTCUSDT")?.quoteVolume).toBe(parse("6180000000.12"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("WEIRDUSDT");
  });

  it("全量 24 小时统计不带 symbol 请求一次（权重 40），缓存 10 秒", async () => {
    let t = 0;
    const fetchMock = vi.fn(async () => json([stats("BTCUSDT", "1")]));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, now: () => t, logger: quiet });
    await Promise.all([rest.ticker24hAll(), rest.ticker24hAll()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://fapi.binance.com/fapi/v1/ticker/24hr?");
    t += 9_999;
    await rest.ticker24hAll();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 1;
    await rest.ticker24hAll();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("全量 24 小时统计的响应不是数组：SERVICE_UNAVAILABLE", async () => {
    const fetchMock = vi.fn(async () => json({ code: -1 }));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, logger: quiet });
    expect(await codeOf(rest.ticker24hAll())).toBe("SERVICE_UNAVAILABLE");
  });

  it("K 线按严格十进制解析成定标整数", () => {
    expect(parseKlines([kline])[0]).toEqual({
      openTime: 1789600000000,
      open: parse("76500.1"),
      high: parse("76600"),
      low: parse("76400.5"),
      close: parse("76575.6"),
      volume: parse("12.345"),
      closeTime: 1789600059999,
      quoteVolume: parse("945000.12"),
      trades: 321,
      takerBuyVolume: parse("6.1"),
      takerBuyQuoteVolume: parse("467000.5"),
    });
  });

  it("缓存 + 同一个请求并发只发一次；过期后重新请求", async () => {
    let t = 1_000_000;
    const fetchMock = vi.fn(async () => json([kline]));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, now: () => t, logger: quiet });
    const q = { symbol: "BTCUSDT", interval: "1m" as const, limit: 1 };
    await Promise.all([rest.klines(q), rest.klines(q), rest.klines(q)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=1");
    t += 4_999;
    await rest.klines(q);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 1;
    await rest.klines(q);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("整段已经收盘的历史 K 线缓存 10 分钟", async () => {
    let t = Date.parse("2026-09-17T12:00:00Z");
    const fetchMock = vi.fn(async () => json([kline]));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, now: () => t, logger: quiet });
    const q = { symbol: "BTCUSDT", interval: "1m" as const, limit: 1, endTime: t - 3_600_000 };
    await rest.klines(q);
    t += 599_999;
    await rest.klines(q);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("★ 被限流（429 / 418）按 Retry-After 暂停：暂停期间不再请求币安，直接 SERVICE_UNAVAILABLE", async () => {
    let t = 0;
    const fetchMock = vi.fn(async () => new Response("", { status: 418, headers: { "Retry-After": "120" } }));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, now: () => t, logger: quiet });
    expect(await codeOf(rest.ticker24h("BTCUSDT"))).toBe("SERVICE_UNAVAILABLE");
    t += 119_999;
    expect(await codeOf(rest.fundingRates({ symbol: "BTCUSDT", limit: 10 }))).toBe("SERVICE_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => json([{ fundingTime: 1, fundingRate: "-0.0001", markPrice: "", rateType: "Regular" }]));
    t += 1;
    expect(await rest.fundingRates({ symbol: "BTCUSDT", limit: 10 })).toEqual([{ fundingTime: 1, fundingRate: parse("-0.0001"), markPrice: null, rateType: "Regular" }]);
  });

  it("格式不对（超过 8 位小数、缺字段）、网络错误都报 SERVICE_UNAVAILABLE，失败结果不缓存", async () => {
    const bad = [...kline];
    bad[4] = "76575.123456789";
    const fetchMock = vi.fn(async () => json([bad]));
    const rest = createBinanceRest({ fetch: fetchMock as typeof fetch, logger: quiet });
    const q = { symbol: "BTCUSDT", interval: "1m" as const, limit: 1 };
    expect(await codeOf(rest.klines(q))).toBe("SERVICE_UNAVAILABLE");
    fetchMock.mockImplementation(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await codeOf(rest.klines(q))).toBe("SERVICE_UNAVAILABLE");
    fetchMock.mockImplementation(async () => json([kline]));
    expect(await rest.klines(q)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
