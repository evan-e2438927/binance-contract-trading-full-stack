import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import type { SymbolSpec } from "@/server-api-module/market/types";

import { buildPlaceOrderBody, conditionalTypeOf, type OrderFormValues, positionSideOf } from "../../../../../../apps/web/src/app/trade/_lib/order-body";
import { estimateOrder, qtyFromPercent } from "../../../../../../apps/web/src/app/trade/_lib/order-estimate";
import { floorToTick, hasBlockingIssue, validateOrderForm } from "../../../../../../apps/web/src/app/trade/_lib/order-validate";

const spec = {
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tickSize: "0.1",
  minPrice: "556.8",
  maxPrice: "4529784",
  stepSize: "0.001",
  minQty: "0.001",
  maxQty: "1000",
  marketStepSize: "0.001",
  marketMinQty: "0.001",
  marketMaxQty: "120",
  minNotional: "100",
  percentPriceUp: "1.05",
  percentPriceDown: "0.95",
} as unknown as SymbolSpec;

const values = (overrides: Partial<OrderFormValues> = {}): OrderFormValues => ({
  tab: "LIMIT",
  side: "BUY",
  openClose: "OPEN",
  price: "80000",
  triggerPrice: "",
  workingType: "CONTRACT_PRICE",
  conditionalExec: "LIMIT",
  qty: "0.01",
  timeInForce: "GTC",
  reduceOnly: false,
  ...overrides,
});

describe("positionSideOf（05 第 10 节那张表）", () => {
  it("单向模式一律 BOTH", () => {
    expect(positionSideOf("ONE_WAY", "BUY", "OPEN")).toBe("BOTH");
    expect(positionSideOf("ONE_WAY", "SELL", "CLOSE")).toBe("BOTH");
  });

  it("双向模式四种组合", () => {
    expect(positionSideOf("HEDGE", "BUY", "OPEN")).toBe("LONG"); // 开多
    expect(positionSideOf("HEDGE", "SELL", "CLOSE")).toBe("LONG"); // 平多
    expect(positionSideOf("HEDGE", "SELL", "OPEN")).toBe("SHORT"); // 开空
    expect(positionSideOf("HEDGE", "BUY", "CLOSE")).toBe("SHORT"); // 平空
  });
});

describe("conditionalTypeOf", () => {
  const ref = parse("80000");
  it("买：触发价在上面是止损买，在下面是止盈买", () => {
    expect(conditionalTypeOf("BUY", parse("81000"), ref, "MARKET")).toBe("STOP_MARKET");
    expect(conditionalTypeOf("BUY", parse("79000"), ref, "LIMIT")).toBe("TAKE_PROFIT");
  });

  it("卖：触发价在下面是止损卖，在上面是止盈卖", () => {
    expect(conditionalTypeOf("SELL", parse("79000"), ref, "MARKET")).toBe("STOP_MARKET");
    expect(conditionalTypeOf("SELL", parse("81000"), ref, "LIMIT")).toBe("TAKE_PROFIT");
  });
});

describe("buildPlaceOrderBody", () => {
  it("限价单带 timeInForce 和价格", () => {
    const body = buildPlaceOrderBody({
      values: values(),
      symbol: "BTCUSDT",
      positionMode: "ONE_WAY",
      clientOrderId: "c-1",
      referencePrice: null,
      triggerPriceFixed: null,
    });
    expect(body).toMatchObject({
      type: "LIMIT",
      price: "80000",
      qty: "0.01",
      timeInForce: "GTC",
      positionSide: "BOTH",
    });
  });

  it("市价单不带价格和 timeInForce", () => {
    const body = buildPlaceOrderBody({
      values: values({ tab: "MARKET" }),
      symbol: "BTCUSDT",
      positionMode: "ONE_WAY",
      clientOrderId: "c-1",
      referencePrice: null,
      triggerPriceFixed: null,
    });
    expect(body).toMatchObject({ type: "MARKET", qty: "0.01" });
    expect(body).not.toHaveProperty("price");
    expect(body).not.toHaveProperty("timeInForce");
  });

  it("条件单按触发价方向选类型，带上触发价和触发依据", () => {
    const body = buildPlaceOrderBody({
      values: values({
        tab: "CONDITIONAL",
        triggerPrice: "81000",
        conditionalExec: "MARKET",
        workingType: "MARK_PRICE",
      }),
      symbol: "BTCUSDT",
      positionMode: "ONE_WAY",
      clientOrderId: "c-1",
      referencePrice: parse("80000"),
      triggerPriceFixed: parse("81000"),
    });
    expect(body).toMatchObject({ type: "STOP_MARKET", stopPrice: "81000", workingType: "MARK_PRICE" });
  });

  it("条件单缺参照价（行情还没来）返回 null，不瞎猜方向", () => {
    const body = buildPlaceOrderBody({
      values: values({ tab: "CONDITIONAL", triggerPrice: "81000" }),
      symbol: "BTCUSDT",
      positionMode: "ONE_WAY",
      clientOrderId: "c-1",
      referencePrice: null,
      triggerPriceFixed: parse("81000"),
    });
    expect(body).toBeNull();
  });

  it("双向模式不传 reduceOnly（平仓靠 positionSide 表达）", () => {
    const body = buildPlaceOrderBody({
      values: values({ reduceOnly: true, openClose: "CLOSE" }),
      symbol: "BTCUSDT",
      positionMode: "HEDGE",
      clientOrderId: "c-1",
      referencePrice: null,
      triggerPriceFixed: null,
    });
    expect(body?.positionSide).toBe("SHORT");
    expect(body?.reduceOnly).toBeUndefined();
  });
});

