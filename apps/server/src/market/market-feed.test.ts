import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionOptions } from "./connection";
import { startMarketFeed, type FeedEvent, type FeedStatus } from "./market-feed";


const lines = readFileSync(new URL("./__fixtures__/binance-streams-2026-09-17.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

/** 2026-09-20 抓的增量深度推送（S01）。每个币对取第一条，快照的 lastUpdateId 按它的 U 给，正好接得上 */
const depthLines = readFileSync(new URL("./__fixtures__/binance-depth-diff-2026-09-20.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

const depthDiff = (symbol: string) => depthLines.find((l) => (JSON.parse(l) as { stream: string }).stream.startsWith(symbol))!;
const firstUpdateIdOf = (symbol: string) => (JSON.parse(depthDiff(symbol)) as { data: { U: number } }).data.U;

/** 等本地盘口那几个 Promise 跑完（拉快照是异步的） */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const pick = (symbol: string, kind: string) =>
  lines.find((l) => (JSON.parse(l) as { stream: string }).stream.startsWith(`${symbol}@${kind}`))!;

const silent = { log: () => {}, error: () => {} };

/** 假连接：记下 market-feed 给的回调，测试手动推状态和消息 */
function setup(symbols = ["BTCUSDT", "ETHUSDT"], overrides: Partial<Parameters<typeof startMarketFeed>[0]> = {}) {
  const connections = new Map<string, ConnectionOptions & { stopped: boolean }>();
  const events: FeedEvent[] = [];
  const statuses: FeedStatus[] = [];
  // S01：盘口靠"增量流 + REST 快照"合成，测试里给一份固定快照，序列号从 0 开始接得上任何增量
  const snapshotCalls: { symbol: string; limit: number }[] = [];
  const feed = startMarketFeed({
    symbols,
    logger: silent,
    snapshotGapMs: 0,
    fetchDepthSnapshot: async (symbol, limit) => {
      snapshotCalls.push({ symbol, limit });
      return { lastUpdateId: firstUpdateIdOf(symbol.toLowerCase()), bids: [], asks: [] };
    },
    ...overrides,
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
  /** 收齐一轮：两个币对的增量（触发拉快照）+ 标记价 */
  const snapshots = async () => {
    conn("public").onMessage(depthDiff("btcusdt"));
    conn("public").onMessage(depthDiff("ethusdt"));
    await flush();
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    conn("market").onMessage(pick("ethusdt", "markPrice"));
  };
  return { feed, conn, events, statuses, openBoth, snapshots, snapshotCalls };
}

describe("行情状态", () => {
  it("两条连接地址：盘口走 /public，成交、标记价、K 线走 /market（缺口 #22）", () => {
    const { conn } = setup();
    expect(conn("public").url).toBe(
      "wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms/ethusdt@depth@100ms",
    );
    expect(conn("market").url).toBe(
      "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@markPrice@1s/btcusdt@kline_1m/btcusdt@ticker/ethusdt@aggTrade/ethusdt@markPrice@1s/ethusdt@kline_1m/ethusdt@ticker",
    );
  });

  it("连上还不算就绪：每个币对都收到过盘口和标记价才 ready", async () => {
    const { feed, conn, openBoth, statuses } = setup();
    openBoth();
    expect(feed.status()).toBe("connecting");
    conn("public").onMessage(depthDiff("btcusdt"));
    conn("public").onMessage(depthDiff("ethusdt"));
    await flush();
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    expect(feed.status()).toBe("connecting"); // ETH 还没有标记价
    conn("market").onMessage(pick("ethusdt", "markPrice"));
    expect(feed.status()).toBe("ready");
    expect(statuses).toEqual(["ready"]);
  });

  it("★ S01：先收到增量 → 去拉一份 1000 档快照 → 合成完整盘口发给引擎", async () => {
    const { conn, openBoth, events, snapshotCalls } = setup(["BTCUSDT"]);
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    // 还没有快照：先缓冲，不发盘口
    expect(events.some((e) => e.t === "book")).toBe(false);
    expect(snapshotCalls).toEqual([{ symbol: "BTCUSDT", limit: 1000 }]);
    await flush();
    const book = events.find((e) => e.t === "book");
    expect(book).toBeDefined();
    // 外面看到的还是 book 事件，不是 depthDiff
    expect(events.some((e) => (e as { t: string }).t === "depthDiff")).toBe(false);
  });

  it("单个币对的就绪：收到自己的盘口和标记价就算，不等别的币对", async () => {
    const { feed, conn, openBoth } = setup();
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    conn("market").onMessage(pick("btcusdt", "markPrice"));
    expect(feed.symbolReady("BTCUSDT")).toBe(true);
    expect(feed.symbolReady("ETHUSDT")).toBe(false);
    expect(feed.status()).toBe("connecting");
    conn("public").onStateChange!("closed");
    expect(feed.symbolReady("BTCUSDT")).toBe(false);
  });

  it("★ 一条连接断了：degraded；重连后要重新收齐这条连接负责的快照才恢复", async () => {
    const { feed, conn, openBoth, snapshots, statuses } = setup();
    openBoth();
    await snapshots();
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

  it("收到解析不了的推送：这条连接的就绪条件作废，degraded，等下一轮快照", async () => {
    const { feed, conn, openBoth, snapshots } = setup();
    openBoth();
    await snapshots();
    conn("public").onMessage('{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","b":"oops"}}');
    expect(feed.status()).toBe("degraded");
    // 解析失败会把本地盘口也作废，要重新拉快照才恢复
    conn("public").onMessage(depthDiff("btcusdt"));
    conn("public").onMessage(depthDiff("ethusdt"));
    await flush();
    expect(feed.status()).toBe("ready");
  });
});

describe("快照限速（S01，2026-09-20 踩坑）", () => {
  it("★ 多个币对同时要快照：排队按间隔发，不会一起打过去（一起发会被币安封 IP）", async () => {
    const inflight: string[] = [];
    let maxConcurrent = 0;
    const { conn, openBoth } = setup(["BTCUSDT", "ETHUSDT"], {
      snapshotGapMs: 0,
      fetchDepthSnapshot: async (symbol) => {
        inflight.push(symbol);
        maxConcurrent = Math.max(maxConcurrent, inflight.length);
        await Promise.resolve();
        inflight.length = 0;
        return { lastUpdateId: firstUpdateIdOf(symbol.toLowerCase()), bids: [], asks: [] };
      },
    });
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    conn("public").onMessage(depthDiff("ethusdt"));
    await flush();
    expect(maxConcurrent).toBe(1);
  });

  it("★ 拉失败按指数退避，不是每秒重试（被限流时再定频打过去会越封越久）", async () => {
    const waits: number[] = [];
    const timers: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      timers.push(fn);
      return waits.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const { conn, openBoth } = setup(["BTCUSDT"], {
      snapshotGapMs: 0,
      fetchDepthSnapshot: async () => {
        throw new Error("被限流");
      },
    });
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    // 第一次失败排 1 秒
    expect(waits).toEqual([1000]);
    timers[0]!();
    await flush();
    // 第二次翻倍
    expect(waits).toEqual([1000, 2000]);
    vi.restoreAllMocks();
  });

  it("★ 退避期间来的增量不会把快照重新排队（否则被封期间队列一直满，解封瞬间满速冲出去二次被封）", async () => {
    const timers: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      timers.push(fn);
      return timers.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    let calls = 0;
    const { conn, openBoth } = setup(["BTCUSDT"], {
      snapshotGapMs: 0,
      fetchDepthSnapshot: async () => {
        calls++;
        throw new Error("被限流");
      },
    });
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    expect(calls).toBe(1);

    // 盘口没对齐，增量每 100ms 还在来：退避没到期之前一次都不许再发
    for (let i = 0; i < 20; i++) conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    expect(calls).toBe(1);

    // 退避到期才轮到下一次
    timers[0]!();
    await flush();
    expect(calls).toBe(2);
    vi.restoreAllMocks();
  });

  it("★ 盘口连接重连之后立刻重拉，不被断线前的退避挡住（退避状态跟着本地盘口一起作废）", async () => {
    const timers: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      timers.push(fn);
      return timers.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    let calls = 0;
    const { conn, openBoth } = setup(["BTCUSDT"], {
      snapshotGapMs: 0,
      fetchDepthSnapshot: async () => {
        calls++;
        throw new Error("被限流");
      },
    });
    openBoth();
    conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    expect(calls).toBe(1); // 进入退避

    // 盘口那条断了又接上：本地盘口已作废，新的增量必须立刻触发一次新快照
    conn("public").onStateChange!("closed");
    conn("public").onStateChange!("open");
    conn("public").onMessage(depthDiff("btcusdt"));
    await flush();
    expect(calls).toBe(2);
    vi.restoreAllMocks();
  });
});

describe("24 小时统计流（缺口 #47）", () => {
  it("★ ticker 推送解析失败：只记日志，不降级、不停撮合（它只给界面展示用）", async () => {
    const { feed, conn, openBoth, snapshots, events } = setup();
    openBoth();
    await snapshots();
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

  it("stop：两条连接都停；主动停掉之后连接关闭不算断线，不报 degraded、不再发事件", async () => {
    const { feed, conn, openBoth, snapshots, statuses, events } = setup();
    openBoth();
    await snapshots();
    feed.stop();
    expect(conn("public").stopped && conn("market").stopped).toBe(true);
    conn("public").onStateChange!("closed");
    conn("market").onMessage(pick("btcusdt", "aggTrade"));
    expect(statuses).toEqual(["ready"]);
    expect(events.some((e) => e.t === "trade")).toBe(false);
  });
});
