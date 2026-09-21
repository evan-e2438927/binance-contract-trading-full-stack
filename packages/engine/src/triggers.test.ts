import { parse, type MarginMode, type OrderSide, type OrderType } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { T0, bookInput, markPriceInput, orderRequest, placeOrderInput, registerAccountInput, testConfig } from "./testing/fixtures";
import { createTestEngine } from "./testing/harness";
import type { EngineConfig, EngineEvent, PlaceOrderRequest } from "./types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架（不变式 ①～⑨ + 回滚自检）
// 盘口：买 49,999.9 / 49,999.5 / 49,999，卖 50,000 / 50,000.5 / 50,001；标记价、最新价都是 50,000
// ─────────────────────────────────────────────────────────────

const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

function setup({ wallet = "100000", config = testConfig(), marginMode = "CROSS" as MarginMode, leverageNum = 20 } = {}) {
  const t = createTestEngine(config as EngineConfig);
  t.apply(registerAccountInput("acc-1", wallet));
  t.apply(bookInput());
  t.apply(markPriceInput("50000"));
  if (marginMode !== "CROSS") t.apply({ t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode: marginMode, ts: T0 });
  if (leverageNum !== 20) t.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum, ts: T0 });
  let tradeId = 0;
  let seq = 0;
  const trade = (price: string) =>
    t.apply({ t: "trade", symbol: "BTCUSDT", tradeId: ++tradeId, price: parse(price), qty: parse("0.001"), buyerIsMaker: false, ts: T0 + tradeId });
  trade("50000");
  return {
    t,
    trade,
    mark: (price: string) => t.apply(markPriceInput(price, T0 + 100)),
    place(overrides: Partial<PlaceOrderRequest>) {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), "acc-1", `o-${seq}`));
    },
    order: (id: string) => t.engine.snapshot().orders.find((o) => o.id === id),
    positions: () => t.engine.snapshot().positions,
  };
}

function trigger(type: OrderType, side: OrderSide, stopPrice: string, extra: Partial<PlaceOrderRequest> = {}): Partial<PlaceOrderRequest> {
  const isMarket = type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET";
  return {
    type,
    side,
    stopPrice: parse(stopPrice),
    price: isMarket ? undefined : parse(stopPrice),
    timeInForce: isMarket ? undefined : "GTC",
    qty: parse("1"),
    ...extra,
  };
}

function only<T extends EngineEvent["t"]>(events: EngineEvent[], t: T): Extract<EngineEvent, { t: T }>[] {
  return events.filter((e): e is Extract<EngineEvent, { t: T }> => e.t === t);
}

// ─────────────────────────────────────────────────────────────
// 四种触发方向（06-testing-design.md："四种触发方向一条都不能少"）
// ─────────────────────────────────────────────────────────────

describe("四种触发方向（币安：STOP 买 ≥、卖 ≤；TAKE_PROFIT 买 ≤、卖 ≥）", () => {
  it.each([
    ["止损买", "STOP_MARKET", "BUY", "50100", "50099.9", "50100"],
    ["止损卖", "STOP_MARKET", "SELL", "49900", "49900.1", "49900"],
    ["止盈买", "TAKE_PROFIT_MARKET", "BUY", "49900", "49900.1", "49900"],
    ["止盈卖", "TAKE_PROFIT_MARKET", "SELL", "50100", "50099.9", "50100"],
  ] as const)("%s：差一个 tick 不触发，到触发价触发并按市价成交", (_name, type, side, stop, before, at) => {
    const s = setup();
    const placed = s.place(trigger(type, side, stop));
    expect(only(placed, "orderUpdate")[0]!.order).toMatchObject({ status: "NEW", triggered: false, frozenMargin: 0n });

    expect(s.trade(before)).toEqual([]);
    expect(s.order("o-1")).toMatchObject({ triggered: false });

    const events = s.trade(at);
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({
      id: "o-1",
      type,
      stopPrice: parse(stop),
      triggered: true,
      status: "FILLED",
      executedQty: parse("1"),
    });
    expect(only(events, "fill")[0]!.fill.price).toBe(side === "BUY" ? parse("50000") : parse("49999.9"));
    expect(s.positions()).toEqual([expect.objectContaining({ positionSide: side === "BUY" ? "LONG" : "SHORT", qty: parse("1") })]);
  });

  it.each([
    ["止损买", "STOP_MARKET", "BUY", "49000"],
    ["止损卖", "STOP_MARKET", "SELL", "51000"],
    ["止盈买", "TAKE_PROFIT_MARKET", "BUY", "51000"],
    ["止盈卖", "TAKE_PROFIT_MARKET", "SELL", "49000"],
  ] as const)("%s：触发价下单时已经被穿过（最新价 50,000），拒单（缺口 #15，币安 -2021）", (_name, type, side, stop) => {
    const s = setup();
    expect(s.place(trigger(type, side, stop))[0]).toMatchObject({ t: "rejected", code: "WOULD_IMMEDIATELY_TRIGGER" });
  });
});

