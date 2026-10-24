import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import { createEngine } from "../../../../packages/engine/src/create-engine";
import { floorToLot } from "../../../../packages/engine/src/preview";
import { markPriceInput, registerAccountInput, testConfig, testOrder, testPosition } from "../../../../packages/engine/src/testing/fixtures";
import type { Engine, EngineInput, Order, Position } from "../../../../packages/engine/src/types";

function run(engine: Engine, input: EngineInput) {
  const events = engine.apply(input);
  engine.commit();
  return events;
}

/** 摆好持仓 / 挂单，再喂一个标记价——预估是只读的，不用走下单流程 */
function engineWith(options: { positions?: Position[]; orders?: Order[]; wallet?: string; mark?: string } = {}): Engine {
  const engine = createEngine(testConfig(), {
    accounts: [{ id: "acc-1", walletBalance: parse(options.wallet ?? "10000"), positionMode: "ONE_WAY" }],
    settings: [],
    positions: options.positions ?? [],
    orders: options.orders ?? [],
  });
  run(engine, markPriceInput(options.mark ?? "50000"));
  return engine;
}

describe("floorToLot", () => {
  it("按 minQty + k × stepSize 向下取（校验链第 5 步的口径）", () => {
    const lot = { minQty: parse("0.001"), stepSize: parse("0.001") };
    expect(floorToLot(parse("1.2345"), lot)).toBe(parse("1.234"));
    expect(floorToLot(parse("0.0005"), lot)).toBe(0n);
  });
});

describe("symbolConfigView", () => {
  it("没设置过时给默认杠杆和保证金模式，带上该币对最高杠杆和当前杠杆的名义价值上限", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("acc-1"));
    const view = engine.symbolConfigView("acc-1", "BTCUSDT");
    expect(view).toMatchObject({ symbol: "BTCUSDT", marginMode: "CROSS" });
    expect(view!.maxLeverageNum).toBeGreaterThan(0);
    expect(view!.maxNotional).toBeGreaterThan(0n);
  });

  it("改过杠杆之后读到的是新值", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("acc-1"));
    run(engine, { t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, ts: 1 });
    expect(engine.symbolConfigView("acc-1", "BTCUSDT")!.leverageNum).toBe(10);
  });

  it("账户不存在返回 null", () => {
    const engine = createEngine(testConfig());
    expect(engine.symbolConfigView("nobody", "BTCUSDT")).toBeNull();
  });
});

describe("previewOrder", () => {
  it("没有标记价：全是 null，并说明原因", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("acc-1"));
    const view = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: null, qty: parse("1") });
    expect(view).toMatchObject({ price: null, cost: null, maxQty: null, liquidationPrice: null });
    expect(view.warnings[0]).toContain("标记价");
  });

  it("市价单用标记价估，限价单用委托价", () => {
    const engine = engineWith();
    const market = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: null, qty: null });
    const limit = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("49000"), qty: null });
    expect(market.price).toBe(parse("50000"));
    expect(limit.price).toBe(parse("49000"));
  });

  it("开仓成本和校验链是同一个数：默认 20x 买 1 BTC @ 50,000 → 保证金 2,500 + Taker 手续费 25", () => {
    const engine = engineWith();
    const view = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: parse("1") });
    expect(format(view.cost!, 2)).toBe("2525.00");
  });

  it("可开最大数量真的下得进去：按它下单不会被可用余额拒", () => {
    const engine = engineWith({ wallet: "10000" });
    const view = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: null });
    const maxQty = view.maxQty!;
    expect(maxQty).toBeGreaterThan(0n);

    const atMax = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: maxQty });
    expect(atMax.cost!).toBeLessThanOrEqual(parse("10000"));

    // 再多一档就超出可用余额（说明给的是真正的上限，不是保守到没边）
    const over = engine.previewOrder({
      accountId: "acc-1",
      symbol: "BTCUSDT",
      side: "BUY",
      positionSide: "BOTH",
      price: parse("50000"),
      qty: maxQty + parse("0.001"),
    });
    expect(over.cost!).toBeGreaterThan(parse("10000"));
  });

  it("已有仓位和同方向挂单都会占掉可开额度", () => {
    const empty = engineWith({ wallet: "10000" });
    const withOrder = engineWith({ wallet: "10000", orders: [testOrder({ id: "o-9", frozenMargin: parse("2525") })] });
    const a = empty.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: null });
    const b = withOrder.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: null });
    expect(b.maxQty!).toBeLessThan(a.maxQty!);
  });

  it("全仓开仓的强平价：和这笔成交落到仓位上之后仓位视图给的强平价一致", () => {
    const engine = engineWith({ wallet: "10000" });
    const preview = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: parse("1") });

    // 同样的仓位直接摆出来（手续费还没扣，所以钱包还是 10,000），两边应该算出同一个强平价
    const settled = engineWith({ wallet: "10000", positions: [testPosition()] });
    expect(preview.liquidationPrice).toBe(settled.positionViews("acc-1")[0]!.liquidationPrice);
  });

  it("加仓：强平价按加权平均开仓价算", () => {
    const engine = engineWith({ wallet: "10000", positions: [testPosition()] });
    const preview = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("52000"), qty: parse("1") });
    const merged = engineWith({ wallet: "10000", positions: [testPosition({ qty: parse("2"), entryPrice: parse("51000") })] });
    expect(preview.liquidationPrice).toBe(merged.positionViews("acc-1")[0]!.liquidationPrice);
  });

  it("单向模式下反方向下单是平仓：不估成本和强平价，但仍然给可开最大", () => {
    const engine = engineWith({ wallet: "10000", positions: [testPosition()] });
    const view = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "SELL", positionSide: "BOTH", price: parse("50000"), qty: parse("1") });
    expect(view.cost).toBeNull();
    expect(view.liquidationPrice).toBeNull();
    expect(view.maxQty).not.toBeNull();
    expect(view.warnings[0]).toContain("平仓");
  });

  it("逐仓开仓的强平价只看这个仓位自己的保证金", () => {
    const engine = engineWith({ wallet: "10000" });
    run(engine, { t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode: "ISOLATED", ts: 2 });
    const view = engine.previewOrder({ accountId: "acc-1", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: parse("50000"), qty: parse("1") });
    expect(view.marginMode).toBe("ISOLATED");
    // 逐仓保证金只有这一单的成本，强平价比全仓（有整个钱包垫着）高得多
    const cross = engineWith({ wallet: "10000" }).previewOrder({
      accountId: "acc-1",
      symbol: "BTCUSDT",
      side: "BUY",
      positionSide: "BOTH",
      price: parse("50000"),
      qty: parse("1"),
    });
    expect(view.liquidationPrice!).toBeGreaterThan(cross.liquidationPrice!);
  });

  it("账户不存在：给原因，不抛错", () => {
    const engine = engineWith();
    const view = engine.previewOrder({ accountId: "nobody", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: null, qty: null });
    expect(view.warnings).toEqual(["账户不存在"]);
  });
});
