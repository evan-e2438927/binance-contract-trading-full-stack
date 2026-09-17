import { parse, type MarginMode, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { T0, bookInput, markPriceInput, orderRequest, placeOrderInput, registerAccountInput, testConfig } from "./testing/fixtures";
import { createTestEngine } from "./testing/harness";
import type { EngineEvent, PlaceOrderRequest } from "./types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架（不变式 ①～⑨ + 回滚自检）
// ─────────────────────────────────────────────────────────────

const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

function setup({ wallet = "10000", mode = "ONE_WAY" }: { wallet?: string; mode?: PositionMode } = {}) {
  const t = createTestEngine(testConfig());
  t.apply({ ...registerAccountInput("acc-1", wallet), positionMode: mode });
  t.apply(bookInput());
  t.apply(markPriceInput("50000"));
  let seq = 0;
  return {
    t,
    place(overrides: Partial<PlaceOrderRequest>) {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), "acc-1", `o-${seq}`));
    },
    leverage: (leverageNum: number) => t.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum, ts: T0 + 1 }),
    marginMode: (mode: MarginMode) => t.apply({ t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode, ts: T0 + 1 }),
    positionMode: (mode: PositionMode) => t.apply({ t: "setPositionMode", accountId: "acc-1", mode, ts: T0 + 1 }),
    adjust: (delta: string, positionSide: "BOTH" | "LONG" | "SHORT" = "BOTH") =>
      t.apply({ t: "adjustIsolatedMargin", accountId: "acc-1", symbol: "BTCUSDT", positionSide, delta: parse(delta), ts: T0 + 1 }),
    snapshot: () => t.engine.snapshot(),
  };
}

function rejected(events: EngineEvent[]) {
  expect(events).toHaveLength(1);
  return events[0] as Extract<EngineEvent, { t: "rejected" }>;
}

// ─────────────────────────────────────────────────────────────
// 调杠杆
// ─────────────────────────────────────────────────────────────

describe("调杠杆", () => {
  it("没有仓位：直接生效，发 settingUpdate", () => {
    const s = setup();
    expect(s.leverage(10)).toEqual([
      { t: "settingUpdate", setting: { accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, marginMode: "CROSS" } },
    ]);
  });

  it("范围 1 ～ 第 1 层最大杠杆（示例表 125x）；和当前一样也拒（币安 -4028）", () => {
    const s = setup();
    for (const n of [0, 126, 2.5]) expect(rejected(s.leverage(n)).code).toBe("INVALID_PARAMS");
    expect(rejected(s.leverage(20)).message).toContain("当前杠杆已经是 20x");
  });

  it("全仓调高杠杆：仓位杠杆跟着改，起始保证金变少，挂单冻结保证金重算", () => {
    const s = setup({ wallet: "100000" });
    s.place({ ...market, qty: parse("1") }); // 20x 全仓多 1
    s.place({ price: parse("49000"), qty: parse("1") }); // o-2：20x 冻结 2,450 + 24.5 = 2,474.5
    const events = s.leverage(50);
    expect(events.map((e) => e.t)).toEqual(["settingUpdate", "positionUpdate", "orderUpdate"]);
    expect(s.snapshot().positions[0]!.leverageNum).toBe(50);
    expect(s.snapshot().orders[0]!.frozenMargin).toBe(parse("1004.5")); // 980 + 24.5
  });

  it("全仓调低杠杆、可用余额不够多占用的保证金：INSUFFICIENT_MARGIN（币安 -4050）", () => {
    const s = setup({ wallet: "3000" }); // 默认 20x
    s.place({ ...market, qty: parse("1") }); // 20x 起始保证金 2,500，钱包 2,975，可用 475
    const r = rejected(s.leverage(10)); // 10x 要 5,000，多 2,500
    expect(r.code).toBe("INSUFFICIENT_MARGIN");
    expect(s.snapshot().settings).toEqual([]); // 没生效
  });

  it("逐仓有仓位不能调低（币安 -4161），可以调高", () => {
    const s = setup();
    s.marginMode("ISOLATED");
    s.leverage(10);
    s.place({ ...market, qty: parse("1") });
    expect(rejected(s.leverage(5)).message).toContain("不能调低杠杆");
    s.leverage(20);
    expect(s.snapshot().positions[0]).toMatchObject({ leverageNum: 20, isolatedMargin: parse("5000") }); // 保证金不动
  });

  it("持仓名义价值超过新杠杆允许的上限：LEVERAGE_TOO_HIGH（币安 -2027）", () => {
    const s = setup({ wallet: "100000" });
    s.place({ ...market, qty: parse("2") }); // 名义价值约 100,000
    const r = rejected(s.leverage(125)); // 125x 只允许第 1 层 50,000
    expect(r.code).toBe("LEVERAGE_TOO_HIGH");
  });
});

// ─────────────────────────────────────────────────────────────
// 切保证金模式 / 持仓模式
// ─────────────────────────────────────────────────────────────

describe("切保证金模式", () => {
  it("没有持仓和挂单：生效", () => {
    const s = setup();
    expect(s.marginMode("ISOLATED")[0]).toMatchObject({ t: "settingUpdate", setting: { marginMode: "ISOLATED", leverageNum: 20 } });
  });

  it("和当前一样（-4046）、有挂单（-4047）、有持仓（-4048）都拒", () => {
    const s = setup();
    expect(rejected(s.marginMode("CROSS")).code).toBe("INVALID_PARAMS");
    s.place({ price: parse("49000"), qty: parse("0.1") });
    expect(rejected(s.marginMode("ISOLATED")).message).toContain("挂单");
    s.t.apply({ t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 });
    s.place({ ...market, qty: parse("0.1") });
    expect(rejected(s.marginMode("ISOLATED"))).toMatchObject({ code: "MARGIN_MODE_LOCKED" });
  });
});