describe("触发价格类型", () => {
  it("MARK_PRICE 单只看标记价：最新价穿过去不触发，标记价到了才触发", () => {
    const s = setup();
    s.place(trigger("STOP_MARKET", "SELL", "49900", { workingType: "MARK_PRICE" }));
    expect(s.trade("49000")).toEqual([]);
    const events = s.mark("49900");
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ triggered: true, status: "FILLED" });
  });

  it("默认 CONTRACT_PRICE 单只看最新价：标记价穿过去不触发", () => {
    const s = setup();
    s.place(trigger("STOP_MARKET", "SELL", "49900"));
    expect(s.mark("49000")).toEqual([]);
    expect(s.order("o-1")).toMatchObject({ workingType: "CONTRACT_PRICE", triggered: false });
  });
});

// ─────────────────────────────────────────────────────────────
// 触发那一刻
// ─────────────────────────────────────────────────────────────

describe("触发那一刻重新走校验链", () => {
  it("★ 触发时保证金不足：REJECTED，原因写清楚（下单时不查保证金）", () => {
    const s = setup({ wallet: "1000" });
    s.place(trigger("STOP_MARKET", "BUY", "50100")); // 20x 开 1 BTC 要 2,500+，下单时不查
    const events = s.trade("50100");
    expect(events).toHaveLength(1);
    const order = only(events, "orderUpdate")[0]!.order;
    expect(order).toMatchObject({ status: "REJECTED", triggered: true, executedQty: 0n });
    expect(order.rejectReason).toMatch(/INSUFFICIENT_MARGIN/);
    expect(s.t.engine.snapshot().orders).toEqual([]);
  });

  it("止损限价单触发后穿透盘口：Taker 成交", () => {
    const s = setup();
    s.place(trigger("STOP", "BUY", "50100", { price: parse("50000.5") }));
    const events = s.trade("50100");
    expect(only(events, "fill").map((e) => [e.fill.price, e.fill.role])).toEqual([[parse("50000"), "TAKER"]]);
  });

  it("止损限价单触发后不穿透：挂进盘口排队，冻结保证金，之后可以撤单", () => {
    const s = setup();
    s.place(trigger("STOP", "SELL", "49900", { price: parse("50050") }));
    s.trade("49900");
    expect(s.order("o-1")).toMatchObject({ type: "STOP", status: "NEW", triggered: true, stopPrice: parse("49900") });
    expect(s.order("o-1")!.frozenMargin).toBeGreaterThan(0n);
    expect(s.t.apply({ t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 + 9 })[0]).toMatchObject({
      order: { status: "CANCELED" },
    });
  });

  it("GTX 止盈限价单触发时会吃单：EXPIRED（缺口 #13）", () => {
    const s = setup();
    s.place(trigger("TAKE_PROFIT", "SELL", "50100", { price: parse("49999.9"), timeInForce: "GTX" }));
    const order = only(s.trade("50100"), "orderUpdate")[0]!.order;
    expect(order).toMatchObject({ status: "EXPIRED", triggered: true });
    expect(order.rejectReason).toMatch(/POST_ONLY_REJECTED/);
  });
});

