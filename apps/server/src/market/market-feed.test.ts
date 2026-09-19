import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConnectionOptions } from "./connection";
import { startMarketFeed, type FeedStatus } from "./market-feed";
import type { MarketEvent } from "./parse";

const lines = readFileSync(new URL("./__fixtures__/binance-streams-2026-09-17.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);
const pick = (symbol: string, kind: string) =>
  lines.find((l) => (JSON.parse(l) as { stream: string }).stream.startsWith(`${symbol}@${kind}`))!;

const silent = { log: () => {}, error: () => {} };

/** 假连接：记下 market-feed 给的回调，测试手动推状态和消息 */
function setup(symbols = ["BTCUSDT", "ETHUSDT"]) {
  const connections = new Map<string, ConnectionOptions & { stopped: boolean }>();
  const events: MarketEvent[] = [];
  const statuses: FeedStatus[] = [];
  const feed = startMarketFeed({
    symbols,
    logger: silent,
    onEvent: (e) => events.push(e),
    onStatusChange: (s) => statuses.push(s),
    openConnection: (options) => {
      const record = { ...options, stopped: false };
      connections.set(options.name, record);
      options.onStateChange?.("connecting");
      return { name: options.name, state: () => "connecting", stop: () => (record.stopped = true) };
    },
  });
  const conn = (name: "public" | "market") => connections.get(name)!;
  const openBoth = () => {
    conn("public").onStateChange!("open");
    conn("market").onStateChange!("open");
  };
  const snapshots = () => {
    conn("public").onMessage(pick("btcusdt", "depth20"));
    conn("public").onMessage(pick("ethusdt", "depth20"));
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    conn("market").onMessage(pick("ethusdt", "markPrice"));
  };
  return { feed, conn, events, statuses, openBoth, snapshots };
}

describe("行情状态", () => {
  it("两条连接地址：盘口走 /public，成交、标记价、K 线走 /market（缺口 #22）", () => {
    const { conn } = setup();
    expect(conn("public").url).toBe(
      "wss://fstream.binance.com/public/stream?streams=btcusdt@depth20@100ms/ethusdt@depth20@100ms",
    );
    expect(conn("market").url).toBe(
      "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@markPrice@1s/btcusdt@kline_1m/btcusdt@ticker/ethusdt@aggTrade/ethusdt@markPrice@1s/ethusdt@kline_1m/ethusdt@ticker",
    );
  });

  it("连上还不算就绪：每个币对都收到过盘口和标记价才 ready", () => {
    const { feed, conn, openBoth, statuses } = setup();
    openBoth();
    expect(feed.status()).toBe("connecting");
    conn("public").onMessage(pick("btcusdt", "depth20"));
    conn("public").onMessage(pick("ethusdt", "depth20"));
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    expect(feed.status()).toBe("connecting"); // ETH 还没有标记价
    conn("market").onMessage(pick("ethusdt", "markPrice"));
    expect(feed.status()).toBe("ready");
    expect(statuses).toEqual(["ready"]);
  });

  it("单个币对的就绪：收到自己的盘口和标记价就算，不等别的币对", () => {
    const { feed, conn, openBoth } = setup();
    openBoth();
    conn("public").onMessage(pick("btcusdt", "depth20"));
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    expect(feed.symbolReady("BTCUSDT")).toBe(true);
    expect(feed.symbolReady("ETHUSDT")).toBe(false);
    expect(feed.status()).toBe("connecting");
    conn("public").onStateChange!("closed");
    expect(feed.symbolReady("BTCUSDT")).toBe(false);
  });

  it("★ 一条连接断了：degraded；重连后要重新收齐这条连接负责的快照才恢复", () => {
    const { feed, conn, openBoth, snapshots, statuses } = setup();
    openBoth();
    snapshots();
    conn("market").onStateChange!("closed");
    expect(feed.status()).toBe("degraded");

    conn("market").onStateChange!("connecting");
    conn("market").onStateChange!("open");
    expect(feed.status()).toBe("degraded"); // 断线前的标记价不算数
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    conn("market").onMessage(pick("ethusdt", "markPrice"));
    expect(feed.status()).toBe("ready");
    expect(statuses).toEqual(["ready", "degraded", "ready"]);
  });

  it("收到解析不了的推送：这条连接的就绪条件作废，degraded，等下一轮快照", () => {
    const { feed, conn, openBoth, snapshots } = setup();
    openBoth();
    snapshots();
    conn("public").onMessage('{"stream":"btcusdt@depth20@100ms","data":{"e":"depthUpdate","b":"oops"}}');
    expect(feed.status()).toBe("degraded");
    conn("public").onMessage(pick("btcusdt", "depth20"));
    conn("public").onMessage(pick("ethusdt", "depth20"));
    expect(feed.status()).toBe("ready");
  });
});

describe("24 小时统计流（缺口 #47）", () => {
  it("★ ticker 推送解析失败：只记日志，不降级、不停撮合（它只给界面展示用）", () => {
    const { feed, conn, openBoth, snapshots, events } = setup();
    openBoth();
    snapshots();
    expect(feed.status()).toBe("ready");
    const before = events.length;
    conn("market").onMessage('{"stream":"btcusdt@ticker","data":{"e":"24hrTicker","s":"BTCUSDT","q":"oops"}}');
    expect(feed.status()).toBe("ready");
    expect(feed.symbolReady("BTCUSDT")).toBe(true);
    expect(events.length).toBe(before);
  });
});

describe("行情事件", () => {
  it("不管什么状态都往外发（盘口和标记价是恢复就绪的前提）；订阅之外的币对丢掉", () => {
    const { conn, events } = setup(["BTCUSDT"]);
    conn("market").onMessage(pick("btcusdt", "aggTrade"));
    conn("market").onMessage(pick("ethusdt", "aggTrade"));
    expect(events.map((e) => [e.t, e.symbol])).toEqual([["trade", "BTCUSDT"]]);
  });

  it("stop：两条连接都停；主动停掉之后连接关闭不算断线，不报 degraded、不再发事件", () => {
    const { feed, conn, openBoth, snapshots, statuses, events } = setup();
    openBoth();
    snapshots();
    feed.stop();
    expect(conn("public").stopped && conn("market").stopped).toBe(true);
    conn("public").onStateChange!("closed");
    conn("market").onMessage(pick("btcusdt", "aggTrade"));
    expect(statuses).toEqual(["ready"]);
    expect(events.some((e) => e.t === "trade")).toBe(false);
  });
});
