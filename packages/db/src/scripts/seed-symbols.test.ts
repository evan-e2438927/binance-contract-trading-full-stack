import { describe, expect, it } from "vitest";
import { mapExchangeInfoSymbol } from "./seed-symbols";

describe("mapExchangeInfoSymbol", () => {
  it("把币安 exchangeInfo 的一条 symbol 记录映射成 NewSymbol", () => {
    const raw = {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "556.80", maxPrice: "4529764" },
        { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "1000" },
        { filterType: "MIN_NOTIONAL", notional: "5" },
      ],
    };

    const mapped = mapExchangeInfoSymbol(raw);

    expect(mapped.tickSize).toBe(10000000n); // 0.10 * 1e8
    expect(mapped.stepSize).toBe(100000n); // 0.001 * 1e8
    expect(mapped.minNotional).toBe(500000000n); // 5 * 1e8
  });

  it("缺少某个 filter 时抛出明确错误，而不是悄悄给默认值", () => {
    const raw = {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "0", maxPrice: "0" }],
    };

    expect(() => mapExchangeInfoSymbol(raw)).toThrow(/LOT_SIZE/);
  });
});