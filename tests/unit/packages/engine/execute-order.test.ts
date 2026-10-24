import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { applyInput } from "../../../../packages/engine/src/apply";
import { applyFill } from "../../../../packages/engine/src/execute-order";
import { availableBalance } from "../../../../packages/engine/src/formulas";
import { putPosition } from "../../../../packages/engine/src/journal";
import { createState } from "../../../../packages/engine/src/state";
import {
  T0,
  bookInput,
  deepBookInput,
  markPriceInput,
  orderRequest,
  placeOrderInput,
  registerAccountInput,
  testConfig,
  testOrder,
  testPosition,
} from "../../../../packages/engine/src/testing/fixtures";
import { createTestEngine } from "../../../../packages/engine/src/testing/harness";
import type { EngineEvent, PlaceOrderRequest } from "../../../../packages/engine/src/types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架，每次 apply 之后自动对账（不变式 ①～⑧）+ 回滚自检
// ─────────────────────────────────────────────────────────────

interface SetupOptions {
  wallet?: string;
  mode?: PositionMode;
  deep?: boolean;
}

function setup({ wallet = "100000", mode = "ONE_WAY", deep = false }: SetupOptions = {}) {
  const t = createTestEngine(testConfig());
  t.apply({ ...registerAccountInput("acc-1", wallet), positionMode: mode });
  t.apply(deep ? deepBookInput() : bookInput());
  t.apply(markPriceInput("50000"));
  let seq = 0;
  return {
    t,
    /** 下一张单，订单 id 自动递增：o-1、o-2…… */
    place(overrides: Partial<PlaceOrderRequest>) {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), "acc-1", `o-${seq}`));
    },
    /** 用快照改杠杆 / 保证金模式——setLeverage 输入第 08 讲才实现 */
    setSetting(leverageNum: number, marginMode: "CROSS" | "ISOLATED") {
      const snapshot = t.engine.snapshot();
      t.engine.restore({
        ...snapshot,
        settings: [{ accountId: "acc-1", symbol: "BTCUSDT", leverageNum, marginMode }],
      });
    },
  };
}

const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

function types(events: EngineEvent[]): string[] {
  return events.map((e) => (e.t === "balanceUpdate" ? `balanceUpdate:${e.reason}` : e.t));
}

function only<T extends EngineEvent["t"]>(events: EngineEvent[], t: T): Extract<EngineEvent, { t: T }>[] {
  return events.filter((e): e is Extract<EngineEvent, { t: T }> => e.t === t);
}

function wallet(t: ReturnType<typeof setup>["t"]) {
  return t.engine.snapshot().accounts[0]!.walletBalance;
}

// ─────────────────────────────────────────────────────────────
// 市价单
// ─────────────────────────────────────────────────────────────

