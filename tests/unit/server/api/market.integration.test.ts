import { leverageBrackets, symbols as symbolsTable } from "@binance-contract-trading-full-stack/db";
import { AppError, parse } from "@binance-contract-trading-full-stack/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { BinanceRest, Kline } from "../../../../apps/server/src/market/binance-rest";
import { createMarketState } from "../../../../apps/server/src/market/market-state";
import { createTestDb, setupApi } from "../../../../apps/server/src/testing/api-harness";

/**
 * 第 13b 讲验收：行情接口。真数据库里的币对规格和分层表、真引擎里的盘口；币安 REST 用假的（记下转发的参数）。
 */

const testDb = createTestDb();
afterAll(testDb.close);

function fakeRest() {
  const calls: { method: string; params: unknown }[] = [];
  const kline: Kline = {
    openTime: 1,
    closeTime: 2,
    open: parse("50000"),
    high: parse("50100.5"),
    low: parse("49900"),
    close: parse("50050"),
    volume: parse("12.5"),
    quoteVolume: parse("625000"),
    trades: 42,
    takerBuyVolume: parse("6"),
    takerBuyQuoteVolume: parse("300000"),
  };
  const state = { tickerFails: false };
  const btcStats = {
    priceChange: parse("-120.5"),
    priceChangePercent: parse("-0.241"),
    openPrice: parse("50170.5"),
    highPrice: parse("51000"),
    lowPrice: parse("49500"),
    lastPrice: parse("50050"),
    volume: parse("123456.789"),
    quoteVolume: parse("6180000000.12"),
    openTime: 1,
    closeTime: 2,
    count: 999,
  };
  const rest: BinanceRest = {
    async depthSnapshot(params) {
      calls.push({ method: "depthSnapshot", params });
      return { lastUpdateId: 1, bids: [], asks: [] };
    },
    async klines(params) {
      calls.push({ method: "klines", params });
      return [kline];
    },
    async fundingRates(params) {
      calls.push({ method: "fundingRates", params });
      return [{ fundingTime: 1789632000000, fundingRate: parse("-0.0001"), markPrice: parse("50000.5"), rateType: "Regular" }];
    },
    async ticker24h(symbol) {
      calls.push({ method: "ticker24h", params: symbol });
      if (state.tickerFails) throw new AppError("SERVICE_UNAVAILABLE", "行情数据暂时拿不到");
      return btcStats;
    },
    async ticker24hAll() {
      calls.push({ method: "ticker24hAll", params: undefined });
      if (state.tickerFails) throw new AppError("SERVICE_UNAVAILABLE", "行情数据暂时拿不到");
      // 币安全量接口会返回我们没开放的币对，接口不能把它们带出去
      return new Map([
        ["BTCUSDT", btcStats],
        ["NOTOPENUSDT", btcStats],
      ]);
    },
  };
  return { rest, calls, state };
}

