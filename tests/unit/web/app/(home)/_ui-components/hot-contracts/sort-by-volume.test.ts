import { describe, expect, it } from "vitest";

import { sortByVolume } from "../../../../../../../apps/web/src/app/(home)/_ui-components/hot-contracts/sort-by-volume";

describe("sortByVolume", () => {
  it("按 24h 成交额从高到低", () => {
    expect(
      sortByVolume([
        { symbol: "ETHUSDT", quoteVolume: "3250000000.5" },
        { symbol: "BTCUSDT", quoteVolume: "16950000000" },
        { symbol: "BNBUSDT", quoteVolume: "272580000" },
      ]),
    ).toEqual(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
  });

  it("没有成交额（null / undefined / 空串）的排最后，彼此按字母序", () => {
    expect(
      sortByVolume([
        { symbol: "XRPUSDT", quoteVolume: null },
        { symbol: "ADAUSDT", quoteVolume: undefined },
        { symbol: "SOLUSDT", quoteVolume: "1" },
        { symbol: "DOGEUSDT", quoteVolume: "" },
      ]),
    ).toEqual(["SOLUSDT", "ADAUSDT", "DOGEUSDT", "XRPUSDT"]);
  });

  it("成交额相同按字母序，结果稳定", () => {
    expect(
      sortByVolume([
        { symbol: "B", quoteVolume: "5" },
        { symbol: "A", quoteVolume: "5.00000000" },
      ]),
    ).toEqual(["A", "B"]);
  });

  it("超过 2^53 的数也能比对（走 bigint，不走 Number）", () => {
    expect(
      sortByVolume([
        { symbol: "LOW", quoteVolume: "90071992547409.93" },
        { symbol: "HIGH", quoteVolume: "90071992547409.94" },
      ]),
    ).toEqual(["HIGH", "LOW"]);
  });

  it("空数组", () => {
    expect(sortByVolume([])).toEqual([]);
  });
});
