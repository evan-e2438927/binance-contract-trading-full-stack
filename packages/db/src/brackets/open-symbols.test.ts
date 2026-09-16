import { describe, expect, it } from "vitest";
import { OPEN_SYMBOLS, openSymbolSetting } from "./open-symbols";

describe("openSymbolSetting", () => {
  it("名单里的币对开放，排序从 1 开始按名单顺序", () => {
    expect(openSymbolSetting("BTCUSDT")).toEqual({ enabled: true, sortOrder: 1 });
    expect(openSymbolSetting("ETHUSDT")).toEqual({ enabled: true, sortOrder: 2 });
  });

  it("名单外的币对关闭，排序归 0", () => {
    expect(openSymbolSetting("PEPEUSDT")).toEqual({ enabled: false, sortOrder: 0 });
  });

  it("名单 20 个且没有重复", () => {
    expect(OPEN_SYMBOLS).toHaveLength(20);
    expect(new Set(OPEN_SYMBOLS).size).toBe(20);
  });
});
