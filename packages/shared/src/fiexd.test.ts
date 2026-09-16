import { describe, expect, it } from "vitest";
import { SCALE, div, format, mul, parse } from "./fixed";
import { alignPrice, alignQty, divRound, mulCeil } from "./fixed";

describe("fixed", () => {
  it.each([
    ["0", 0n],
    ["50000.25", 5000025000000n],
    ["-50000.25", -5000025000000n],
    ["0.00000001", 1n],
    ["0.000000001", 0n],
    ["92233720368", 9223372036800000000n],
  ] as const)("parse(%s)", (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it("format 补齐 8 位小数", () => {
    expect(format(parse("50000.25"))).toBe("50000.25000000");
  });

  it("format 支持自定义精度", () => {
    expect(format(parse("50000.25"), 2)).toBe("50000.25");
  });

  it("负数往返一致", () => {
    expect(format(parse("-1.5"))).toBe("-1.50000000");
  });

  it("mul: a * b / SCALE", () => {
    expect(mul(parse("2"), parse("3"))).toBe(parse("6"));
    expect(mul(parse("0.1"), parse("0.1"))).toBe(parse("0.01"));
  });

  it("div: a * SCALE / b（截断，不四舍五入）", () => {
    expect(div(parse("6"), parse("3"))).toBe(parse("2"));
    expect(div(parse("2"), parse("3"))).toBe(66666666n); // 0.66666666，第 9 位截断
  });

  it("div 除以零抛错", () => {
    expect(() => div(parse("1"), 0n)).toThrow();
  });

  it("SCALE 是 1e8", () => {
    expect(SCALE).toBe(100_000_000n);
  });
});


describe("mulCeil（手续费向上取整）", () => {
  it("有余数时向上进一", () => {
    // 乘积远小于最小单位，也要收够 1 个最小单位的手续费——摩擦成本不被低估
    expect(mulCeil(parse("0.00000003"), parse("0.00000007"))).toBe(1n);
  });

  it("整除时不受影响", () => {
    expect(mulCeil(parse("2"), parse("3"))).toBe(parse("6"));
  });
});

describe("divRound（四舍五入，用于保证金率/强平价/未实现盈亏）", () => {
  it("1/3 → 0.33333333（第 9 位是 3，舍）", () => {
    expect(divRound(parse("1"), parse("3"))).toBe(parse("0.33333333"));
  });

  it("2/3 → 0.66666667（第 9 位是 6，进），和 div 的截断结果不一样", () => {
    expect(divRound(parse("2"), parse("3"))).toBe(parse("0.66666667"));
    expect(div(parse("2"), parse("3"))).toBe(parse("0.66666666"));
  });
});

describe("alignPrice（买下卖上对齐 tickSize）", () => {
  it("买单向下对齐", () => {
    expect(alignPrice(parse("50000.17"), parse("0.1"), "BUY")).toBe(parse("50000.1"));
  });

  it("卖单向上对齐", () => {
    expect(alignPrice(parse("50000.17"), parse("0.1"), "SELL")).toBe(parse("50000.2"));
  });

  it("已经对齐时原样返回", () => {
    expect(alignPrice(parse("50000.1"), parse("0.1"), "BUY")).toBe(parse("50000.1"));
  });
});

describe("alignQty（向下对齐 stepSize）", () => {
  it("有余数时截掉", () => {
    expect(alignQty(parse("0.567"), parse("0.1"))).toBe(parse("0.5"));
  });
});