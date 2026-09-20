import { readFileSync } from "node:fs";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { MarketParseError, parseStreamMessage, type MarketEvent } from "./parse";

/** 2026-09-17 从 wss://fstream.binance.com/{public,market}/stream 抓的真实推送：BTCUSDT、ETHUSDT 各几条 */
const lines = readFileSync(new URL("./__fixtures__/binance-streams-2026-09-17.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

/** 2026-09-20 抓的增量深度推送（S01 换流之后用这一份） */
const depthLines = readFileSync(new URL("./__fixtures__/binance-depth-diff-2026-09-20.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

const firstDepthDiff = (): { raw: string; data: Record<string, any> } => {
  const raw = depthLines[0]!;
  return { raw, data: JSON.parse(raw).data };
};

function first(kind: string): { raw: string; data: Record<string, any> } {
  const raw = lines.find((l) => (JSON.parse(l) as { stream: string }).stream.includes(`@${kind}`))!;
  return { raw, data: JSON.parse(raw).data };
}

describe("真实推送", () => {
  it("录下来的每一条都能解析", () => {
    const events = lines.map((l) => parseStreamMessage(l)) as MarketEvent[];
    // depth20 那条流已经不订了（S01 换成增量深度），解析器不再认它，返回 null
    expect(events.filter((e) => e !== null).length).toBeGreaterThan(0);
    const kinds = new Set(events.filter((e) => e !== null).map((e) => e.t));
    expect(kinds).toEqual(new Set(["trade", "markPrice", "kline"]));
  });

  it("增量深度：U / u / pu 三个序列号都在，数量是绝对值、0 表示删档，时间取 T", () => {
    const { raw, data } = firstDepthDiff();
    const event = parseStreamMessage(raw)!;
    expect(event).toMatchObject({
      t: "depthDiff",
      symbol: data.s,
      firstUpdateId: data.U,
      finalUpdateId: data.u,
      prevFinalUpdateId: data.pu,
      ts: data.T,
    });
    if (event.t !== "depthDiff") throw new Error("unreachable");
    expect(event.bids[0]).toEqual({ price: parse(data.b[0][0]), qty: parse(data.b[0][1]) });
    // 真实推送里就有数量为 0 的档位（删档）
    expect(depthLines.some((l) => JSON.parse(l).data.b.some((level: string[]) => level[1] === "0.000"))).toBe(true);
  });

  it("增量深度的档位不要求有序：排序由本地盘口维护", () => {
    const { data } = firstDepthDiff();
    const shuffled = [...data.b].reverse();
    expect(() =>
      parseStreamMessage(JSON.stringify({ stream: "btcusdt@depth@100ms", data: { ...data, b: shuffled } })),
    ).not.toThrow();
  });

  it("连续两条的 pu 接上上一条的 u（币安文档第 6 条）", () => {
    const sameSymbol = depthLines
      .map((l) => JSON.parse(l))
      .filter((m) => m.stream.startsWith("btcusdt"))
      .map((m) => m.data);
    expect(sameSymbol.length).toBeGreaterThan(1);
    for (let i = 1; i < sameSymbol.length; i++) {
      expect(sameSymbol[i].pu).toBe(sameSymbol[i - 1].u);
    }
  });

  it("aggTrade：数量取 nq（不含 RPI），id 取 a，时间取 T", () => {
    const { raw, data } = first("aggTrade");
    expect(parseStreamMessage(raw)).toEqual({
      t: "trade",
      symbol: data.s,
      tradeId: data.a,
      price: parse(data.p),
      qty: parse(data.nq),
      buyerIsMaker: data.m,
      ts: data.T,
    });
  });

  it("markPrice@1s：标记价 p、指数价格 i、费率 r、下次结算 T，时间取 E", () => {
    const { raw, data } = first("markPrice");
    expect(parseStreamMessage(raw)).toEqual({
      t: "markPrice",
      symbol: data.s,
      markPrice: parse(data.p),
      indexPrice: parse(data.i),
      fundingRate: parse(data.r),
      nextFundingTs: data.T,
      ts: data.E,
    });
  });

  it("kline_1m：OHLCV 和是否收盘", () => {
    const { raw, data } = first("kline_1m");
    expect(parseStreamMessage(raw)).toMatchObject({
      t: "kline",
      symbol: data.s,
      interval: "1m",
      openTime: data.k.t,
      close: parse(data.k.c),
      volume: parse(data.k.v),
      closed: data.k.x,
    });
  });
});

describe("24 小时统计（<symbol>@ticker，缺口 #47）", () => {
  /** 2026-09-19 从 wss://fstream.binance.com/market/stream 抓的真实推送 */
  const tickerLines = readFileSync(new URL("./__fixtures__/binance-ticker-2026-09-19.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean);

  it("字段对照：p 涨跌额、P 涨跌幅（百分数）、o/h/l/c、v 成交量、q 成交额、O/C 统计窗口、n 笔数；时间取 E", () => {
    expect(parseStreamMessage(tickerLines[0]!)).toEqual({
      t: "stats24h",
      symbol: "BTCUSDT",
      priceChange: parse("3195.80"),
      priceChangePercent: parse("4.095"),
      openPrice: parse("78044.50"),
      highPrice: parse("81732.40"),
      lowPrice: parse("77923.50"),
      lastPrice: parse("81240.30"),
      volume: parse("180534.136"),
      quoteVolume: parse("14535062295.49"),
      openTime: 1789730940000,
      closeTime: 1789817393686,
      count: 3816694,
      ts: 1789817393687,
    });
    expect(parseStreamMessage(tickerLines[1]!)).toMatchObject({ t: "stats24h", symbol: "ETHUSDT" });
  });

  it("涨跌可以为负", () => {
    const raw = tickerLines[0]!.replace('"p":"3195.80","P":"4.095"', '"p":"-3195.80","P":"-4.095"');
    expect(parseStreamMessage(raw)).toMatchObject({ priceChange: parse("-3195.80"), priceChangePercent: parse("-4.095") });
  });

  it("★ 格式不对照样抛错，但标记为非关键（critical = false）：只影响展示，不能让行情层降级、停撮合", () => {
    const raw = tickerLines[0]!.replace('"q":"14535062295.49"', '"q":"1.123456789"');
    let error: unknown;
    try {
      parseStreamMessage(raw);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MarketParseError);
    expect((error as MarketParseError).critical).toBe(false);
  });

  it("撮合相关的流解析失败仍然是关键错误", () => {
    try {
      parseStreamMessage('{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","b":"oops"}}');
    } catch (e) {
      expect((e as MarketParseError).critical).toBe(true);
    }
  });
});

describe("格式不对就抛错，不猜", () => {
  const trade = first("aggTrade");
  const withData = (patch: Record<string, unknown>) =>
    JSON.stringify({ stream: "btcusdt@aggTrade", data: { ...trade.data, ...patch } });

  it.each([
    ["不是 JSON", "{oops"],
    ["缺 nq（不退回 q）", withData({ nq: undefined })],
    ["价格是 number 不是字符串", withData({ p: 76132.5 })],
    ["科学计数法", withData({ p: "7.6e4" })],
    ["超过 8 位小数", withData({ p: "76132.123456789" })],
    ["价格为 0", withData({ p: "0" })],
    ["m 不是布尔值", withData({ m: "true" })],
    ["时间戳不是整数", withData({ T: 1.5 })],
    ["事件类型对不上", withData({ e: "trade" })],
  ])("%s", (_name, raw) => {
    expect(() => parseStreamMessage(raw)).toThrow(MarketParseError);
  });

  it("资金费率可以为负", () => {
    const mark = first("markPrice");
    const event = parseStreamMessage(JSON.stringify({ stream: "btcusdt@markPrice@1s", data: { ...mark.data, r: "-0.00012500" } }));
    expect(event).toMatchObject({ fundingRate: parse("-0.000125") });
  });

  it("订阅之外的流：返回 null", () => {
    expect(parseStreamMessage(JSON.stringify({ stream: "btcusdt@bookTicker", data: {} }))).toBeNull();
  });
});