describe("closePosition", () => {
  it("按触发那一刻的全部仓位平仓：下单后又加了仓，也一起平掉", () => {
    const s = setup();
    s.place({ ...market, qty: parse("1") }); // o-1 多 1
    s.place({ ...trigger("STOP_MARKET", "SELL", "49000"), qty: undefined, closePosition: true }); // o-2
    expect(s.order("o-2")).toMatchObject({ qty: 0n, closePosition: true, frozenMargin: 0n });
    s.place({ ...market, qty: parse("0.5") }); // o-3 加仓到 1.5

    const events = s.trade("49000");
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ id: "o-2", qty: parse("1.5"), status: "FILLED", closePosition: true });
    expect(s.positions()).toEqual([]);
  });

  it("仓位先被别的单平掉：残余的 closePosition 触发单自动撤销（缺口 #18）", () => {
    const s = setup();
    s.place({ ...market, qty: parse("1") });
    s.place({ ...trigger("STOP_MARKET", "SELL", "49000"), qty: undefined, closePosition: true });
    const events = s.place({ ...market, side: "SELL", qty: parse("1") });
    expect(only(events, "orderUpdate").find((e) => e.order.id === "o-2")!.order.status).toBe("CANCELED");
  });

  it("★ 触发在风控之前：标记价跳空穿过止损价和强平价，止损单先把仓位平掉，不会被强平", () => {
    const s = setup({ wallet: "10000", marginMode: "ISOLATED", leverageNum: 10 });
    s.place({ ...market, qty: parse("1") }); // 逐仓多 1 @ 50,000，强平价 45,180.72
    s.place({ ...trigger("STOP_MARKET", "SELL", "46000", { workingType: "MARK_PRICE" }), qty: undefined, closePosition: true });
    s.t.apply({ t: "book", symbol: "BTCUSDT", bids: [{ price: parse("45170"), qty: parse("5") }], asks: [{ price: parse("45170.5"), qty: parse("5") }], ts: T0 });

    const events = s.mark("45180");
    expect(only(events, "liquidation")).toEqual([]);
    expect(only(events, "fill")[0]!.fill).toMatchObject({ price: parse("45170"), isLiquidation: false, realizedPnl: parse("-4830") });
    expect(s.positions()).toEqual([]);
  });
});