describe("市价单逐档吃单（04-backend-design.md 5.3 节）", () => {
  it("市价买 5 BTC：吃 2 @ 50,000 + 2 @ 50,000.5 + 1 @ 50,001，均价 50,000.4", () => {
    const { t, place } = setup({ deep: true });
    const events = place({ ...market, qty: parse("5") });

    const order = only(events, "orderUpdate")[0]!.order;
    expect(order).toMatchObject({ status: "FILLED", executedQty: parse("5"), avgPrice: parse("50000.4") });

    const fills = only(events, "fill").map((e) => e.fill);
    expect(fills.map((f) => [f.id, f.price, f.qty, f.role, f.fee])).toEqual([
      ["o-1:1", parse("50000"), parse("2"), "TAKER", parse("50")],
      ["o-1:2", parse("50000.5"), parse("2"), "TAKER", parse("50.0005")],
      ["o-1:3", parse("50001"), parse("1"), "TAKER", parse("25.0005")],
    ]);

    // 仓位均价逐笔加权，和订单成交均价一致
    expect(t.engine.snapshot().positions).toEqual([
      expect.objectContaining({ positionSide: "LONG", qty: parse("5"), entryPrice: parse("50000.4") }),
    ]);
    // 手续费逐笔向上取整后扣钱包：50 + 50.0005 + 25.0005 = 125.001
    expect(wallet(t)).toBe(parse("99874.999"));
    expect(t.ledgerSum("acc-1")).toBe(parse("99874.999"));
  });

  it("01-domain-knowledge.md 第十二节第 1 步：10x 逐仓市价开多 1 BTC @ 50,000 → 钱包 9,975，逐仓保证金 5,000", () => {
    const { t, place, setSetting } = setup({ wallet: "10000" });
    setSetting(10, "ISOLATED");

    const events = place({ ...market, qty: parse("1") });

    // 事件顺序：订单在最前（fills.order_id 外键），然后成交 → 仓位 → 余额
    expect(types(events)).toEqual(["orderUpdate", "fill", "positionUpdate", "balanceUpdate:FEE"]);
    expect(only(events, "balanceUpdate")[0]).toEqual({
      t: "balanceUpdate",
      accountId: "acc-1",
      walletBalance: parse("9975"),
      delta: parse("-25"),
      reason: "FEE",
      symbol: "BTCUSDT",
      ref: { type: "fill", id: "o-1:1" },
      ts: T0,
    });

    const position = t.engine.snapshot().positions[0]!;
    expect(position).toMatchObject({
      positionSide: "LONG",
      marginMode: "ISOLATED",
      leverageNum: 10,
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: parse("5000"),
    });
    // 设计缺口 #6：逐仓保证金不从钱包里扣，只在可用余额里扣
    expect(
      availableBalance({
        walletBalance: wallet(t),
        crossUnrealizedPnlSum: 0n,
        crossInitialMarginSum: 0n,
        isolatedMarginSum: position.isolatedMargin,
        frozenMarginSum: 0n,
      }),
    ).toBe(parse("4975"));
  });
});

// ─────────────────────────────────────────────────────────────
// 仓位变更：平仓、反手、双向模式
// ─────────────────────────────────────────────────────────────

