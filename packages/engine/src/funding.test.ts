import { parse, type MarginMode, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { T0, bookInput, markPriceInput, orderRequest, placeOrderInput, registerAccountInput, testConfig } from "./testing/fixtures";
import { createTestEngine } from "./testing/harness";
import type { EngineEvent, EngineInput, PlaceOrderRequest } from "./types";

// ─────────────────────────────────────────────────────────────
// 测试工具：全部走测试脚手架（不变式 ①～⑨ + 回滚自检）
// ─────────────────────────────────────────────────────────────

const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

function setup({ wallet = "10000", mode = "ONE_WAY", marginMode = "CROSS", leverageNum = 20 }: {
  wallet?: string;
  mode?: PositionMode;
  marginMode?: MarginMode;
  leverageNum?: number;
} = {}) {
  const t = createTestEngine(testConfig());
  t.apply({ ...registerAccountInput("acc-1", wallet), positionMode: mode });
  t.apply(bookInput());
  t.apply(markPriceInput("50000"));
  if (marginMode !== "CROSS") t.apply({ t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode: marginMode, ts: T0 });
  if (leverageNum !== 20) t.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum, ts: T0 });
  let seq = 0;
  return {
    t,
    place(overrides: Partial<PlaceOrderRequest>) {
      seq++;
      return t.apply(placeOrderInput(orderRequest({ clientOrderId: `c-${seq}`, ...overrides }), "acc-1", `o-${seq}`));
    },
    wallet: () => t.engine.snapshot().accounts[0]!.walletBalance,
  };
}

function settle(rate: string, markPrice = "50000", ts = T0 + 1): EngineInput {
  return { t: "settleFunding", symbol: "BTCUSDT", rate: parse(rate), markPrice: parse(markPrice), ts };
}

function only<T extends EngineEvent["t"]>(events: EngineEvent[], t: T): Extract<EngineEvent, { t: T }>[] {
  return events.filter((e): e is Extract<EngineEvent, { t: T }> => e.t === t);
}

// ─────────────────────────────────────────────────────────────
// 06-testing-design.md 第 3 节：资金费 4 条
// ─────────────────────────────────────────────────────────────

describe("资金费结算（06-testing-design.md 第 3 节）", () => {
  it("正费率多头付出：名义价值（标记价）× 费率，钱包减少，流水为负", () => {
    const { t, place, wallet } = setup();
    place({ ...market, qty: parse("1") }); // 全仓多 1 @ 50,000，钱包 9,975

    const events = t.apply(settle("0.0001", "51000"));
    expect(events.map((e) => e.t)).toEqual(["fundingPaid", "balanceUpdate"]); // 全仓：不动仓位
    expect(only(events, "fundingPaid")[0]!.payment).toEqual({
      id: `funding:acc-1:BTCUSDT:LONG:${T0 + 1}`,
      accountId: "acc-1",
      symbol: "BTCUSDT",
      positionSide: "LONG",
      fundingRate: parse("0.0001"),
      markPrice: parse("51000"),
      notional: parse("51000"),
      amount: parse("-5.1"),
      ts: T0 + 1,
    });
    expect(only(events, "balanceUpdate")[0]).toMatchObject({
      delta: parse("-5.1"),
      walletBalance: parse("9969.9"),
      reason: "FUNDING",
      ref: { type: "funding", id: `funding:acc-1:BTCUSDT:LONG:${T0 + 1}` },
    });
    expect(wallet()).toBe(parse("9969.9"));
  });

  it("负费率多头收到：钱包增加", () => {
    const { t, place, wallet } = setup();
    place({ ...market, qty: parse("1") });
    t.apply(settle("-0.0001"));
    expect(wallet()).toBe(parse("9980")); // 9,975 + 5
  });

  it("★ 结算后触发强平：扣完资金费，逐仓仓位权益跌破维持保证金，同一次 apply 里立刻强平", () => {
    const { t, place } = setup({ marginMode: "ISOLATED", leverageNum: 10 });
    place({ ...market, qty: parse("1") }); // 逐仓多 1 @ 50,000，保证金 5,000
    t.apply({ t: "book", symbol: "BTCUSDT", bids: [{ price: parse("45170"), qty: parse("5") }], asks: [{ price: parse("45170.5"), qty: parse("5") }], ts: T0 });
    // 45,180.8：权益 180.8 > 维持保证金 180.7232，不强平
    expect(t.apply(markPriceInput("45180.8"))).toEqual([]);

    // 资金费 45,180.8 × 0.01% = 4.51808，逐仓保证金 → 4,995.48192，权益 176.28 ≤ 180.7232
    const events = t.apply(settle("0.0001", "45180.8"));
    expect(events.map((e) => e.t).slice(0, 3)).toEqual(["fundingPaid", "positionUpdate", "balanceUpdate"]);
    expect(only(events, "positionUpdate")[0]!.position.isolatedMargin).toBe(parse("4995.48192"));
    expect(only(events, "liquidation")).toHaveLength(1);
    expect(t.engine.snapshot().positions).toEqual([]);
  });

  it("结算时无仓位：不产生任何事件、任何流水", () => {
    const { t } = setup();
    expect(t.apply(settle("0.0001"))).toEqual([]);
    expect(t.ledgerSum("acc-1")).toBe(parse("10000"));
  });
});

describe("资金费细节", () => {
  it("逐仓仓位：钱包余额和逐仓保证金一起变（币安：资金费发生在逐仓仓位上时改的是那个仓位的 isolated wallet）", () => {
    const { t, place, wallet } = setup({ marginMode: "ISOLATED", leverageNum: 10 });
    place({ ...market, qty: parse("1") });
    const events = t.apply(settle("0.0001", "51000"));
    expect(only(events, "positionUpdate")[0]!.position.isolatedMargin).toBe(parse("4994.9"));
    expect(wallet()).toBe(parse("9969.9"));
  });

  it("空头正费率收到；双向模式多空两个仓位各算各的", () => {
    const { t, place, wallet } = setup({ wallet: "100000", mode: "HEDGE" });
    place({ ...market, positionSide: "LONG", qty: parse("1") }); // 手续费 25
    place({ ...market, side: "SELL", positionSide: "SHORT", qty: parse("2") }); // 2 @ 49,999.9，手续费 49.9999
    const before = wallet();
    const events = t.apply(settle("0.0001"));
    expect(only(events, "fundingPaid").map((e) => [e.payment.positionSide, e.payment.amount])).toEqual([
      ["LONG", parse("-5")],
      ["SHORT", parse("10")],
    ]);
    expect(wallet()).toBe(before + parse("5"));
  });

  it("费率为 0：没有资金往来，不记流水", () => {
    const { t, place } = setup();
    place({ ...market, qty: parse("1") });
    expect(t.apply(settle("0"))).toEqual([]);
  });
});
