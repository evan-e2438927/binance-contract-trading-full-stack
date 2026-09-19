import { describe, expect, it } from "vitest";

import { tradeSymbolOf } from "./header-ticker";

describe("tradeSymbolOf", () => {
  it("交易页取出币对并转大写", () => {
    expect(tradeSymbolOf("/trade/btcusdt")).toBe("BTCUSDT");
    expect(tradeSymbolOf("/trade/ETHUSDT/")).toBe("ETHUSDT");
  });

  it("其它页面返回 null", () => {
    expect(tradeSymbolOf("/")).toBeNull();
    expect(tradeSymbolOf("/trade")).toBeNull();
    expect(tradeSymbolOf("/orders")).toBeNull();
    expect(tradeSymbolOf("/trade/BTCUSDT/extra")).toBeNull();
  });
});
