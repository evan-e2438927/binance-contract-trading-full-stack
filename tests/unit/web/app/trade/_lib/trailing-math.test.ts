import { describe, expect, it } from "vitest";

import { activationPriceError, callbackRateError, stopLineFrom } from "../../../../../../apps/web/src/app/trade/_lib/trailing-math";

describe("callbackRateError", () => {
  it("范围内没问题", () => {
    expect(callbackRateError("0.1")).toBeNull();
    expect(callbackRateError("1")).toBeNull();
    expect(callbackRateError("10")).toBeNull();
  });

  it("超出币安允许的 0.1% ~ 10%", () => {
    expect(callbackRateError("0.05")).toMatch("0.1% ~ 10%");
    expect(callbackRateError("10.1")).toMatch("0.1% ~ 10%");
  });

  it("空的、非数字都拦住", () => {
    expect(callbackRateError("")).toBe("请填回调率");
    expect(callbackRateError("一点点")).toBe("回调率只能是数字");
  });
});

describe("stopLineFrom", () => {
  it("卖单的止损线在下方", () => {
    expect(stopLineFrom("52000", "1", "SELL")).toBe("51480.00000000");
  });

  it("买单的触发线在上方", () => {
    expect(stopLineFrom("48000", "1", "BUY")).toBe("48480.00000000");
  });

  it("回调率不合法时不给数（宁可不显示，也不显示个错的）", () => {
    expect(stopLineFrom("52000", "20", "SELL")).toBeNull();
    expect(stopLineFrom("52000", "", "SELL")).toBeNull();
  });
});

describe("activationPriceError", () => {
  it("不填是合法的：等于从现在开始跟", () => {
    expect(activationPriceError("", "50000", "SELL")).toBeNull();
  });

  it("卖单激活价要高于现价", () => {
    expect(activationPriceError("49000", "50000", "SELL")).toMatch("高于");
    expect(activationPriceError("51000", "50000", "SELL")).toBeNull();
  });

  it("买单激活价要低于现价", () => {
    expect(activationPriceError("51000", "50000", "BUY")).toMatch("低于");
    expect(activationPriceError("49000", "50000", "BUY")).toBeNull();
  });

  it("拿不到现价就不判方向（不编）", () => {
    expect(activationPriceError("49000", null, "SELL")).toBeNull();
  });
});
