import { parse } from "./fixed";
import { describe, expect, it } from "vitest";

import type { BookLevel } from "./aggregate-book";

import { aggregateSide, bucketPrice, stepOptions } from "./aggregate-book";

const asks: BookLevel[] = [
  ["80715.2", "1"],
  ["80715.3", "2"],
  ["80716.1", "0.5"],
];
const bids: BookLevel[] = [
  ["80715.1", "1"],
  ["80714.9", "2"],
  ["80713.8", "0.5"],
];

describe("bucketPrice", () => {
  it("买盘向下取整、卖盘向上取整", () => {
    expect(bucketPrice(parse("80715.9"), parse("1"), "bid")).toBe(parse("80715"));
    expect(bucketPrice(parse("80715.1"), parse("1"), "ask")).toBe(parse("80716"));
  });

  it("正好落在档位上的价格不动", () => {
    expect(bucketPrice(parse("80715"), parse("1"), "ask")).toBe(parse("80715"));
    expect(bucketPrice(parse("80715"), parse("1"), "bid")).toBe(parse("80715"));
  });

  it("小于 1 的精度也按整数倍归档", () => {
    expect(bucketPrice(parse("80715.24"), parse("0.1"), "bid")).toBe(parse("80715.2"));
    expect(bucketPrice(parse("80715.24"), parse("0.1"), "ask")).toBe(parse("80715.3"));
  });
});

describe("aggregateSide", () => {
  it("精度等于 tickSize 时不合并，累计量逐档累加", () => {
    const rows = aggregateSide(asks, "0.1", "ask");
    expect(rows.map((r) => r.price)).toEqual(["80715.2", "80715.3", "80716.1"]);
    expect(rows.map((r) => r.cumulative)).toEqual(["1", "3", "3.5"]);
  });

  it("合并同一档的数量，顺序仍是最优价在前", () => {
    const rows = aggregateSide(asks, "1", "ask");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ price: "80716", qty: "3", cumulative: "3" });
    expect(rows[1]).toMatchObject({ price: "80717", qty: "0.5", cumulative: "3.5" });
  });

  it("买盘合并方向向下", () => {
    const rows = aggregateSide(bids, "1", "bid");
    expect(rows.map((r) => r.price)).toEqual(["80715", "80714", "80713"]);
    expect(rows.map((r) => r.qty)).toEqual(["1", "2", "0.5"]);
  });

  it("背景条百分比按本侧最大累计量算，最后一行是 100", () => {
    const rows = aggregateSide(asks, "0.1", "ask");
    expect(rows.map((r) => r.percentNum)).toEqual([28, 85, 100]);
  });

  it("空盘口返回空数组，不抛错", () => {
    expect(aggregateSide([], "0.1", "bid")).toEqual([]);
  });

  it("精度不合法时抛错", () => {
    expect(() => aggregateSide(asks, "0", "ask")).toThrow();
  });
});

describe("stepOptions", () => {
  it("★ 只给三档：tickSize 的 1 / 10 / 100 倍", () => {
    expect(stepOptions("0.1")).toEqual(["0.1", "1", "10"]);
    expect(stepOptions("0.001")).toEqual(["0.001", "0.01", "0.1"]);
  });

  it("★ 砍掉的 1000 / 10000 倍档，是因为盘口深度根本喂不满（2026-09-20 实测）", () => {
    // 近端约 1000 档深度：1000 倍精度下只够凑出个位数的桶，给了也是一行
    const dense = Array.from({ length: 1000 }, (_, i) => [(750 - i * 0.01).toFixed(2), "1"] as const);
    expect(aggregateSide(dense, "0.1", "bid", 20)).toHaveLength(20); // tick×10
    expect(aggregateSide(dense, "1", "bid", 20)).toHaveLength(11); // tick×100，还行
    expect(aggregateSide(dense, "10", "bid", 20)).toHaveLength(2); // tick×1000，没法看
    expect(aggregateSide(dense, "100", "bid", 20)).toHaveLength(1); // tick×10000
  });
});

describe("maxRows 截断（2026-09-20）", () => {
  // BNBUSDT 式的密集盘口：tick 0.01，50 档只覆盖 0.5 USDT
  const dense = (n: number, side: "bid" | "ask"): [string, string][] =>
    Array.from({ length: n }, (_, i) => {
      const p = side === "bid" ? 749.5 - i * 0.01 : 749.6 + i * 0.01;
      return [p.toFixed(2), "1"] as [string, string];
    });

  it("★ 先合并再截断：精度放粗不该让行数变少", () => {
    const levels = dense(1000, "bid"); // tick 0.01 × 1000 档 = 覆盖 10 USDT
    expect(aggregateSide(levels, "0.01", "bid", 20)).toHaveLength(20);
    expect(aggregateSide(levels, "0.1", "bid", 20)).toHaveLength(20);
    // 精度 1 只有 11 行：10 USDT 的深度分不出 20 个 1 USDT 的桶。
    // 这是**数据不够**，不是算法问题——要填满得有 20 USDT 深度（约 2000 档）。
    expect(aggregateSide(levels, "1", "bid", 20)).toHaveLength(11);
  });

  it("★ 对照组：先截断再合并（2026-09-20 的老行为）会少得多", () => {
    const levels = dense(1000, "bid");
    // 老链路：WS 只推前 50 档 → 前端再聚合
    const pretruncated = levels.slice(0, 50);
    expect(aggregateSide(pretruncated, "0.1", "bid", 20)).toHaveLength(6);
    expect(aggregateSide(pretruncated, "1", "bid", 20)).toHaveLength(1);
    // 先合并再截断，同样的精度：
    expect(aggregateSide(levels, "0.1", "bid", 20)).toHaveLength(20);
    expect(aggregateSide(levels, "1", "bid", 20)).toHaveLength(11);
  });

  it("★ 精度越粗，同样 20 行覆盖的价格区间越宽", () => {
    const levels = dense(1000, "bid");
    const span = (step: string) => {
      const rows = aggregateSide(levels, step, "bid", 20);
      return Number(rows[0]!.price) - Number(rows.at(-1)!.price);
    };
    expect(span("0.1")).toBeGreaterThan(span("0.01"));
    expect(span("1")).toBeGreaterThan(span("0.1"));
  });

  it("不传 maxRows 就不截断（老行为不变）", () => {
    expect(aggregateSide(dense(30, "bid"), "0.01", "bid")).toHaveLength(30);
  });
});
