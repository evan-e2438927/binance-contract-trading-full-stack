import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import { createLocalBook, type DepthDiff, type DepthSnapshot } from "./local-book";

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

  it("reset 之后回到等快照状态", () => {
    const book = createLocalBook({ levels: 10 });
    book.applySnapshot(snapshot(10), 1);
    book.reset();
    expect(book.live).toBe(false);
    expect(book.applyDiff(diff({ firstUpdateId: 11, finalUpdateId: 12, prevFinalUpdateId: 10 }))).toEqual({ t: "buffered" });
  });
});