describe("validateOrderForm", () => {
  it("合法的限价单没有问题", () => {
    expect(validateOrderForm({ values: values(), spec, markPrice: "80000" })).toEqual({});
  });

  it("价格不是 tickSize 整数倍", () => {
    const issues = validateOrderForm({ values: values({ price: "80000.05" }), spec, markPrice: "80000" });
    expect(issues.price).toContain("0.1");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("数量低于最小下单量", () => {
    expect(validateOrderForm({ values: values({ qty: "0.0005" }), spec, markPrice: "80000" }).qty).toContain(
      "最小下单量",
    );
  });

  it("数量不是 stepSize 整数倍", () => {
    expect(validateOrderForm({ values: values({ qty: "0.0015" }), spec, markPrice: "80000" }).qty).toContain("整数倍");
  });

  it("名义价值低于 minNotional", () => {
    expect(validateOrderForm({ values: values({ qty: "0.001" }), spec, markPrice: "80000" }).qty).toContain("100");
  });

  it("价格偏离标记价太多：只警告，不拦", () => {
    const issues = validateOrderForm({ values: values({ price: "90000" }), spec, markPrice: "80000" });
    expect(issues.warning).toContain("偏离");
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("市价单不要求价格，但要求数量", () => {
    const issues = validateOrderForm({ values: values({ tab: "MARKET", price: "" }), spec, markPrice: "80000" });
    expect(issues.price).toBeUndefined();
    expect(issues.qty).toBeUndefined();
  });

  it("条件单缺触发价", () => {
    expect(validateOrderForm({ values: values({ tab: "CONDITIONAL" }), spec, markPrice: "80000" }).triggerPrice).toBe(
      "请输入触发价",
    );
  });
});

describe("floorToTick", () => {
  it("向下吸附到 tickSize 的整数倍", () => {
    expect(format(floorToTick(parse("80000.17"), parse("0.1")), 8)).toBe(format(parse("80000.1"), 8));
  });
});

describe("estimateOrder", () => {
  it("名义价值 / 保证金 / 手续费", () => {
    const estimate = estimateOrder({ price: "80000", qty: "0.01", leverageNum: 8, takerFeeRate: "0.0005" });
    expect(format(estimate?.notional ?? 0n, 2)).toBe("800.00");
    expect(format(estimate?.margin ?? 0n, 2)).toBe("100.00");
    expect(format(estimate?.fee ?? 0n, 4)).toBe("0.4000");
  });

  it("手续费向上取整，不少算：算出来不足 1 聪也要收 1 聪", () => {
    // 名义价值 0.000001，×0.05% = 0.0000000005，截断会变成 0
    const estimate = estimateOrder({ price: "0.001", qty: "0.001", leverageNum: 1, takerFeeRate: "0.0005" });
    expect(estimate?.fee).toBe(1n);
  });

  it("没有价格或数量时返回 null", () => {
    expect(estimateOrder({ price: null, qty: "0.01", leverageNum: 8, takerFeeRate: "0.0005" })).toBeNull();
    expect(estimateOrder({ price: "80000", qty: "", leverageNum: 8, takerFeeRate: "0.0005" })).toBeNull();
  });
});

describe("qtyFromPercent", () => {
  const lot = { minQty: parse("0.001"), stepSize: parse("0.001") };
  it("按可开最大换算并对齐 stepSize", () => {
    expect(qtyFromPercent("1.234", 50, lot)).toBe("0.617");
    expect(qtyFromPercent("1.234", 100, lot)).toBe("1.234");
  });

  it("可开最大还没回来时不填数", () => {
    expect(qtyFromPercent(null, 50, lot)).toBe("");
    expect(qtyFromPercent("0", 50, lot)).toBe("");
  });

  it("算出来不足最小下单量就不填", () => {
    expect(qtyFromPercent("0.001", 25, lot)).toBe("");
  });
});
