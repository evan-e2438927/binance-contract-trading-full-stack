import { parse, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import {
  T0,
  bookInput,
  markPriceInput,
  orderRequest,
  placeOrderInput,
  registerAccountInput,
  testConfig,
} from "./testing/fixtures";
import { createTestEngine, type TestEngine } from "./testing/harness";
import type { EngineEvent, EngineInput, Level, PlaceOrderRequest } from "./types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架，每次 apply 之后自动对账（不变式 ①～⑧）+ 回滚自检
// ─────────────────────────────────────────────────────────────

function levels(rows: [string, string][]): Level[] {
  return rows.map(([price, qty]) => ({ price: parse(price), qty: parse(qty) }));
}

type BookInput = Extract<EngineInput, { t: "book" }>;

/** 04-backend-design.md 5.5 节算例的盘口：49,900 这一档 3.0 BTC。 */
function book(bids: [string, string][] = [["50000", "1"], ["49950", "2"], ["49900", "3"]], ts = T0): BookInput {
  return {
    t: "book",
    symbol: "BTCUSDT",
    bids: levels(bids),
    asks: levels([
      ["50000.5", "1"],
      ["50050", "2"],
      ["50100", "3"],
    ]),
    ts,
  };
}

let nextTradeId = 1;
function trade(price: string, qty: string, buyerIsMaker: boolean, ts = T0): EngineInput {
  return { t: "trade", symbol: "BTCUSDT", tradeId: nextTradeId++, price: parse(price), qty: parse(qty), buyerIsMaker, ts };
}

function setup({ accounts = ["acc-1"], initialBook = book() }: { accounts?: string[]; initialBook?: EngineInput } = {}) {
  nextTradeId = 1;
  const t = createTestEngine(testConfig());
  for (const id of accounts) t.apply(registerAccountInput(id, "100000"));
  t.apply(initialBook);
  t.apply(markPriceInput("50000"));
  let seq = 0;
  return {
    t,
    place(overrides: Partial<PlaceOrderRequest>, accountId = "acc-1") {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), accountId, `o-${seq}`));
    },
  };
}

function order(t: TestEngine, id = "o-1") {
  return t.engine.snapshot().orders.find((o) => o.id === id);
}

function queue(t: TestEngine, id = "o-1"): Fixed | undefined {
  return order(t, id)?.queueAhead;
}

function only<T extends EngineEvent["t"]>(events: EngineEvent[], t: T): Extract<EngineEvent, { t: T }>[] {
  return events.filter((e): e is Extract<EngineEvent, { t: T }> => e.t === t);
}

function types(events: EngineEvent[]): string[] {
  return events.map((e) => (e.t === "balanceUpdate" ? `balanceUpdate:${e.reason}` : e.t));
}

const buy49900 = { price: parse("49900"), qty: parse("0.5") };

// ─────────────────────────────────────────────────────────────
// 5.5 节完整算例
// ─────────────────────────────────────────────────────────────

