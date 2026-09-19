import { describe, expect, it } from "vitest";

import { maxLeverageOf } from "./stats";

describe("maxLeverageOf", () => {
  it("取最大杠杆和对应币种", () => {
    expect(
      maxLeverageOf([
        { baseAsset: "ETH", maxLeverage: 100 },
        { baseAsset: "BTC", maxLeverage: 125 },
        { baseAsset: "SOL", maxLeverage: 75 },
      ]),
    ).toEqual({ maxLeverage: 125, baseAsset: "BTC" });
  });

  it("并列时取列表里靠前的", () => {
    expect(
      maxLeverageOf([
        { baseAsset: "BTC", maxLeverage: 125 },
        { baseAsset: "ETH", maxLeverage: 125 },
      ]),
    ).toEqual({ maxLeverage: 125, baseAsset: "BTC" });
  });

  it("分层表还没同步（maxLeverage 为 null）的跳过；全都没有时返回 null", () => {
    expect(maxLeverageOf([{ baseAsset: "BTC", maxLeverage: null }])).toBeNull();
    expect(
      maxLeverageOf([
        { baseAsset: "BTC", maxLeverage: null },
        { baseAsset: "ETH", maxLeverage: 20 },
      ]),
    ).toEqual({ maxLeverage: 20, baseAsset: "ETH" });
  });

  it("空数组返回 null", () => {
    expect(maxLeverageOf([])).toBeNull();
  });
});
