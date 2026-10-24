import { describe, expect, it } from "vitest";

import { filterSymbols } from "../../../../../../../apps/web/src/app/trade/_ui-components/symbol-bar/filter-symbols";

const list = [
  { symbol: "BTCUSDT", baseAsset: "BTC" },
  { symbol: "BCHUSDT", baseAsset: "BCH" },
  { symbol: "ETHUSDT", baseAsset: "ETH" },
];

describe("filterSymbols", () => {
  it("空串返回全部，保持原顺序", () => {
    expect(filterSymbols(list, "  ").map((s) => s.symbol)).toEqual(["BTCUSDT", "BCHUSDT", "ETHUSDT"]);
  });

  it("按币种名前缀匹配，不分大小写", () => {
    expect(filterSymbols(list, "b").map((s) => s.symbol)).toEqual(["BTCUSDT", "BCHUSDT"]);
    expect(filterSymbols(list, "eth").map((s) => s.symbol)).toEqual(["ETHUSDT"]);
  });

  it("可以输完整币对名，带不带斜杠都行", () => {
    expect(filterSymbols(list, "btc/usdt").map((s) => s.symbol)).toEqual(["BTCUSDT"]);
    expect(filterSymbols(list, "BTCUSDT").map((s) => s.symbol)).toEqual(["BTCUSDT"]);
  });

  it("不按中间子串匹配：usdt 不会匹配到所有币对", () => {
    expect(filterSymbols(list, "usdt")).toEqual([]);
  });
});
