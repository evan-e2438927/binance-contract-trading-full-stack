import { describe, expect, it } from "vitest";
import { symbolStatuses } from "../../../../apps/server/src/market/exchange-info";

describe("symbolStatuses", () => {
  it("按传入顺序返回状态；币安没有的记 MISSING", () => {
    const response = { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }, { symbol: "TONUSDT", status: "SETTLING" }] };
    expect(symbolStatuses(response, ["TONUSDT", "BTCUSDT", "FOOUSDT"])).toEqual([
      { symbol: "TONUSDT", status: "SETTLING" },
      { symbol: "BTCUSDT", status: "TRADING" },
      { symbol: "FOOUSDT", status: "MISSING" },
    ]);
  });

  it("响应格式不对就抛错", () => {
    expect(() => symbolStatuses({}, ["BTCUSDT"])).toThrow(/没有 symbols 数组/);
    expect(() => symbolStatuses({ symbols: [{ symbol: 1 }] }, ["BTCUSDT"])).toThrow(/格式不对/);
  });
});
