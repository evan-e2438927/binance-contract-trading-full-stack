import { parse, type MarginMode, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import {
  T0,
  bookInput,
  markPriceInput,
  orderRequest,
  placeOrderInput,
  registerAccountInput,
  testConfig,
  testPosition,
} from "./testing/fixtures";
import { createTestEngine } from "./testing/harness";
import type { EngineEvent, EngineInput, Level, PlaceOrderRequest } from "./types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架，每次 apply 之后自动对账（不变式 ①～⑨）+ 回滚自检
// ─────────────────────────────────────────────────────────────

function levels(rows: [string, string][]): Level[] {
  return rows.map(([price, qty]) => ({ price: parse(price), qty: parse(qty) }));
}

function book(bids: [string, string][], asks: [string, string][]): EngineInput {
  return { t: "book", symbol: "BTCUSDT", bids: levels(bids), asks: levels(asks), ts: T0 };
}

const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

interface SetupOptions {
  wallet?: string;
  leverageNum?: number;
  marginMode?: MarginMode;
  mode?: PositionMode;
}

function setup({ wallet = "10000", leverageNum = 10, marginMode = "ISOLATED", mode = "ONE_WAY" }: SetupOptions = {}) {
  const t = createTestEngine(testConfig());
  t.apply({ ...registerAccountInput("acc-1", wallet), positionMode: mode });
  t.apply(bookInput());
  t.apply(markPriceInput("50000"));
  const snapshot = t.engine.snapshot();
  t.engine.restore({ ...snapshot, settings: [{ accountId: "acc-1", symbol: "BTCUSDT", leverageNum, marginMode }] });
  let seq = 0;
  return {
    t,
    place(overrides: Partial<PlaceOrderRequest>) {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), "acc-1", `o-${seq}`));
    },
    mark(price: string) {
      return t.apply(markPriceInput(price));
    },
    wallet() {
      return t.engine.snapshot().accounts[0]!.walletBalance;
    },
  };
}

function only<T extends EngineEvent["t"]>(events: EngineEvent[], t: T): Extract<EngineEvent, { t: T }>[] {
  return events.filter((e): e is Extract<EngineEvent, { t: T }> => e.t === t);
}

function types(events: EngineEvent[]): string[] {
  return events.map((e) => (e.t === "balanceUpdate" ? `balanceUpdate:${e.reason}` : e.t));
}

// ─────────────────────────────────────────────────────────────
// 逐仓
// ─────────────────────────────────────────────────────────────

