import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import { createLocalBook, type DepthDiff, type DepthSnapshot } from "../../../../apps/server/src/market/local-book";

/**
 * 本地盘口（S01）。规则来自币安《How to manage a local order book correctly》（2026-09-20 核对），
 * 每条规则一条测试。
 */

const level = (price: string, qty: string) => ({ price: parse(price), qty: parse(qty) });

const diff = (overrides: Partial<DepthDiff> & Pick<DepthDiff, "firstUpdateId" | "finalUpdateId" | "prevFinalUpdateId">): DepthDiff => ({
  symbol: "BTCUSDT",
  bids: [],
  asks: [],
  ts: 1,
  ...overrides,
});

const snapshot = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [level("100", "1"), level("99", "2")],
  asks: [level("101", "1"), level("102", "2")],
});

describe("本地盘口", () => {
  it("没有快照时先缓冲，不产出盘口", () => {
    const book = createLocalBook({ levels: 10 });
    expect(book.applyDiff(diff({ firstUpdateId: 5, finalUpdateId: 6, prevFinalUpdateId: 4 }))).toEqual({ t: "buffered" });
    expect(book.live).toBe(false);
  });

  it("快照到了：丢掉过期增量、应用缓冲区，转入 live", () => {
    const book = createLocalBook({ levels: 10 });
    // u < lastUpdateId，过期
    book.applyDiff(diff({ firstUpdateId: 1, finalUpdateId: 5, prevFinalUpdateId: 0 }));
    // 跨过快照：U <= 10 <= u
    book.applyDiff(diff({ firstUpdateId: 9, finalUpdateId: 11, prevFinalUpdateId: 5, bids: [level("100", "3")] }));

    const result = book.applySnapshot(snapshot(10), 99);
    expect(result.t).toBe("book");
    expect(book.live).toBe(true);
    if (result.t !== "book") return;
    // 缓冲区那条把买一改成了 3
    expect(result.bids[0]).toEqual(level("100", "3"));
    expect(result.ts).toBe(99);
  });

  it("数量为 0 表示删掉这一档", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    const result = book.applyDiff(diff({ firstUpdateId: 11, finalUpdateId: 12, prevFinalUpdateId: 10, bids: [level("100", "0")] }));
    expect(result.t).toBe("book");
    if (result.t !== "book") return;
    expect(result.bids.map((l) => l.price)).toEqual([parse("99")]);
  });

  it("数量是绝对值，不是增减", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    const result = book.applyDiff(diff({ firstUpdateId: 11, finalUpdateId: 12, prevFinalUpdateId: 10, bids: [level("100", "7")] }));
    if (result.t !== "book") return;
    expect(result.bids[0]).toEqual(level("100", "7"));
  });

  it("pu 接不上上一条的 u：要求重新拉快照，并且不再产出盘口", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    const result = book.applyDiff(diff({ firstUpdateId: 20, finalUpdateId: 21, prevFinalUpdateId: 19 }));
    expect(result.t).toBe("resync");
    expect(book.live).toBe(false);
    // 断了之后的推送重新缓冲，等新快照
    expect(book.applyDiff(diff({ firstUpdateId: 22, finalUpdateId: 23, prevFinalUpdateId: 21 }))).toEqual({ t: "buffered" });
  });

  it("快照比缓冲区还旧（第一条增量跨不过快照）：这份快照不用，等下一份", () => {
    const book = createLocalBook({ levels: 10 });
    book.applyDiff(diff({ firstUpdateId: 30, finalUpdateId: 31, prevFinalUpdateId: 29 }));
    const result = book.applySnapshot(snapshot(10), 1);
    expect(result.t).toBe("resync");
    expect(book.live).toBe(false);
  });

  it("缓冲区里的增量不连续也要重来", () => {
    const book = createLocalBook({ levels: 10 });
    book.applyDiff(diff({ firstUpdateId: 9, finalUpdateId: 11, prevFinalUpdateId: 8 }));
    book.applyDiff(diff({ firstUpdateId: 15, finalUpdateId: 16, prevFinalUpdateId: 14 })); // 中间掉了包
    expect(book.applySnapshot(snapshot(10), 1).t).toBe("resync");
  });

  it("买盘从高到低、卖盘从低到高，并按档数截断", () => {
    const book = createLocalBook({ levels: 2 });
    book.applySnapshot(
      {
        lastUpdateId: 1,
        bids: [level("98", "1"), level("100", "1"), level("99", "1")],
        asks: [level("103", "1"), level("101", "1"), level("102", "1")],
      },
      1,
    );
    const result = book.applyDiff(diff({ firstUpdateId: 2, finalUpdateId: 3, prevFinalUpdateId: 1 }));
    if (result.t !== "book") return;
    expect(result.bids.map((l) => l.price)).toEqual([parse("100"), parse("99")]);
    expect(result.asks.map((l) => l.price)).toEqual([parse("101"), parse("102")]);
  });

  it("★ 快照比流还新（REST 跑在 WS 前面）：下一条增量按跨越规则接，不判断档、不白拉一次快照", () => {
    const book = createLocalBook({ levels: 10 });
    // 流先到 u=120；覆盖 121..130 的那条还在路上
    expect(book.applyDiff(diff({ firstUpdateId: 111, finalUpdateId: 120, prevFinalUpdateId: 110 })).t).toBe("buffered");
    // 快照回来 lastUpdateId=130，比缓冲区里所有的 u 都新 → 缓冲区一条都接不上
    expect(book.applySnapshot(snapshot(130), 1).t).toBe("book");
    // 那条推送到了：U=121 <= 130 <= u=130，正好跨过快照，应该直接接上
    expect(book.applyDiff(diff({ firstUpdateId: 121, finalUpdateId: 130, prevFinalUpdateId: 120 })).t).toBe("book");
    // 接上之后回到 pu 规则
    expect(book.applyDiff(diff({ firstUpdateId: 131, finalUpdateId: 140, prevFinalUpdateId: 130 })).t).toBe("book");
  });

  it("★ 快照比流还新时，整条都比快照旧的增量丢掉就行（第 4 条），不触发重拉", () => {
    const book = createLocalBook({ levels: 10 });
    expect(book.applyDiff(diff({ firstUpdateId: 111, finalUpdateId: 120, prevFinalUpdateId: 110 })).t).toBe("buffered");
    expect(book.applySnapshot(snapshot(130), 1).t).toBe("book");
    // 迟到的旧推送（u=125 < 130）：丢掉，不是断档
    expect(book.applyDiff(diff({ firstUpdateId: 121, finalUpdateId: 125, prevFinalUpdateId: 120 }))).toEqual({ t: "skipped" });
    expect(book.live).toBe(true);
  });

  it("★ 快照之后第一条真的断了（U 已经越过快照）才重拉", () => {
    const book = createLocalBook({ levels: 10 });
    expect(book.applyDiff(diff({ firstUpdateId: 111, finalUpdateId: 120, prevFinalUpdateId: 110 })).t).toBe("buffered");
    expect(book.applySnapshot(snapshot(130), 1).t).toBe("book");
    // U=140 > 130：131..139 那段永远看不到了，这才是真断档
    const result = book.applyDiff(diff({ firstUpdateId: 140, finalUpdateId: 150, prevFinalUpdateId: 139 }));
    expect(result.t).toBe("resync");
  });

  it("★ 断档日志里的 lastUpdateId 是断档时的真实值，不是 clear() 之后的 -1", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    // 先正常接上一条，离开 awaitingFirst，后面才走第 6 条的 pu 规则
    expect(book.applyDiff(diff({ firstUpdateId: 11, finalUpdateId: 15, prevFinalUpdateId: 10 })).t).toBe("book");
    const result = book.applyDiff(diff({ firstUpdateId: 20, finalUpdateId: 25, prevFinalUpdateId: 19 }));
    if (result.t !== "resync") throw new Error("应该是 resync");
    expect(result.reason).toContain("本地 lastUpdateId=15");
    expect(result.reason).not.toContain("-1");
  });

  it("reset 之后回到等快照状态", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    book.reset();
    expect(book.live).toBe(false);
    expect(book.applyDiff(diff({ firstUpdateId: 11, finalUpdateId: 12, prevFinalUpdateId: 10 }))).toEqual({ t: "buffered" });
  });
});
