import { describe, expect, it } from "vitest";

import {
  decimalsOf,
  direction,
  formatCompact,
  formatDecimal,
  formatPercentValue,
  formatPrice,
  formatQty,
  formatRatioAsPercent,
  formatUsdt,
  PLACEHOLDER,
} from "./number";

const BTC = { tickSize: "0.10000000", stepSize: "0.00100000" };

describe("decimalsOf", () => {
  it("按 tickSize / stepSize 推展示位数", () => {
    expect(decimalsOf("0.10000000")).toBe(1);
    expect(decimalsOf("0.00100000")).toBe(3);
    expect(decimalsOf("1")).toBe(0);
    expect(decimalsOf("1.00000000")).toBe(0);
  });
});

describe("formatDecimal", () => {
  it("千分位 + 四舍五入（走 shared 的 format，不是截断）", () => {
    expect(formatDecimal("1234567.891", 2)).toBe("1,234,567.89");
    expect(formatDecimal("54780.876494", 2)).toBe("54,780.88");
    expect(formatDecimal("-1000", 2)).toBe("-1,000.00");
  });

  it("null / 空串显示占位，不显示 0", () => {
    expect(formatDecimal(null, 2)).toBe(PLACEHOLDER);
    expect(formatDecimal(undefined, 2)).toBe(PLACEHOLDER);
    expect(formatDecimal("", 2)).toBe(PLACEHOLDER);
  });

  it("signed：正数显式带 +，零不带", () => {
    expect(formatDecimal("12.5", 2, { signed: true })).toBe("+12.50");
    expect(formatDecimal("-12.5", 2, { signed: true })).toBe("-12.50");
    expect(formatDecimal("0", 2, { signed: true })).toBe("0.00");
  });
});

describe("formatPrice / formatQty / formatUsdt", () => {
  it("按币对精度", () => {
    expect(formatPrice("65432.1", BTC)).toBe("65,432.1");
    expect(formatQty("0.0105", BTC)).toBe("0.011");
    expect(formatUsdt("10000")).toBe("10,000.00");
    expect(formatUsdt("-4819.28", { signed: true })).toBe("-4,819.28");
  });
});

describe("百分比", () => {
  it("比例 → 百分比，默认带符号", () => {
    expect(formatRatioAsPercent("0.0234")).toBe("+2.34%");
    expect(formatRatioAsPercent("-0.012")).toBe("-1.20%");
    expect(formatRatioAsPercent("0.0001", { precision: 4 })).toBe("+0.0100%");
    expect(formatRatioAsPercent("0.4567", { signed: false })).toBe("45.67%");
    expect(formatRatioAsPercent(null)).toBe(PLACEHOLDER);
  });

  it("已经是百分数的值（币安 priceChangePercent）", () => {
    expect(formatPercentValue("2.34")).toBe("+2.34%");
    expect(formatPercentValue("-0.5")).toBe("-0.50%");
  });
});

describe("formatCompact", () => {
  it("大数缩写", () => {
    expect(formatCompact("1234567890.5")).toBe("1.23B");
    expect(formatCompact("45600000")).toBe("45.60M");
    expect(formatCompact("999")).toBe("999.00");
  });
});

describe("direction", () => {
  it("正负零", () => {
    expect(direction("0.1")).toBe("up");
    expect(direction("-0.1")).toBe("down");
    expect(direction("0")).toBe("flat");
    expect(direction(null)).toBe("flat");
  });
});