describe("平仓与反手（04-backend-design.md 4.4 节）", () => {
  it("平仓盈利：已实现 +2,000 先入账，再扣手续费，仓位清零后移出内存", () => {
    const { t, place } = setup({ wallet: "10000" });
    place({ ...market, qty: parse("1") }); // 开多 1 @ 50,000，手续费 25 → 9,975

    // 价格涨上去：买一 52,000
    t.apply({
      t: "book",
      symbol: "BTCUSDT",
      bids: [{ price: parse("52000"), qty: parse("5") }],
      asks: [{ price: parse("52000.5"), qty: parse("5") }],
      ts: T0,
    });
    t.apply(markPriceInput("51000"));

    const events = place({ ...market, side: "SELL", qty: parse("1") });
    expect(types(events)).toEqual([
      "orderUpdate",
      "fill",
      "positionUpdate",
      "balanceUpdate:REALIZED_PNL",
      "balanceUpdate:FEE",
    ]);
    expect(only(events, "fill")[0]!.fill.realizedPnl).toBe(parse("2000"));
    expect(only(events, "positionUpdate")[0]!.position.qty).toBe(0n);
    expect(only(events, "balanceUpdate").map((e) => [e.delta, e.walletBalance])).toEqual([
      [parse("2000"), parse("11975")],
      [parse("-26"), parse("11949")],
    ]);
    expect(t.engine.snapshot().positions).toEqual([]);
  });

  it("单向模式反手：持多 1，市价卖 3 → 先平 1、再开空 2，两段分开算", () => {
    const { t, place } = setup();
    place({ ...market, qty: parse("1") }); // 多 1 @ 50,000，手续费 25

    const events = place({ ...market, side: "SELL", qty: parse("3") });
    const fills = only(events, "fill").map((e) => e.fill);
    // 买一 49,999.9 有 2 BTC：1 个平多（亏 0.1），1 个开空；买二 49,999.5 再加空 1
    expect(fills.map((f) => [f.price, f.qty, f.realizedPnl])).toEqual([
      [parse("49999.9"), parse("2"), parse("-0.1")],
      [parse("49999.5"), parse("1"), 0n],
    ]);
    expect(only(events, "positionUpdate").map((e) => [e.position.positionSide, e.position.qty])).toEqual([
      ["LONG", 0n],
      ["SHORT", parse("1")],
      ["SHORT", parse("2")],
    ]);
    expect(t.engine.snapshot().positions).toEqual([
      expect.objectContaining({ positionSide: "SHORT", qty: parse("2"), entryPrice: parse("49999.7") }),
    ]);
    // 100,000 − 25 − 0.1 − 49.9999 − 24.99975
    expect(wallet(t)).toBe(parse("99899.90035"));
  });

  it("双向模式：SELL + LONG 只平多头，空头仓位不受影响", () => {
    const { t, place } = setup({ mode: "HEDGE" });
    place({ ...market, positionSide: "LONG", qty: parse("1") });
    place({ ...market, side: "SELL", positionSide: "SHORT", qty: parse("1") });
    expect(t.engine.snapshot().positions).toHaveLength(2);

    const events = place({ ...market, side: "SELL", positionSide: "LONG", qty: parse("1") });
    expect(only(events, "fill")[0]!.fill.realizedPnl).toBe(parse("-0.1"));
    expect(t.engine.snapshot().positions).toEqual([
      expect.objectContaining({ positionSide: "SHORT", qty: parse("1"), entryPrice: parse("49999.9") }),
    ]);
  });

  it("逐仓部分平仓：保证金按比例释放", () => {
    const { t, place, setSetting } = setup();
    setSetting(10, "ISOLATED");
    place({ ...market, qty: parse("1") });
    place({ ...market, side: "SELL", qty: parse("0.5") });
    expect(t.engine.snapshot().positions[0]).toMatchObject({ qty: parse("0.5"), isolatedMargin: parse("2500") });
  });

  it("已实现亏损向下取整：多算不少算", () => {
    const state = createState(testConfig());
    applyInput(state, registerAccountInput("acc-1", "100000"));
    applyInput(state, bookInput());
    applyInput(state, markPriceInput());
    // 开仓价 50,000.00000009，卖 0.5 @ 50,000：真实亏损 0.000000045，记 −0.00000005
    putPosition(state, testPosition({ entryPrice: parse("50000.00000009") }));
    const order = testOrder({ side: "SELL", qty: parse("0.5") });
    const result = applyFill(state, order, parse("50000"), parse("0.5"), "TAKER", "o-1:1", T0)!;
    expect(result.fill.realizedPnl).toBe(-5n);
  });

  it("仓位的杠杆 / 保证金模式和当前设置不一致：说明第 08 讲调设置时没同步仓位，抛错", () => {
    const { place, setSetting } = setup();
    place({ ...market, qty: parse("1") }); // 默认 20x 全仓开多
    setSetting(10, "CROSS");
    expect(() => place({ ...market, qty: parse("0.1") })).toThrow(/不一致/);
  });
});

// ─────────────────────────────────────────────────────────────
// 限价单：下单瞬间判定角色（5.4 节）
// ─────────────────────────────────────────────────────────────

