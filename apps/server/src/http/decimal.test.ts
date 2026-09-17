import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { decimalInput, toDecimal } from "./decimal";

describe("数值进出 JSON 边界", () => {
  const qty = decimalInput("qty");

  it("收字符串形式的非负十进制数，最多 8 位小数", () => {
    expect(qty.parse("0.01")).toBe(parse("0.01"));
    expect(qty.parse("50000")).toBe(parse("50000"));
    expect(qty.parse("0.12345678")).toBe(12345678n);
  });

  it("★ 第 9 位小数拒绝，不静默截断（shared 的 parse 会截断成 0.12345678）", () => {
    expect(qty.safeParse("0.123456789").success).toBe(false);
  });

  it("不收 JSON 数字、负数、科学计数法、前导 0、空格、空串", () => {
    for (const bad of [0.1, 1, "-1", "1e3", "01.5", " 1", "1.", ".5", ""]) {
      expect(qty.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(qty.safeParse(0.1).error!.issues[0]!.message).toContain("字符串");
  });

  it("输出：精确到 8 位，去掉末尾 0", () => {
    expect(toDecimal(parse("50000.25"))).toBe("50000.25");
    expect(toDecimal(parse("50000"))).toBe("50000");
    expect(toDecimal(0n)).toBe("0");
    expect(toDecimal(parse("-12.5"))).toBe("-12.5");
    expect(toDecimal(1n)).toBe("0.00000001");
    expect(toDecimal(parse("100.10"))).toBe("100.1");
  });
});