describe("条件单总数上限（币安：所有币对合计 200，-4045）", () => {
  it("未触发的条件单达到上限就拒；触发之后不再占名额", () => {
    const config = testConfig();
    config.limits.maxConditionalOrdersNum = 2;
    const s = setup({ config });
    s.place(trigger("STOP_MARKET", "BUY", "50100"));
    s.place(trigger("STOP_MARKET", "BUY", "50200"));
    expect(s.place(trigger("STOP_MARKET", "BUY", "50300"))[0]).toMatchObject({ t: "rejected", code: "TOO_MANY_ORDERS" });

    s.trade("50100"); // o-1 触发成交
    expect(only(s.place(trigger("STOP_MARKET", "BUY", "50300")), "orderUpdate")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 跟踪委托 TRAILING_STOP_MARKET（第 15 讲，规则见 07-binance-reference.md 第 14 节）
// ─────────────────────────────────────────────────────────────

/** 一张跟踪委托。默认按最新成交价（CONTRACT_PRICE）跟 */
function trailing(side: OrderSide, callbackRate: string, extra: Partial<PlaceOrderRequest> = {}): Partial<PlaceOrderRequest> {
  return {
    type: "TRAILING_STOP_MARKET",
    side,
    price: undefined,
    timeInForce: undefined,
    stopPrice: undefined,
    callbackRate: parse(callbackRate),
    qty: parse("1"),
    ...extra,
  };
}

describe("跟踪委托：追踪与触发", () => {
  it("卖单跟最高价：价格一路涨，跟踪价跟着涨，中途不触发", () => {
    const s = setup();
    s.place(trailing("SELL", "1")); // 回调率 1%
    s.trade("51000");
    s.trade("52000");
    expect(s.order("o-1")?.trackedPrice).toBe(parse("52000"));
    expect(s.order("o-1")?.triggered).toBe(false);
  });

  it("卖单：从最高价回撤到 1% 就触发，按市价成交", () => {
    const s = setup();
    s.place(trailing("SELL", "1"));
    s.trade("52000"); // 最高价 52,000 → 止损线 51,480
    const events = s.trade("51480");
    // 全部成交的单会离开挂单簿，状态看事件
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({
      id: "o-1",
      type: "TRAILING_STOP_MARKET",
      triggered: true,
      status: "FILLED",
      trackedPrice: parse("52000"), // 在哪个价位被打掉的，留在单子上
    });
    expect(only(events, "fill").length).toBeGreaterThan(0);
  });

  it("卖单：回撤不够就不触发（差一个最小单位也不行）", () => {
    const s = setup();
    s.place(trailing("SELL", "1"));
    s.trade("52000");
    s.trade("51480.1");
    expect(s.order("o-1")?.triggered).toBe(false);
  });

  it("买单跟最低价：跌到最低后反弹 1% 触发", () => {
    const s = setup();
    s.place(trailing("BUY", "1"));
    s.trade("48000"); // 最低价 48,000 → 触发线 48,480
    expect(s.order("o-1")?.trackedPrice).toBe(parse("48000"));
    const events = s.trade("48480");
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ id: "o-1", triggered: true, status: "FILLED" });
  });

  it("不传激活价 = 从下单那一刻开始跟：跟踪价初始就是当时的最新价", () => {
    const s = setup();
    s.place(trailing("SELL", "2"));
    const order = s.order("o-1");
    expect(order?.trackedPrice).toBe(parse("50000"));
    expect(order?.activationPrice).toBe(parse("50000"));
  });

  it("传了激活价：没到激活价之前，跌再多也不触发", () => {
    const s = setup();
    // 卖单激活价 52,000（高于现价 50,000）
    s.place(trailing("SELL", "1", { activationPrice: parse("52000") }));
    s.trade("51000"); // 还没到激活价
    s.trade("49000"); // 跌了 4%，但没激活，不该触发
    expect(s.order("o-1")?.triggered).toBe(false);
    expect(s.order("o-1")?.trackedPrice).toBe(parse("51000")); // 最高价仍在跟
  });

  it("到了激活价之后，回撤够了才触发", () => {
    const s = setup();
    s.place(trailing("SELL", "1", { activationPrice: parse("52000") }));
    s.trade("53000"); // 激活，最高价 53,000 → 止损线 52,470
    expect(s.order("o-1")?.triggered).toBe(false);
    const events = s.trade("52470");
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ id: "o-1", triggered: true, status: "FILLED" });
  });

  it("按标记价跟的单，不理会成交价推送", () => {
    const s = setup();
    s.place(trailing("SELL", "1", { workingType: "MARK_PRICE" }));
    s.trade("52000"); // 成交价涨了，标记价没动
    expect(s.order("o-1")?.trackedPrice).toBe(parse("50000"));
    s.mark("52000");
    expect(s.order("o-1")?.trackedPrice).toBe(parse("52000"));
  });

  it("未触发时不冻结保证金（和别的条件单一样）", () => {
    const s = setup();
    s.place(trailing("SELL", "1"));
    expect(s.order("o-1")?.frozenMargin).toBe(0n);
  });
});

describe("跟踪委托：下单校验", () => {
  const rejected = (events: EngineEvent[]) => only(events, "rejected")[0];

  it("不填回调率：拒", () => {
    const s = setup();
    const events = s.place(trailing("SELL", "1", { callbackRate: undefined }));
    expect(rejected(events)?.code).toBe("INVALID_PARAMS");
    expect(rejected(events)?.message).toMatch("必须填回调率");
  });

  it("回调率超出币安允许的 0.1% ~ 10%：拒", () => {
    const s = setup();
    expect(rejected(s.place(trailing("SELL", "0.05")))?.code).toBe("INVALID_PARAMS");
    expect(rejected(s.place(trailing("SELL", "10.5")))?.message).toMatch("超出允许范围");
  });

  it("边界上的回调率可以下单", () => {
    const s = setup();
    expect(only(s.place(trailing("SELL", "0.1")), "rejected")).toHaveLength(0);
    expect(only(s.place(trailing("SELL", "10")), "rejected")).toHaveLength(0);
  });

  it("激活价方向反了：拒（币安 -2021，卖单激活价必须高于现价）", () => {
    const s = setup();
    const events = s.place(trailing("SELL", "1", { activationPrice: parse("49000") }));
    expect(rejected(events)?.code).toBe("WOULD_IMMEDIATELY_TRIGGER");
    expect(rejected(events)?.message).toMatch("必须高于");
  });

  it("买单激活价必须低于现价", () => {
    const s = setup();
    expect(rejected(s.place(trailing("BUY", "1", { activationPrice: parse("51000") })))?.code).toBe(
      "WOULD_IMMEDIATELY_TRIGGER",
    );
  });

  it("跟踪委托不接受触发价、委托价、closePosition", () => {
    const s = setup();
    expect(rejected(s.place(trailing("SELL", "1", { stopPrice: parse("49000") })))?.message).toMatch("不接受触发价");
    expect(rejected(s.place(trailing("SELL", "1", { price: parse("49000") })))?.message).toMatch("不接受委托价");
    expect(rejected(s.place(trailing("SELL", "1", { closePosition: true, qty: undefined })))?.message).toMatch(
      "closePosition 只能用于",
    );
  });

  it("别的类型不能传回调率 / 激活价", () => {
    const s = setup();
    expect(rejected(s.place({ callbackRate: parse("1") }))?.message).toMatch("不接受回调率");
    expect(rejected(s.place({ activationPrice: parse("52000") }))?.message).toMatch("不接受激活价");
  });
});
