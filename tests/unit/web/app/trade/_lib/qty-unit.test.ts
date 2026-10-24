import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import { convertQtyInput, toBaseQty, toQuoteQty } from "../../../../../../apps/web/src/app/trade/_lib/qty-unit";

const lot = { minQty: parse("0.001"), stepSize: parse("0.001") };

describe("toBaseQty", () => {
  it("按币输入时原样返回", () => {
    expect(toBaseQty("0.01", "BASE", "80000", lot)).toBe("0.01");
  });

  it("按 USDT 输入时换算成币数，向下对齐 stepSize", () => {
    // 1,000 ÷ 80,000 = 0.0125 → 0.012
    expect(toBaseQty("1000", "QUOTE", "80000", lot)).toBe("0.012");
  });

  it("换算结果不足最小下单量时返回空串，不给一个下不进去的数", () => {
    expect(toBaseQty("50", "QUOTE", "80000", lot)).toBe("");
  });

  it("没有价格（行情还没来）就换算不了", () => {
    expect(toBaseQty("1000", "QUOTE", null, lot)).toBe("");
  });

  it("空输入返回空串", () => {
    expect(toBaseQty("  ", "QUOTE", "80000", lot)).toBe("");
  });
});

describe("toQuoteQty", () => {
  it("币数 × 价格", () => {
    expect(toQuoteQty("0.01", "80000")).toBe("800");
  });

  it("没有价格时返回空串", () => {
    expect(toQuoteQty("0.01", null)).toBe("");
  });
});

describe("convertQtyInput", () => {
  it("币 → USDT：金额跟着带过去", () => {
    expect(convertQtyInput("0.01", "BASE", "QUOTE", "80000", lot)).toBe("800");
  });

  it("USDT → 币：换算并对齐", () => {
    expect(convertQtyInput("1000", "QUOTE", "BASE", "80000", lot)).toBe("0.012");
  });

  it("单位没变就不动输入", () => {
    expect(convertQtyInput("0.01", "BASE", "BASE", "80000", lot)).toBe("0.01");
  });

  it("换算不了时清空，让用户重新输", () => {
    expect(convertQtyInput("1000", "QUOTE", "BASE", null, lot)).toBe("");
  });
});
