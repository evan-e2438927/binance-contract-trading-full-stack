import { describe, expect, it } from "vitest";

import type { SymbolSpec } from "@/server-api-module/market/types";

import { priceText, qtyText } from "../../../../../../apps/web/src/app/orders/_lib/format-cell";

const spec = { tickSize: "0.10000000", stepSize: "0.00100000" } as SymbolSpec;

describe("priceText / qtyText", () => {
  it("有币对规格时按 tickSize / stepSize 的位数", () => {
    expect(priceText("50000.46000000", spec)).toBe("50,000.5");
    expect(qtyText("1.23456000", spec)).toBe("1.235");
  });

  it("币对已下架、查不到规格时按这个数自己的位数显示，不显示 --", () => {
    expect(priceText("5.12300000")).toBe("5.123");
    expect(qtyText("1000.50000000")).toBe("1,000.5");
  });

  it("null 才显示 --", () => {
    expect(priceText(null, spec)).toBe("--");
    expect(qtyText(undefined)).toBe("--");
  });
});