describe("04-backend-design.md 5.5 节算例：49,900 挂买 0.5 BTC，T0 → T4 逐行断言", () => {
  it("排队、夹逼、再排队，最后按挂单价成交 0.5 @ 49,900，Maker 费 4.99", () => {
    const { t, place } = setup();

    // T0 下单：该价位盘口 3.0 → queueAhead 3.0
    const placed = place(buy49900);
    expect(types(placed)).toEqual(["orderUpdate"]);
    expect(order(t)).toMatchObject({ status: "NEW", queueAhead: parse("3"), queueEstimated: false });

    // T1 trade @49,900 qty 1.2 m=true → 1.8，不发任何事件
    expect(t.apply(trade("49900", "1.2", true))).toEqual([]);
    expect(queue(t)).toBe(parse("1.8"));

    // T2 盘口：该档只剩 1.5 → 夹逼 min(1.8, 1.5) = 1.5
    expect(t.apply(book([["50000", "1"], ["49950", "2"], ["49900", "1.5"]]))).toEqual([]);
    expect(queue(t)).toBe(parse("1.5"));

    // T3 trade @49,900 qty 0.8 m=true → 0.7
    t.apply(trade("49900", "0.8", true));
    expect(queue(t)).toBe(parse("0.7"));

    // T4 trade @49,900 qty 2.0 m=true → 0.7 用完，剩 1.3 给我，只成交 0.5
    const events = t.apply({ ...trade("49900", "2", true), ts: T0 + 4 });
    expect(types(events)).toEqual(["orderUpdate", "fill", "positionUpdate", "balanceUpdate:FEE"]);

    const fill = only(events, "fill")[0]!.fill;
    expect(fill).toMatchObject({
      id: "o-1:t3", // 挂单成交的 id 用行情的归集成交 id 拼
      qty: parse("0.5"),
      price: parse("49900"), // ★ 成交价是挂单价，不是行情价
      role: "MAKER",
      fee: parse("4.99"), // 49,900 × 0.5 × 0.02%
      ts: T0 + 4,
    });
    expect(only(events, "orderUpdate")[0]!.order).toMatchObject({
      status: "FILLED",
      executedQty: parse("0.5"),
      avgPrice: parse("49900"),
      queueAhead: 0n,
      frozenMargin: 0n,
      updatedAt: T0 + 4,
    });
    expect(t.engine.snapshot().orders).toEqual([]);
    expect(t.engine.snapshot().positions).toEqual([
      expect.objectContaining({ positionSide: "LONG", qty: parse("0.5"), entryPrice: parse("49900") }),
    ]);
    expect(t.ledgerSum("acc-1")).toBe(parse("99995.01"));
  });

  it("穿透场景：T4 收到的是 trade @49,880 m=true → 剩余 0.5 立刻全部成交在 49,900", () => {
    const { t, place } = setup();
    place(buy49900);
    t.apply(trade("49900", "1.2", true));

    const events = t.apply(trade("49880", "0.001", true));
    expect(only(events, "fill")[0]!.fill).toMatchObject({ price: parse("49900"), qty: parse("0.5"), role: "MAKER" });
    expect(only(events, "orderUpdate")[0]!.order.status).toBe("FILLED");
  });
});

// ─────────────────────────────────────────────────────────────
// 06-testing-design.md 第 3 节：排队 6 条
// ─────────────────────────────────────────────────────────────

describe("排队（06-testing-design.md 第 3 节）", () => {
  it("方向错误的成交流不推进队列：买单收到 m=false，queueAhead 不变，也不成交", () => {
    const { t, place } = setup();
    place(buy49900);
    expect(t.apply(trade("49900", "10", false))).toEqual([]);
    expect(t.apply(trade("49000", "10", false))).toEqual([]);
    expect(order(t)).toMatchObject({ queueAhead: parse("3"), executedQty: 0n });
  });

  it("挂单价优于最优价：初始 queueAhead = 0，下一笔在这个价位的成交就轮到我", () => {
    const { t, place } = setup();
    place({ price: parse("50000.2"), qty: parse("0.5") });
    expect(queue(t)).toBe(0n);

    const events = t.apply(trade("50000.2", "0.3", true));
    expect(only(events, "fill")[0]!.fill.qty).toBe(parse("0.3"));
  });

  it("价位从盘口消失（仍在可见范围内）：被吃光或全撤，queueAhead 归零", () => {
    const { t, place } = setup();
    place(buy49900);
    t.apply(book([["50000", "1"], ["49950", "2"], ["49850", "4"]]));
    expect(queue(t)).toBe(0n);
  });
});

describe("排队位置估算与校准（缺口 #20）", () => {
  it("挂单价比可见 20 档还深：用最深档兜底并标记估算；进入可见范围后换成真实值", () => {
    const { t, place } = setup();
    place({ price: parse("49000"), qty: parse("0.5") });
    expect(order(t)).toMatchObject({ queueAhead: parse("3"), queueEstimated: true });

    t.apply(book([["49500", "1"], ["49200", "2"], ["49000", "7.5"]]));
    expect(order(t)).toMatchObject({ queueAhead: parse("7.5"), queueEstimated: false });
  });

  it("价格往反方向跑远、挂单掉出可见范围：保持原来的排队位置，不能归零", () => {
    const { t, place } = setup();
    place(buy49900);
    t.apply(trade("49900", "1", true)); // 2

    // 价格涨上去，买盘最深一档 50,000，49,900 不在视野里了
    t.apply({ ...book([["50100", "1"], ["50050", "1"], ["50000", "1"]]), asks: levels([["50100.5", "1"]]) });
    expect(order(t)).toMatchObject({ queueAhead: parse("2"), queueEstimated: false });
  });

  it("可见范围内的空价位：前方没人，queueAhead = 0 且不是估算", () => {
    const { t, place } = setup();
    place({ price: parse("49920"), qty: parse("0.5") });
    expect(order(t)).toMatchObject({ queueAhead: 0n, queueEstimated: false });
  });
});

