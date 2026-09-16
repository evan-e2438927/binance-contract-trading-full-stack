import { describe, expect, it } from "vitest";
import {
  checkContinuity,
  normalizeSymbolBrackets,
  toDecimalString,
  type OfficialBracket,
  type OfficialSymbolBrackets,
} from "./normalize";

/**
 * 形状照抄官方 GET /fapi/v1/leverageBracket 的返回。
 * 数值是自洽的示例（边界上维持保证金相等），不是币安当前的真实表——
 * 真实表会变，测试不跟着它走。
 */
function officialBTC(): OfficialSymbolBrackets {
  return {
    symbol: "BTCUSDT",
    brackets: [
      { bracket: 1, initialLeverage: 150, notionalCap: 300000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
      { bracket: 2, initialLeverage: 100, notionalCap: 800000, notionalFloor: 300000, maintMarginRatio: 0.005, cum: 300 },
      { bracket: 3, initialLeverage: 75, notionalCap: 3000000, notionalFloor: 800000, maintMarginRatio: 0.0065, cum: 1500 },
    ],
  };
}

function withBracket(index: number, patch: Partial<OfficialBracket>): OfficialSymbolBrackets {
  const entry = officialBTC();
  const target = entry.brackets[index];
  if (!target) throw new Error("fixture index out of range");
  entry.brackets[index] = { ...target, ...patch };
  return entry;
}

describe("toDecimalString", () => {
  it("整数和普通小数原样转成字符串", () => {
    expect(toDecimalString(300000, "BTCUSDT", "notionalCap")).toBe("300000");
    expect(toDecimalString(0.004, "BTCUSDT", "mmr")).toBe("0.004");
    expect(toDecimalString(0, "BTCUSDT", "cum")).toBe("0");
  });

  it("超过 8 位小数（浮点尾巴）直接拒绝，不悄悄截断", () => {
    // 0.1 + 0.2 === 0.30000000000000004，典型的浮点尾巴
    expect(() => toDecimalString(0.1 + 0.2, "BTCUSDT", "mmr")).toThrow(/小数位超过 8/);
    expect(() => toDecimalString(0.123456789, "BTCUSDT", "mmr")).toThrow(/小数位超过 8/);
  });

  it("科学计数法拒绝", () => {
    expect(() => toDecimalString(1e21, "BTCUSDT", "notionalCap")).toThrow(/科学计数法/);
    expect(() => toDecimalString(1e-9, "BTCUSDT", "mmr")).toThrow(/科学计数法/);
  });

  it("非数字、NaN、Infinity 拒绝", () => {
    expect(() => toDecimalString("0.004", "BTCUSDT", "mmr")).toThrow(/不是有限数/);
    expect(() => toDecimalString(Number.NaN, "BTCUSDT", "mmr")).toThrow(/不是有限数/);
    expect(() => toDecimalString(Number.POSITIVE_INFINITY, "BTCUSDT", "mmr")).toThrow(/不是有限数/);
  });
});

describe("normalizeSymbolBrackets", () => {
  it("把官方返回转成按层号升序的 BracketRow[]", () => {
    const rows = normalizeSymbolBrackets(officialBTC());
    expect(rows).toEqual([
      { bracket: 1, notionalFloor: "0", notionalCap: "300000", maxLeverage: 150, mmr: "0.004", cum: "0" },
      { bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300" },
      { bracket: 3, notionalFloor: "800000", notionalCap: "3000000", maxLeverage: 75, mmr: "0.0065", cum: "1500" },
    ]);
  });

  it("返回顺序打乱时按层号排好", () => {
    const entry = officialBTC();
    entry.brackets.reverse();
    expect(normalizeSymbolBrackets(entry).map((r) => r.bracket)).toEqual([1, 2, 3]);
  });

  it("notionalCoef 为 1 视为公开表，放行", () => {
    expect(() => normalizeSymbolBrackets({ ...officialBTC(), notionalCoef: 1 })).not.toThrow();
  });

  it("notionalCoef ≠ 1 说明账户被个性化调整，拒绝", () => {
    expect(() => normalizeSymbolBrackets({ ...officialBTC(), notionalCoef: 1.5 })).toThrow(/notionalCoef/);
  });

  it("空分层表拒绝", () => {
    expect(() => normalizeSymbolBrackets({ symbol: "BTCUSDT", brackets: [] })).toThrow(/没有分层/);
  });

  it("层号不连续拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(2, { bracket: 4 }))).toThrow(/层号不连续/);
  });

  it("第 1 层下限不是 0 拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { notionalFloor: 10 }))).toThrow(/第 1 层的下限/);
  });

  it("下限和上一层上限接不上拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { notionalFloor: 250000 }))).toThrow(/没有接上/);
  });

  it("上限不大于下限拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(2, { notionalCap: 800000 }))).toThrow(/上限必须大于下限/);
  });

  it("最大杠杆不是正整数拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { initialLeverage: 0 }))).toThrow(/最大杠杆/);
    expect(() => normalizeSymbolBrackets(withBracket(0, { initialLeverage: 12.5 }))).toThrow(/最大杠杆/);
  });

  it("最大杠杆逐层上升拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { initialLeverage: 200 }))).toThrow(/杠杆不应高于上一层/);
  });

  it("维持保证金率逐层下降拒绝", () => {
    // 同时调 cum 让边界仍然连续，确保是"mmr 下降"这条规则在起作用
    expect(() =>
      normalizeSymbolBrackets(withBracket(1, { maintMarginRatio: 0.003, cum: -300 })),
    ).toThrow(/维持保证金率不应低于上一层/);
  });

  it("维持保证金率不在 (0, 1) 拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { maintMarginRatio: 0 }))).toThrow(/维持保证金率/);
  });

  it("速算额为负拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { cum: -1 }))).toThrow(/速算额/);
  });

  it("边界上维持保证金不连续拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { cum: 301 }))).toThrow(/连续性/);
  });
});

describe("checkContinuity", () => {
  it("连续的表通过", () => {
    expect(checkContinuity(normalizeSymbolBrackets(officialBTC()))).toEqual({ ok: true, mismatches: [] });
  });

  it("报告出不连续的那一层", () => {
    const rows = normalizeSymbolBrackets(officialBTC());
    const broken = rows.map((r) => (r.bracket === 3 ? { ...r, cum: "1499" } : r));
    expect(checkContinuity(broken)).toEqual({ ok: false, mismatches: [{ atBracket: 2 }] });
  });
});