describe("逐仓强平（01-domain-knowledge.md 第六节算例 A：10x 逐仓多 1 BTC @ 50,000）", () => {
  /** 市价开多 1 @ 50,000：钱包 9,975，逐仓保证金 5,000。 */
  function longIsolated() {
    const s = setup();
    s.place({ ...market, qty: parse("1") });
    return s;
  }

  it("强平价前一点不强平，触及强平价强平（仓位权益 5,000 + 未实现盈亏 ≤ 维持保证金）", () => {
    const { t, mark } = longIsolated();
    t.apply(book([["45170", "5"]], [["45170.5", "5"]]));

    // 45,180.73：权益 180.73 > 维持保证金 180.72292
    expect(mark("45180.73")).toEqual([]);
    expect(t.engine.snapshot().positions).toHaveLength(1);

    // 45,180.72：权益 180.72 ≤ 维持保证金 180.72288
    const events = mark("45180.72");
    expect(only(events, "liquidation")).toHaveLength(1);
    expect(t.engine.snapshot().positions).toEqual([]);
  });

  it("★ 逐仓爆仓只亏逐仓保证金：吃盘口 1 @ 45,170，收 Taker 手续费，清算费收到剩下的资产为止，钱包 9,975 → 4,975", () => {
    const { t, mark, wallet } = longIsolated();
    t.apply(book([["45170", "5"]], [["45170.5", "5"]]));

    const events = mark("45180.72");
    expect(types(events)).toEqual([
      "orderUpdate",
      "fill",
      "positionUpdate",
      "liquidation",
      "balanceUpdate:LIQUIDATION",
      "balanceUpdate:FEE",
      "balanceUpdate:LIQUIDATION_FEE",
    ]);

    const order = only(events, "orderUpdate")[0]!.order;
    expect(order).toMatchObject({
      id: `liq:acc-1:BTCUSDT:LONG:${T0}`,
      clientOrderId: `autoclose-${T0}-BTCUSDT-LONG`,
      type: "LIQUIDATION",
      side: "SELL",
      positionSide: "BOTH",
      timeInForce: "IOC",
      price: parse("45000"), // 破产价 = 50,000 − 5,000 ÷ 1
      status: "FILLED",
      executedQty: parse("1"),
      avgPrice: parse("45170"),
    });
    expect(only(events, "fill")[0]!.fill).toMatchObject({
      orderId: order.id,
      price: parse("45170"),
      qty: parse("1"),
      fee: parse("22.585"), // 45,170 × 0.05%
      realizedPnl: parse("-4830"),
      isLiquidation: true,
    });
    // 剩下的资产 5,000 − 4,830 = 170；先交手续费 22.585，剩 147.415；清算费应收 45,170 × 1.25% = 564.625，只收 147.415
    expect(only(events, "liquidation")[0]!.record).toMatchObject({
      qty: parse("1"),
      entryPrice: parse("50000"),
      markPrice: parse("45180.72"),
      realizedPnl: parse("-4830"),
      liquidationFee: parse("147.415"),
      marginBalanceBefore: parse("180.72"),
      maintMarginAt: parse("180.72288"),
    });
    expect(wallet()).toBe(parse("4975"));
    expect(t.ledgerSum("acc-1")).toBe(parse("4975"));
  });

  it("盘口吃不完：比破产价差的档位不吃，剩余按破产价 45,000 平掉，是破产仓位：吃盘口的部分收手续费，接管的部分和清算费不收", () => {
    const { t, mark, wallet } = longIsolated();
    t.apply(book([["45170", "0.4"], ["45100", "0.3"], ["44900", "5"]], [["45170.5", "5"]]));

    const events = mark("45180.72");
    expect(only(events, "fill").map((e) => [e.fill.price, e.fill.qty, e.fill.realizedPnl, e.fill.fee])).toEqual([
      [parse("45170"), parse("0.4"), parse("-1932"), parse("9.034")],
      [parse("45100"), parse("0.3"), parse("-1470"), parse("6.765")],
      [parse("45000"), parse("0.3"), parse("-1500"), 0n], // 44,900 那一档比破产价差，不吃；按破产价接管，不收手续费
    ]);
    expect(only(events, "liquidation")[0]!.record).toMatchObject({
      realizedPnl: parse("-4902"),
      liquidationFee: 0n,
    });
    expect(wallet()).toBe(parse("5057.201")); // 9,975 − 4,902 − 15.799
  });

  it("行情跳空、标记价越过强平价很远：清算费按成交价的名义价值收（不是标记价），没被资产封顶时收足", () => {
    const { t, mark, wallet } = longIsolated();
    t.apply(book([["49000", "5"]], [["49000.5", "5"]]));

    const events = mark("44000");
    // 已实现 −1,000，剩余资产 4,000；手续费 49,000 × 0.05% = 24.5；清算费按成交价 49,000 × 1.25% = 612.5（按标记价 44,000 会是 550）
    expect(only(events, "liquidation")[0]!.record).toMatchObject({
      realizedPnl: parse("-1000"),
      liquidationFee: parse("612.5"),
    });
    expect(wallet()).toBe(parse("8338")); // 9,975 − 1,000 − 24.5 − 612.5
  });

  it("剩余资产连手续费都不够：手续费也只扣到 0，清算费不收，钱包不倒扣", () => {
    const { t, mark, wallet } = longIsolated();
    t.apply(book([["45010", "5"]], [["45010.5", "5"]]));

    const events = mark("45180.72");
    // 已实现 −4,990，剩 10；手续费应收 22.505，只收 10；清算费 0
    expect(only(events, "fill")[0]!.fill.fee).toBe(parse("10"));
    expect(only(events, "liquidation")[0]!.record.liquidationFee).toBe(0n);
    expect(types(events).filter((x) => x.startsWith("balanceUpdate"))).toEqual([
      "balanceUpdate:LIQUIDATION",
      "balanceUpdate:FEE",
    ]);
    expect(wallet()).toBe(parse("4975"));
  });

  it("逐仓空头：算例 B 的 54,780.88 名义价值已经进了第 2 层，真实强平价是 54,776.12（缺口 #24），从卖盘买回", () => {
    const s = setup();
    s.t.apply(book([["50000", "5"]], [["50000.5", "5"]]));
    s.place({ ...market, side: "SELL", qty: parse("1") }); // 空 1 @ 50,000，钱包 9,975
    s.t.apply(book([["54789.5", "5"]], [["54790", "5"]]));

    // 第 2 层 mmr 0.5%、cum 50：5,000 + 50,000 − M = 0.005M − 50 → M = 55,050 ÷ 1.005 = 54,776.119…
    // 54,776.11：权益 223.89 > 维持保证金 223.88055；54,776.12：权益 223.88 ≤ 223.8806
    expect(s.mark("54776.11")).toEqual([]);
    const events = s.mark("54776.12");
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ side: "BUY", price: parse("55000") });
    expect(only(events, "fill")[0]!.fill).toMatchObject({ price: parse("54790"), realizedPnl: parse("-4790") });
    expect(s.wallet()).toBe(parse("4975"));
  });

  it("强平前先让这个币对上的挂单失效：EXPIRED，冻结保证金归零", () => {
    const { t, place, mark } = longIsolated();
    place({ price: parse("49000"), qty: parse("0.1") }); // o-2 挂买单
    t.apply(book([["45170", "5"]], [["45170.5", "5"]]));

    const events = mark("45180.72");
    expect(events[0]).toEqual({
      t: "orderUpdate",
      order: expect.objectContaining({
        id: "o-2",
        status: "EXPIRED",
        frozenMargin: 0n,
        rejectReason: "账户强平，挂单失效",
      }),
    });
    expect(t.engine.snapshot().orders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 全仓
// ─────────────────────────────────────────────────────────────

describe("全仓强平（10x 全仓多 1 BTC @ 50,000，钱包 9,975）", () => {
  function longCross() {
    const s = setup({ marginMode: "CROSS" });
    s.place({ ...market, qty: parse("1") });
    return s;
  }

  it("整户判：40,185.75 不强平，40,185.74 强平（9,975 + 未实现盈亏 ≤ 维持保证金）", () => {
    const { t, mark } = longCross();
    t.apply(book([["40100", "5"]], [["40100.5", "5"]]));
    expect(mark("40185.75")).toEqual([]);
    expect(only(mark("40185.74"), "liquidation")).toHaveLength(1);
  });

  it("★ 全仓爆仓余额归零、不为负：盘口一档都够不上破产价 40,025，全部按破产价平掉", () => {
    const { t, mark, wallet } = longCross();
    t.apply(book([["39000", "5"]], [["39000.5", "5"]]));

    const events = mark("39000");
    expect(only(events, "fill").map((e) => [e.fill.price, e.fill.qty])).toEqual([[parse("40025"), parse("1")]]);
    expect(only(events, "liquidation")[0]!.record).toMatchObject({
      realizedPnl: parse("-9975"),
      liquidationFee: 0n,
      marginBalanceBefore: parse("-1025"), // 跳空到 39,000，强平前一刻已经穿仓
    });
    expect(wallet()).toBe(0n);
  });

  it("全仓强平撤掉这个账户的所有挂单", () => {
    const { t, place, mark } = longCross();
    place({ price: parse("49000"), qty: parse("0.01") });
    place({ side: "SELL", price: parse("51000"), qty: parse("0.5"), reduceOnly: true });
    t.apply(book([["40100", "0.5"]], [["40100.5", "5"]]));

    const events = mark("40185.74");
    expect(only(events, "orderUpdate").map((e) => [e.order.id, e.order.status])).toEqual([
      ["o-2", "EXPIRED"],
      ["o-3", "EXPIRED"],
      [`liq:acc-1:BTCUSDT:LONG:${T0}`, "FILLED"],
    ]);
    // 0.5 @ 40,100（−4,950）+ 0.5 @ 破产价 40,025（−4,987.5）
    expect(only(events, "liquidation")[0]!.record.realizedPnl).toBe(parse("-9937.5"));
    expect(t.engine.snapshot().orders).toEqual([]);
  });

  it("逐仓强平不影响全仓：逐仓仓位被强平，钱包里属于全仓的部分不受损", () => {
    const s = setup({ wallet: "20000" });
    s.place({ ...market, qty: parse("1") }); // 逐仓多 1，保证金 5,000，钱包 19,975
    s.t.apply(book([["45170", "5"]], [["45170.5", "5"]]));
    s.mark("45180.72");
    expect(s.wallet()).toBe(parse("14975")); // 只少了那 5,000
  });
});

// ─────────────────────────────────────────────────────────────
// 什么时候扫描
// ─────────────────────────────────────────────────────────────

describe("边界与全仓钱包口径", () => {
  it("权益正好等于维持保证金也强平：逐仓多 1 @ 54,800、保证金 5,000，标记价 50,000 → 权益 200 = 维持保证金 200", () => {
    const { t, mark } = setup();
    mark("60000"); // 先把标记价挪开，否则装进快照的仓位在 book 那一步就已经"该强平没强平"，不变式 ⑨ 会先报
    t.engine.restore({
      ...t.engine.snapshot(),
      positions: [testPosition({ marginMode: "ISOLATED", leverageNum: 10, entryPrice: parse("54800"), isolatedMargin: parse("5000") })],
    });
    t.apply(book([["49999.9", "5"]], [["50000", "5"]]));
    expect(only(mark("50000"), "liquidation")[0]!.record).toMatchObject({
      marginBalanceBefore: parse("200"),
      maintMarginAt: parse("200"),
    });
  });

  it("★ 全仓权益要减掉逐仓保证金：钱包 10,000 里 5,000 锁在逐仓空头上，全仓多头按剩下的 5,000 判", () => {
    const { t, mark } = setup({ mode: "HEDGE" });
    t.engine.restore({
      ...t.engine.snapshot(),
      positions: [
        testPosition({ positionSide: "LONG", marginMode: "CROSS", leverageNum: 10 }),
        testPosition({ positionSide: "SHORT", marginMode: "ISOLATED", leverageNum: 10, isolatedMargin: parse("5000") }),
      ],
    });
    t.apply(book([["45170", "5"]], [["45170.5", "5"]]));
    // 全仓权益 = (10,000 − 5,000) + (45,180.72 − 50,000) = 180.72 ≤ 180.72288；不减逐仓保证金的话是 5,180.72，不会强平
    const records = only(mark("45180.72"), "liquidation").map((e) => [e.record.positionSide, e.record.marginMode]);
    expect(records).toEqual([["LONG", "CROSS"]]); // 逐仓空头在赚钱，不动
  });
});

describe("扫描时机", () => {
  it("没有仓位的账户、缺标记价的币对：不扫描、不出事件", () => {
    const { mark } = setup();
    expect(mark("1000")).toEqual([]);
  });

  it("双向模式下强平单的 positionSide 是仓位方向，不带 reduceOnly", () => {
    const s = setup({ mode: "HEDGE" });
    s.place({ ...market, positionSide: "LONG", qty: parse("1") });
    s.t.apply(book([["45170", "5"]], [["45170.5", "5"]]));
    const order = only(s.mark("45180.72"), "orderUpdate")[0]!.order;
    expect(order).toMatchObject({ positionSide: "LONG", reduceOnly: false, type: "LIQUIDATION" });
  });
});

// ─────────────────────────────────────────────────────────────
// 缺口 #23：仓位变化后重算其它挂单的冻结保证金
// ─────────────────────────────────────────────────────────────

describe("仓位变化后重算其它挂单的冻结保证金（缺口 #23）", () => {
  it("持多 1、挂卖 2：只冻结开空 1 的成本；多头被市价平掉后，这张卖单冻结开空 2 的成本", () => {
    const s = setup({ wallet: "100000", leverageNum: 20, marginMode: "CROSS" });
    s.place({ ...market, qty: parse("1") }); // 多 1 @ 50,000
    s.place({ side: "SELL", price: parse("51000"), qty: parse("2") }); // o-2
    // 开空 1 @ 51,000、20x：2,550 + 预留手续费 25.5
    expect(s.t.engine.snapshot().orders[0]!.frozenMargin).toBe(parse("2575.5"));

    const events = s.place({ ...market, side: "SELL", qty: parse("1"), reduceOnly: true }); // o-3 平掉多头
    const refreshed = only(events, "orderUpdate").find((e) => e.order.id === "o-2")!.order;
    // 开空 2 @ 51,000：5,100 + 51
    expect(refreshed.frozenMargin).toBe(parse("5151"));
    expect(s.t.engine.snapshot().orders[0]!.frozenMargin).toBe(parse("5151"));
  });
});

describe("LIQUIDATION 类型的订单用户不能下", () => {
  it("校验链第 3 步拒掉", () => {
    const { place } = setup();
    const events = place({ type: "LIQUIDATION", price: undefined, timeInForce: undefined, qty: parse("1") });
    expect(events[0]).toMatchObject({ t: "rejected", code: "INVALID_PARAMS" });
  });
});

describe("分层表热加载（第 11 讲 setBrackets）", () => {
  it("换成维持保证金率更高的表：原来安全的仓位立刻被扫到强平", () => {
    const { t, place, mark } = setup();
    place({ ...market, qty: parse("1") }); // 10x 逐仓多 1 @ 50,000
    t.apply(book([["46000", "5"]], [["46000.5", "5"]]));
    expect(mark("46000")).toEqual([]); // 0.4% 的表下：权益 1,000 > 维持保证金 184

    // 币安调表：第 1 层维持保证金率改成 2.5%（权益 1,000 ≤ 46,000 × 2.5% = 1,150）
    const harder = [{ bracketNum: 1, notionalFloor: 0n, notionalCap: parse("100000000"), maxLeverageNum: 20, mmr: parse("0.025"), cum: 0n }];
    const events = t.apply({ t: "setBrackets", symbol: "BTCUSDT", brackets: harder, ts: T0 + 5 });
    expect(only(events, "liquidation")).toHaveLength(1);
  });
});