describe("切持仓模式", () => {
  it("没有持仓和挂单：生效，发 positionModeUpdate", () => {
    const s = setup();
    expect(s.positionMode("HEDGE")).toEqual([{ t: "positionModeUpdate", accountId: "acc-1", positionMode: "HEDGE", ts: T0 + 1 }]);
    expect(s.snapshot().accounts[0]!.positionMode).toBe("HEDGE");
  });

  it("和当前一样（-4059）、有挂单（-4067）、有持仓（-4068）都拒", () => {
    const s = setup();
    expect(rejected(s.positionMode("ONE_WAY")).code).toBe("INVALID_PARAMS");
    s.place({ price: parse("49000"), qty: parse("0.1") });
    expect(rejected(s.positionMode("HEDGE")).code).toBe("POSITION_MODE_LOCKED");
    s.t.apply({ t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 });
    s.place({ ...market, qty: parse("0.1") });
    expect(rejected(s.positionMode("HEDGE")).code).toBe("POSITION_MODE_LOCKED");
  });
});

// ─────────────────────────────────────────────────────────────
// 调逐仓保证金
// ─────────────────────────────────────────────────────────────

describe("调逐仓保证金（币安 FAQ 最多可加 / 可减公式）", () => {
  /** 10x 逐仓多 1 @ 50,000：钱包 9,975，逐仓保证金 5,000，全仓钱包 4,975，可用 4,975。 */
  function isolatedLong() {
    const s = setup();
    s.marginMode("ISOLATED");
    s.leverage(10);
    s.place({ ...market, qty: parse("1") });
    return s;
  }

  it("追加：最多 min(全仓钱包 4,975 − 0 − 0, 可用 4,975) = 4,975；不动钱包、不写流水", () => {
    const s = isolatedLong();
    expect(rejected(s.adjust("4975.00000001")).code).toBe("INSUFFICIENT_MARGIN");
    const events = s.adjust("4975");
    expect(events).toEqual([{ t: "positionUpdate", position: expect.objectContaining({ isolatedMargin: parse("9975") }) }]);
    expect(s.snapshot().accounts[0]!.walletBalance).toBe(parse("9975"));
  });

  it("减少：标记价 = 开仓价时一分都不能减（逐仓保证金 + 浮盈亏 − 标记价 × 数量 ÷ 杠杆 = 0）", () => {
    const s = isolatedLong();
    expect(rejected(s.adjust("-0.00000001")).code).toBe("MARGIN_WOULD_LIQUIDATE");
  });

  it("减少：标记价 52,000 时最多 min(5,000 − 维持保证金 210, 5,000 + 2,000 − 5,200) = 1,800", () => {
    const s = isolatedLong();
    s.t.apply(markPriceInput("52000"));
    expect(rejected(s.adjust("-1800.00000001")).code).toBe("MARGIN_WOULD_LIQUIDATE");
    s.adjust("-1800");
    expect(s.snapshot().positions[0]!.isolatedMargin).toBe(parse("3200"));
  });

  it("没有仓位 POSITION_NOT_FOUND；全仓仓位、金额为 0 INVALID_PARAMS；单向模式传 LONG POSITION_SIDE_MISMATCH", () => {
    const s = setup();
    expect(rejected(s.adjust("1")).code).toBe("POSITION_NOT_FOUND");
    s.place({ ...market, qty: parse("0.1") }); // 全仓
    expect(rejected(s.adjust("1")).message).toContain("只有逐仓仓位");
    expect(rejected(s.adjust("0")).code).toBe("INVALID_PARAMS");
    expect(rejected(s.adjust("1", "LONG")).code).toBe("POSITION_SIDE_MISMATCH");
  });
});

// ─────────────────────────────────────────────────────────────
// 账户重置
// ─────────────────────────────────────────────────────────────

describe("账户重置", () => {
  it("撤单 → 按标记价平仓记已实现盈亏 → RESET 流水把钱包设回 10,000；设置保留", () => {
    const s = setup();
    s.leverage(10);
    s.place({ ...market, qty: parse("1") }); // 钱包 9,975
    s.place({ price: parse("49000"), qty: parse("0.01") });
    s.t.apply(markPriceInput("49000"));

    const events = s.t.apply({ t: "resetAccount", accountId: "acc-1", walletBalance: parse("10000"), ts: T0 + 9 });
    expect(events.map((e) => (e.t === "balanceUpdate" ? `${e.t}:${e.reason}` : e.t))).toEqual([
      "orderUpdate",
      "positionUpdate",
      "balanceUpdate:REALIZED_PNL",
      "balanceUpdate:RESET",
    ]);
    const balances = events.filter((e): e is Extract<EngineEvent, { t: "balanceUpdate" }> => e.t === "balanceUpdate");
    expect(balances.map((e) => [e.delta, e.walletBalance])).toEqual([
      [parse("-1000"), parse("8975")],
      [parse("1025"), parse("10000")],
    ]);
    expect(s.snapshot()).toMatchObject({ orders: [], positions: [], accounts: [{ walletBalance: parse("10000") }] });
    expect(s.snapshot().settings[0]!.leverageNum).toBe(10);
    expect(s.t.ledgerSum("acc-1")).toBe(parse("10000"));
  });
});
