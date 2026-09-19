import { describe, expect, it } from "vitest";

import { isNavActive, NAV_ITEMS } from "./nav-match";

const byLabel = (label: string) => {
  const item = NAV_ITEMS.find((i) => i.label === label);
  if (!item) throw new Error(`没有导航项 ${label}`);
  return item;
};

describe("isNavActive", () => {
  it("首页只在 / 完全匹配时高亮", () => {
    expect(isNavActive("/", byLabel("首页"))).toBe(true);
    expect(isNavActive("/trade/BTCUSDT", byLabel("首页"))).toBe(false);
  });

  it("交易页任意币对都高亮「交易」", () => {
    expect(isNavActive("/trade/ETHUSDT", byLabel("交易"))).toBe(true);
    expect(isNavActive("/trade", byLabel("交易"))).toBe(true);
  });

  it("前缀匹配要按路径段，不能把 /orders-x 当成 /orders", () => {
    expect(isNavActive("/orders", byLabel("订单"))).toBe(true);
    expect(isNavActive("/orders-x", byLabel("订单"))).toBe(false);
  });

  it("导航顺序和文案按设计稿", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["首页", "交易", "订单", "排行榜", "规则"]);
  });
});
