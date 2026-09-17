import { readFileSync } from "node:fs";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { MarketParseError, parseStreamMessage, type MarketEvent } from "./parse";

/** 2026-09-17 从 wss://fstream.binance.com/{public,market}/stream 抓的真实推送：BTCUSDT、ETHUSDT 各几条 */
const lines = readFileSync(new URL("./__fixtures__/binance-streams-2026-09-17.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

function first(kind: string): { raw: string; data: Record<string, any> } {
  const raw = lines.find((l) => (JSON.parse(l) as { stream: string }).stream.includes(`@${kind}`))!;
  return { raw, data: JSON.parse(raw).data };
}

describe("真实推送", () => {
  it("录下来的每一条都能解析，四种流都有", () => {
    const events = lines.map((l) => parseStreamMessage(l)) as MarketEvent[];
    expect(events.every((e) => e !== null)).toBe(true);
    const kinds = new Set(events.map((e) => e.t));
    expect(kinds).toEqual(new Set(["book", "trade", "markPrice", "kline"]));
  });

  it("depth20：20 档，价格数量从字符串直接 parse，买盘降序、卖盘升序，时间取 T", () => {
    const { raw, data } = first("depth20");
    const event = parseStreamMessage(raw)!;
    expect(event).toMatchObject({ t: "book", symbol: data.s, ts: data.T });
    if (event.t !== "book") throw new Error("unreachable");
    expect(event.bids).toHaveLength(20);
    expect(event.asks).toHaveLength(20);
    expect(event.bids[0]).toEqual({ price: parse(data.b[0][0]), qty: parse(data.b[0][1]) });
    expect(event.asks[19]).toEqual({ price: parse(data.a[19][0]), qty: parse(data.a[19][1]) });
    expect(event.bids[0]!.price < event.asks[0]!.price).toBe(true);
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

  it("markPrice@1s：标记价 p、费率 r、下次结算 T，时间取 E", () => {
    const { raw, data } = first("markPrice");
    expect(parseStreamMessage(raw)).toEqual({
      t: "markPrice",
      symbol: data.s,
      markPrice: parse(data.p),
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

  it("盘口顺序不对：抛错，不悄悄重排", () => {
    const depth = first("depth20");
    const bids = [...depth.data.b].reverse();
    expect(() => parseStreamMessage(JSON.stringify({ stream: "btcusdt@depth20@100ms", data: { ...depth.data, b: bids } }))).toThrow(
      /买盘不是按价格降序/,
    );
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