// ─────────────────────────────────────────────────────────────
// Maker 成交落账
// ─────────────────────────────────────────────────────────────

describe("Maker 成交", () => {
  it("部分成交：PARTIALLY_FILLED，冻结保证金按剩余数量重算", () => {
    const { t, place } = setup();
    place({ price: parse("49900"), qty: parse("2") });
    // 2 BTC @ 49,900、20x：起始保证金 4,990 + 预留 Taker 手续费 49.9（买单低于标记价，没有开仓亏损）
    expect(order(t)!.frozenMargin).toBe(parse("5039.9"));

    const events = t.apply(trade("49900", "4", true)); // 前方 3，轮到我 1
    expect(only(events, "fill")[0]!.fill.qty).toBe(parse("1"));
    expect(order(t)).toMatchObject({
      status: "PARTIALLY_FILLED",
      executedQty: parse("1"),
      avgPrice: parse("49900"),
      queueAhead: 0n,
      frozenMargin: parse("2519.95"),
    });

    // 再来一笔：队列已经是 0，直接成交剩下的 1
    const rest = t.apply(trade("49900", "1.5", true));
    expect(only(rest, "orderUpdate")[0]!.order).toMatchObject({ status: "FILLED", executedQty: parse("2") });
    expect(t.engine.snapshot().positions[0]).toMatchObject({ qty: parse("2"), entryPrice: parse("49900") });
  });

  it("第 05 讲穿透后剩余的挂单（queueAhead = 0）：下一笔在挂单价的成交直接轮到它，均价按数量加权", () => {
    const { t, place } = setup({ initialBook: bookInput() });
    place({ price: parse("50000.5"), qty: parse("5") }); // 吃掉 4，剩 1 挂单
    expect(order(t)).toMatchObject({ executedQty: parse("4"), avgPrice: parse("50000.25"), queueAhead: 0n });

    const events = t.apply(trade("50000.5", "0.3", true));
    expect(only(events, "fill")[0]!.fill).toMatchObject({ id: "o-1:t1", qty: parse("0.3"), role: "MAKER" });
    // (4 × 50,000.25 + 0.3 × 50,000.5) ÷ 4.3 = 50,000.267441860…
    expect(order(t)).toMatchObject({ executedQty: parse("4.3"), avgPrice: parse("50000.26744186") });
  });

  it("01-domain-knowledge.md 第十二节第 4 步：限价 52,000 平多，Maker 成交，已实现 +2,000、Maker 费 10.4", () => {
    const t = createTestEngine(testConfig());
    t.apply(registerAccountInput("acc-1", "10000"));
    t.apply(bookInput());
    t.apply(markPriceInput("50000"));
    t.engine.restore({
      ...t.engine.snapshot(),
      settings: [{ accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, marginMode: "ISOLATED" }],
    });

    // 第 1 步：10x 逐仓市价开多 1 @ 50,000，Taker 费 25 → 9,975
    t.apply(placeOrderInput(orderRequest({ type: "MARKET", price: undefined, timeInForce: undefined })));
    // 第 2 步：价格涨到 51,000，浮盈不进钱包
    t.apply({ ...book([["51000", "3"]]), asks: levels([["51000.5", "3"], ["52000", "2"]]) });
    t.apply(markPriceInput("51000"));

    // 第 4 步：限价卖 1 @ 52,000 挂单（前方 2），平仓方向不冻结保证金
    t.apply(placeOrderInput(orderRequest({ clientOrderId: "c-2", side: "SELL", price: parse("52000") }), "acc-1", "o-2"));
    expect(order(t, "o-2")).toMatchObject({ queueAhead: parse("2"), frozenMargin: 0n });

    const events = t.apply(trade("52000", "3", false)); // 主动买单吃掉 52,000 这一档
    expect(types(events)).toEqual([
      "orderUpdate",
      "fill",
      "positionUpdate",
      "balanceUpdate:REALIZED_PNL",
      "balanceUpdate:FEE",
    ]);
    expect(only(events, "balanceUpdate").map((e) => [e.delta, e.walletBalance])).toEqual([
      [parse("2000"), parse("11975")],
      [parse("-10.4"), parse("11964.6")],
    ]);
    // 文档里是 11,959.5：少的 5.1 是第 3 步的资金费，第 08 讲把整张表重放一遍
    expect(t.engine.snapshot().positions).toEqual([]);
  });

  it("GTX 挂单和 GTC 一样排队，成交角色是 Maker", () => {
    const { t, place } = setup();
    place({ price: parse("49950"), qty: parse("1"), timeInForce: "GTX" });
    expect(order(t)).toMatchObject({ status: "NEW", queueAhead: parse("2") });

    const events = t.apply(trade("49950", "2.5", true));
    expect(only(events, "fill")[0]!.fill).toMatchObject({ qty: parse("0.5"), role: "MAKER", fee: parse("4.995") });
  });

  it("失真点 #2：同一笔行情成交可以同时让两个用户的挂单成交，按下单时间排序出事件", () => {
    const { t, place } = setup({ accounts: ["acc-1", "acc-2"] });
    place(buy49900, "acc-2");
    place(buy49900, "acc-1");

    const events = t.apply(trade("49880", "0.001", true));
    expect(only(events, "fill").map((e) => [e.fill.orderId, e.fill.accountId, e.fill.qty])).toEqual([
      ["o-1", "acc-2", parse("0.5")],
      ["o-2", "acc-1", parse("0.5")],
    ]);
  });

  it("成交量为 0 的行情（nq = 0，只有 RPI 订单参与）：只更新最新价，不推进队列", () => {
    const { t, place } = setup();
    place(buy49900);
    expect(t.apply(trade("49000", "0", true))).toEqual([]);
    expect(order(t)).toMatchObject({ queueAhead: parse("3"), executedQty: 0n });
  });

  it("只减仓挂单成交平掉仓位后，同一笔行情里后面那张残余只减仓挂单被撤掉、不再成交", () => {
    const { t, place } = setup({ initialBook: bookInput() });
    place({ type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("1") }); // o-1 多 1 @ 50,000

    place({ side: "SELL", price: parse("50001"), qty: parse("1"), reduceOnly: true }); // o-2，前方 3
    place({ side: "SELL", price: parse("50000.5"), qty: parse("1"), reduceOnly: true }); // o-3，前方 2
    expect(order(t, "o-2")!.frozenMargin).toBe(0n);

    // 主动买单一路扫到 50,002：两张卖单都被穿透。o-2 先下单，先成交，平掉全部仓位
    const events = t.apply(trade("50002", "5", false));
    expect(only(events, "fill").map((e) => e.fill.orderId)).toEqual(["o-2"]);
    expect(only(events, "orderUpdate").map((e) => [e.order.id, e.order.status])).toEqual([
      ["o-2", "FILLED"],
      ["o-3", "CANCELED"],
    ]);
    expect(only(events, "fill")[0]!.fill.realizedPnl).toBe(parse("1"));
    expect(t.engine.snapshot().orders).toEqual([]);
    expect(t.engine.snapshot().positions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 撤单
// ─────────────────────────────────────────────────────────────

describe("撤单", () => {
  it("撤掉自己的挂单：CANCELED、从内存移除，冻结保证金随之释放", () => {
    const { t, place } = setup();
    place(buy49900);
    expect(order(t)!.frozenMargin).toBeGreaterThan(0n);

    const events = t.apply({ t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 + 9 });
    expect(events).toEqual([
      {
        t: "orderUpdate",
        order: expect.objectContaining({ id: "o-1", status: "CANCELED", frozenMargin: 0n, updatedAt: T0 + 9 }),
      },
    ]);
    expect(t.engine.snapshot().orders).toEqual([]);

    // 撤掉之后行情再穿过去，也不会成交
    expect(t.apply(trade("49000", "10", true))).toEqual([]);
  });

  it("订单不存在、已经结束、或者不是自己的：一律 ORDER_NOT_FOUND，不改状态", () => {
    const { t, place } = setup({ accounts: ["acc-1", "acc-2"] });
    place(buy49900);

    const rejected = (accountId: string, orderId: string) =>
      t.apply({ t: "cancelOrder", accountId, orderId, ts: T0 });

    for (const [accountId, orderId] of [
      ["acc-2", "o-1"], // 别人的单
      ["acc-1", "o-404"], // 没有这张单
    ] as const) {
      expect(rejected(accountId, orderId)).toEqual([
        {
          t: "rejected",
          accountId,
          input: "cancelOrder",
          clientOrderId: null,
          orderId,
          code: "ORDER_NOT_FOUND",
          message: `订单 ${orderId} 不存在或已经结束`,
          ts: T0,
        },
      ]);
    }
    expect(order(t)).toBeDefined();

    rejected("acc-1", "o-1");
    expect(rejected("acc-1", "o-1")[0]).toMatchObject({ t: "rejected", code: "ORDER_NOT_FOUND" }); // 撤两次
  });
});
