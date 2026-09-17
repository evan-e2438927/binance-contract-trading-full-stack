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
      liquidationFee: "0.012500",
      // 2026-09-17 币安 exchangeInfo 里 BTCUSDT 的原样 filters（MAX_NUM_ORDERS.limit 是数字，其它是字符串）
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "556.80", maxPrice: "4529764", tickSize: "0.10" },
        { filterType: "LOT_SIZE", minQty: "0.001", stepSize: "0.001", maxQty: "1000" },
        { stepSize: "0.001", filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "120" },
        { limit: 200, filterType: "MAX_NUM_ORDERS" },
        { filterType: "MIN_NOTIONAL", notional: "50" },
        { multiplierUp: "1.0500", multiplierDecimal: "4", filterType: "PERCENT_PRICE", multiplierDown: "0.9500" },
      ],
    };

    const mapped = mapExchangeInfoSymbol(raw);

    expect(mapped.tickSize).toBe(10000000n); // 0.10 * 1e8
    expect(mapped.stepSize).toBe(100000n); // 0.001 * 1e8
    expect(mapped.minNotional).toBe(5000000000n); // 50 * 1e8
    expect(mapped).toMatchObject({
      minPrice: 55680000000n, // 556.80
      maxPrice: 452976400000000n, // 4529764
      maxQty: 100000000000n, // 1000
      marketStepSize: 100000n,
      marketMinQty: 100000n,
      marketMaxQty: 12000000000n, // 120
      percentPriceUp: 105000000n, // 1.05
      percentPriceDown: 95000000n, // 0.95
      maxNumOrders: 200,
      liquidationFeeRate: 1250000n, // 0.0125
    });
  });

  it("缺少某个 filter 时抛出明确错误，而不是悄悄给默认值", () => {
    const raw = {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      liquidationFee: "0.012500",
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "0", maxPrice: "0" }],
    };

    expect(() => mapExchangeInfoSymbol(raw)).toThrow(/LOT_SIZE/);
  });
});