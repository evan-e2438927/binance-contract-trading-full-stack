import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import type { BookLevel } from "@/server-api-module/market/types";

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
  it("给出五档：tickSize 的 1 / 10 / 100 / 1000 / 10000 倍（和币安网页版一致）", () => {
    expect(stepOptions("0.1")).toEqual(["0.1", "1", "10", "100", "1000"]);
    expect(stepOptions("0.001")).toEqual(["0.001", "0.01", "0.1", "1", "10"]);
  });
});