describe("行情接口（第 13b 讲验收）", () => {
  it("/market/symbols：只列开放的币对，规格和分层表来自数据库，数值全是字符串", async () => {
    await testDb.inRollback(async (tx) => {
      const { api } = await setupApi(tx);
      const res = await api("GET", "/market/symbols");
      expect(res.status).toBe(200);
      const enabled = await tx.select().from(symbolsTable).where(eq(symbolsTable.enabled, true)).orderBy(asc(symbolsTable.sortOrder), asc(symbolsTable.symbol));
      expect(res.json.data.map((s: any) => s.symbol)).toEqual(enabled.map((s) => s.symbol));

      const btc = res.json.data.find((s: any) => s.symbol === "BTCUSDT");
      const row = enabled.find((s) => s.symbol === "BTCUSDT")!;
      expect(parse(btc.tickSize)).toBe(row.tickSize);
      expect(parse(btc.minNotional)).toBe(row.minNotional);
      const tiers = await tx.select().from(leverageBrackets).where(eq(leverageBrackets.symbol, "BTCUSDT")).orderBy(asc(leverageBrackets.bracket));
      expect(btc.brackets).toHaveLength(tiers.length);
      expect(btc.maxLeverage).toBe(tiers[0]!.maxLeverage);
      expect(parse(btc.brackets[1].maintAmount)).toBe(tiers[1]!.cum);
      expect(typeof btc.brackets[0].notionalCap).toBe("string");
    });
  });

  it("/market/ticker：实时价格来自行情层，24 小时统计来自币安；币安拿不到时 stats24h 为 null，实时部分照常", async () => {
    await testDb.inRollback(async (tx) => {
      const marketState = createMarketState();
      const { rest, calls, state } = fakeRest();
      const { api, now } = await setupApi(tx, { marketState, binanceRest: rest });

      const empty = (await api("GET", "/market/ticker?symbol=BTCUSDT")).json.data;
      expect(empty).toMatchObject({ symbol: "BTCUSDT", ready: true, lastPrice: null, markPrice: null, indexPrice: null });

      marketState.onEvent({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50050"), qty: parse("0.1"), buyerIsMaker: false, ts: now() });
      marketState.onEvent({
        t: "markPrice",
        symbol: "BTCUSDT",
        markPrice: parse("50040.12"),
        indexPrice: parse("50038.5"),
        fundingRate: parse("0.00012"),
        nextFundingTs: now() + 3600_000,
        ts: now(),
      });
      const ticker = (await api("GET", "/market/ticker?symbol=BTCUSDT")).json.data;
      expect(ticker).toMatchObject({
        lastPrice: "50050",
        lastTradeTime: now(),
        markPrice: "50040.12",
        indexPrice: "50038.5",
        fundingRate: "0.00012",
        nextFundingTime: now() + 3600_000,
        stats24h: { priceChange: "-120.5", priceChangePercent: "-0.241", highPrice: "51000", lowPrice: "49500", quoteVolume: "6180000000.12", count: 999 },
      });
      expect(calls.at(-1)).toEqual({ method: "ticker24h", params: "BTCUSDT" });

      state.tickerFails = true;
      const degraded = await api("GET", "/market/ticker?symbol=BTCUSDT");
      expect(degraded.status).toBe(200);
      expect(degraded.json.data).toMatchObject({ lastPrice: "50050", stats24h: null });

      expect((await api("GET", "/market/ticker?symbol=FOOUSDT")).json.error.code).toBe("SYMBOL_NOT_TRADING");
      expect((await api("GET", "/market/ticker")).json.error.code).toBe("INVALID_PARAMS");
    });
  });

  it("/market/tickers：一次返回全部开放币对，格式和 /market/ticker 相同；24 小时统计只向币安要一次", async () => {
    await testDb.inRollback(async (tx) => {
      const marketState = createMarketState();
      const { rest, calls, state } = fakeRest();
      const { api, now } = await setupApi(tx, { marketState, binanceRest: rest });
      marketState.onEvent({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50050"), qty: parse("0.1"), buyerIsMaker: false, ts: now() });

      const list = (await api("GET", "/market/tickers")).json.data as { symbol: string; stats24h: unknown }[];
      const single = (await api("GET", "/market/ticker?symbol=BTCUSDT")).json.data;
      const open = (await api("GET", "/market/symbols")).json.data as { symbol: string }[];
      expect(list.map((t) => t.symbol)).toEqual(open.map((s) => s.symbol));
      expect(list.find((t) => t.symbol === "BTCUSDT")).toEqual(single);
      // 币安没给统计的开放币对：stats24h 为 null，不编
      expect(list.filter((t) => t.symbol !== "BTCUSDT").every((t) => t.stats24h === null)).toBe(true);
      expect(calls.filter((c) => c.method === "ticker24hAll")).toHaveLength(1);

      state.tickerFails = true;
      const degraded = await api("GET", "/market/tickers");
      expect(degraded.status).toBe(200);
      expect((degraded.json.data as { stats24h: unknown }[]).every((t) => t.stats24h === null)).toBe(true);
    });
  });

  it("24 小时统计优先用币安推送（@ticker 流）；推送还没到的币对才向币安 REST 要", async () => {
    await testDb.inRollback(async (tx) => {
      const marketState = createMarketState();
      const { rest, calls } = fakeRest();
      const { api, now } = await setupApi(tx, { marketState, binanceRest: rest });
      const symbols = ((await api("GET", "/market/symbols")).json.data as { symbol: string }[]).map((s) => s.symbol);
      for (const symbol of symbols) {
        marketState.onEvent({
          t: "stats24h",
          symbol,
          priceChange: parse("1"),
          priceChangePercent: parse("2.5"),
          openPrice: parse("40"),
          highPrice: parse("42"),
          lowPrice: parse("39"),
          lastPrice: parse("41"),
          volume: parse("10"),
          quoteVolume: parse("410"),
          openTime: 1,
          closeTime: 2,
          count: 3,
          ts: now(),
        });
      }
      const single = (await api("GET", "/market/ticker?symbol=BTCUSDT")).json.data;
      expect(single.stats24h).toMatchObject({ priceChangePercent: "2.5", quoteVolume: "410" });
      const list = (await api("GET", "/market/tickers")).json.data as { stats24h: { quoteVolume: string } }[];
      expect(list.every((t) => t.stats24h.quoteVolume === "410")).toBe(true);
      expect(calls.filter((c) => c.method === "ticker24h" || c.method === "ticker24hAll")).toHaveLength(0);
    });
  });

  it("/market/depth：引擎撮合用的那份盘口，按 limit 截档", async () => {
    await testDb.inRollback(async (tx) => {
      const { api, setBook, now } = await setupApi(tx);
      await setBook(
        Array.from({ length: 8 }, (_, i) => [String(49999 - i), "1"] as [string, string]),
        Array.from({ length: 8 }, (_, i) => [String(50000 + i), "2"] as [string, string]),
      );
      const depth = (await api("GET", "/market/depth?symbol=BTCUSDT&limit=5")).json.data;
      expect(depth).toMatchObject({ symbol: "BTCUSDT", ready: true, updateTime: now() });
      expect(depth.bids).toEqual([["49999", "1"], ["49998", "1"], ["49997", "1"], ["49996", "1"], ["49995", "1"]]);
      expect(depth.asks[0]).toEqual(["50000", "2"]);
      expect((await api("GET", "/market/depth?symbol=BTCUSDT")).json.data.bids).toHaveLength(8);
      expect((await api("GET", "/market/depth?symbol=BTCUSDT&limit=7")).json.error.code).toBe("INVALID_PARAMS");
    });
  });

  it("/market/klines 和 /market/funding-history：参数校验后转发币安，输出字符串", async () => {
    await testDb.inRollback(async (tx) => {
      const { rest, calls } = fakeRest();
      const { api } = await setupApi(tx, { binanceRest: rest });

      const klines = await api("GET", "/market/klines?symbol=BTCUSDT&interval=15m&limit=2&startTime=1000&endTime=2000");
      expect(klines.json.data).toEqual([
        { openTime: 1, closeTime: 2, open: "50000", high: "50100.5", low: "49900", close: "50050", volume: "12.5", quoteVolume: "625000", trades: 42, takerBuyVolume: "6", takerBuyQuoteVolume: "300000" },
      ]);
      expect(calls.at(-1)).toEqual({ method: "klines", params: { symbol: "BTCUSDT", interval: "15m", limit: 2, startTime: 1000, endTime: 2000 } });
      await api("GET", "/market/klines?symbol=BTCUSDT&interval=1h");
      expect(calls.at(-1)!.params).toMatchObject({ limit: 500 }); // 币安默认 500

      const bad = ["interval=1s", "interval=1m&limit=1501", "interval=1m&limit=abc", "interval=1m&startTime=2000&endTime=1000"];
      for (const q of bad) expect((await api("GET", `/market/klines?symbol=BTCUSDT&${q}`)).json.error.code, q).toBe("INVALID_PARAMS");
      const callsBefore = calls.length;
      expect((await api("GET", "/market/klines?symbol=FOOUSDT&interval=1m")).json.error.code).toBe("SYMBOL_NOT_TRADING");
      expect(calls.length).toBe(callsBefore); // 没开放的币对不转发

      const funding = await api("GET", "/market/funding-history?symbol=BTCUSDT&limit=3");
      expect(funding.json.data).toEqual([{ fundingTime: 1789632000000, fundingRate: "-0.0001", markPrice: "50000.5", rateType: "Regular" }]);
      expect(calls.at(-1)).toEqual({ method: "fundingRates", params: { symbol: "BTCUSDT", limit: 3 } });
      expect((await api("GET", "/market/funding-history?symbol=BTCUSDT&limit=1001")).json.error.code).toBe("INVALID_PARAMS");
    });
  });

  it("/market/status：整体状态 + 每个开放币对是否就绪、最后成交时间", async () => {
    await testDb.inRollback(async (tx) => {
      const marketState = createMarketState();
      const { api, now, config } = await setupApi(tx, { marketState });
      marketState.onEvent({ t: "trade", symbol: "ETHUSDT", tradeId: 1, price: parse("2400"), qty: parse("1"), buyerIsMaker: true, ts: now() - 5000 });
      const status = (await api("GET", "/market/status")).json.data;
      expect(status.status).toBe("ready");
      const open = config.symbols.filter((s) => s.enabled && s.status === "TRADING").map((s) => s.symbol);
      expect(status.symbols.map((s: any) => s.symbol)).toEqual(open);
      expect(status.symbols.find((s: any) => s.symbol === "BTCUSDT")).toMatchObject({ ready: true, lastTradeTime: null });
      expect(status.symbols.find((s: any) => s.symbol === "ETHUSDT")).toMatchObject({ ready: false, lastTradeTime: now() - 5000 });
    });
  });

  it("公共接口按 IP 限流：/market 和 /leaderboard、/auth 共用 60 次 / 分钟", async () => {
    await testDb.inRollback(async (tx) => {
      let ip = "1.1.1.1";
      const { api, clock } = await setupApi(tx, { clientIp: () => ip });
      for (let i = 0; i < 30; i++) expect((await api("GET", "/market/status")).status).toBe(200);
      for (let i = 0; i < 30; i++) expect((await api("GET", "/leaderboard")).status).toBe(200);
      const limited = await api("GET", "/market/symbols");
      expect(limited).toMatchObject({ status: 429, json: { error: { code: "RATE_LIMITED" } } });
      ip = "2.2.2.2";
      expect((await api("GET", "/market/status")).status).toBe(200);
      ip = "1.1.1.1";
      clock.t += 60_000;
      expect((await api("GET", "/market/status")).status).toBe(200);
    });
  });
});