describe("限价单穿透盘口（5.4 节：会立刻成交的部分是 Taker）", () => {
  const crossing = { price: parse("50000.5"), qty: parse("5") };

  it("GTC 买 5 @ 50,000.5：吃掉 4 BTC，剩 1 BTC 挂单，排队位置 0，冻结剩余部分的开仓成本", () => {
    const { t, place } = setup();
    const events = place(crossing);

    const fills = only(events, "fill").map((e) => [e.fill.price, e.fill.qty, e.fill.role]);
    expect(fills).toEqual([
      [parse("50000"), parse("2"), "TAKER"],
      [parse("50000.5"), parse("2"), "TAKER"],
    ]);

    const order = t.engine.snapshot().orders[0]!;
    expect(order).toMatchObject({
      status: "PARTIALLY_FILLED",
      executedQty: parse("4"),
      avgPrice: parse("50000.25"),
      queueAhead: 0n,
      queueEstimated: false,
      // 剩余 1 BTC @ 50,000.5：起始保证金 2,500.025 + 开仓亏损 0.5 + 预留手续费 25.00025
      frozenMargin: parse("2525.52525"),
    });
  });

  it("IOC：成交能成的 4 BTC，剩余过期，不进挂单簿", () => {
    const { t, place } = setup();
    const events = place({ ...crossing, timeInForce: "IOC" });
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({ status: "EXPIRED", executedQty: parse("4") });
    expect(t.engine.snapshot().orders).toEqual([]);
    expect(t.engine.snapshot().positions[0]!.qty).toBe(parse("4"));
  });

  it("FOK：委托价内只能成交 4 BTC，整单过期，一笔都不成交", () => {
    const { t, place } = setup();
    const events = place({ ...crossing, timeInForce: "FOK" });
    expect(types(events)).toEqual(["orderUpdate"]);
    expect(events[0]).toMatchObject({ order: { status: "EXPIRED", executedQty: 0n } });
    expect(t.engine.snapshot().positions).toEqual([]);
    expect(t.ledgerSum("acc-1")).toBe(parse("100000"));
  });

  it("FOK：能全部成交就全部成交", () => {
    const { place } = setup();
    const events = place({ ...crossing, qty: parse("4"), timeInForce: "FOK" });
    expect(only(events, "orderUpdate")[0]!.order.status).toBe("FILLED");
  });

  it("IOC 不穿透盘口：没有可以立即成交的对手盘，直接过期", () => {
    const { place } = setup();
    const events = place({ price: parse("49000"), timeInForce: "IOC" });
    expect(types(events)).toEqual(["orderUpdate"]);
    expect(events[0]).toMatchObject({ order: { status: "EXPIRED", executedQty: 0n } });
  });
});

// ─────────────────────────────────────────────────────────────
// 只减仓：成交时截断（缺口 #18）、残余自动撤销
// ─────────────────────────────────────────────────────────────

describe("只减仓", () => {
  it("成交时最多成交到剩余仓位；仓位没了就不再成交", () => {
    const state = createState(testConfig());
    applyInput(state, registerAccountInput("acc-1", "100000"));
    applyInput(state, bookInput());
    applyInput(state, markPriceInput());
    putPosition(state, testPosition()); // 多 1

    const order = testOrder({ side: "SELL", qty: parse("2"), reduceOnly: true });
    const first = applyFill(state, order, parse("50000"), parse("2"), "MAKER", "o-1:1", T0)!;
    expect(first.fill.qty).toBe(parse("1"));
    expect(first.closedSides).toEqual(["LONG"]);
    expect(applyFill(state, order, parse("50000"), parse("1"), "MAKER", "o-1:2", T0)).toBeNull();
  });

  it("仓位平完后，残余的只减仓挂单自动撤销", () => {
    const { t, place } = setup({ deep: true });
    place({ ...market, qty: parse("5") }); // 多 5

    // 只减仓限价卖 3 @ 49,999.9：买一只有 2 BTC，成交 2，剩 1 挂单（只减仓不冻结保证金）
    place({ side: "SELL", price: parse("49999.9"), qty: parse("3"), reduceOnly: true });
    expect(t.engine.snapshot().orders[0]).toMatchObject({
      id: "o-2",
      status: "PARTIALLY_FILLED",
      frozenMargin: 0n,
    });

    // 市价只减仓卖掉剩下的 3：仓位清零，o-2 自动撤销
    const events = place({ ...market, side: "SELL", qty: parse("3"), reduceOnly: true });
    const canceled = only(events, "orderUpdate").find((e) => e.order.id === "o-2")!.order;
    expect(canceled).toMatchObject({ status: "CANCELED", rejectReason: "仓位已平完，只减仓单自动撤销" });
    expect(t.engine.snapshot().orders).toEqual([]);
    expect(t.engine.snapshot().positions).toEqual([]);
  });
});
