import { divRound, format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createEngine } from "./create-engine";
import { initialMargin, notional, unrealizedPnl } from "./formulas";
import { T0, bookInput, markPriceInput, registerAccountInput, testConfig, testOrder, testPosition } from "./testing/fixtures";
import type { Engine, EngineInput, Position } from "./types";

/** 直接用快照摆出想要的持仓，再喂行情——视图只读，不需要走下单流程 */
function engineWith(positions: Position[], wallet = "10000", orders = [] as ReturnType<typeof testOrder>[]): Engine {
  const engine = createEngine(testConfig(), {
    accounts: [{ id: "acc-1", walletBalance: parse(wallet), positionMode: "ONE_WAY" }],
    settings: [],
    positions,
    orders,
  });
  return engine;
}

function run(engine: Engine, input: EngineInput) {
  const events = engine.apply(input);
  engine.commit();
  return events;
}

describe("只读视图（第 13 讲）", () => {
  it("新账户：钱包 = 可用余额，其它都是 0，保证金率 0", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("acc-1"));
    expect(engine.accountView("acc-1")).toEqual({
      accountId: "acc-1",
      positionMode: "ONE_WAY",
      walletBalance: parse("10000"),
      crossWalletBalance: parse("10000"),
      unrealizedPnl: 0n,
      crossUnrealizedPnl: 0n,
      marginBalance: parse("10000"),
      positionInitialMargin: 0n,
      openOrderMargin: 0n,
      maintMargin: 0n,
      availableBalance: parse("10000"),
      marginRatio: 0n,
      missingMarkPrices: [],
    });
    expect(engine.positionViews("acc-1")).toEqual([]);
    expect(engine.accountView("nobody")).toBeNull();
  });

  it("全仓多头：各字段按币安口径（起始保证金按标记价、ROE = 浮盈 ÷ 按标记价的起始保证金）", () => {
    const engine = engineWith([testPosition()], "10000", [testOrder({ id: "o-9", frozenMargin: parse("2525") })]);
    run(engine, markPriceInput("51000"));

    const [p] = engine.positionViews("acc-1");
    expect(p).toMatchObject({
      symbol: "BTCUSDT",
      positionSide: "LONG",
      markPrice: parse("51000"),
      notional: parse("51000"),
      unrealizedPnl: parse("1000"),
      initialMargin: parse("2550"), // 51,000 ÷ 20，不是开仓价的 2,500
      maintMargin: parse("205"), // 名义价值 51,000 在第 2 层：×0.5% − 50
      isolatedMargin: 0n,
    });
    expect(p!.roe).toBe(divRound(parse("1000"), parse("2550")));

    const view = engine.accountView("acc-1")!;
    expect(view).toMatchObject({
      unrealizedPnl: parse("1000"),
      marginBalance: parse("11000"),
      positionInitialMargin: parse("2550"),
      openOrderMargin: parse("2525"),
      maintMargin: parse("205"),
      // 可用余额是引擎下单校验用的同一个数：钱包 + 全仓浮盈 − 全仓起始保证金（开仓价口径）− 挂单冻结
      availableBalance: parse("10000") + parse("1000") - initialMargin(parse("1"), parse("50000"), 20) - parse("2525"),
    });
    expect(view.marginRatio).toBe(divRound(parse("205"), parse("11000")));
  });

  it("★ 展示的强平价和风控真正强平的位置一致：标记价比强平价高一点不强平、低一点就强平（全仓 / 逐仓 / 双向）", () => {
    const cases: { name: string; positions: Position[]; mode?: "HEDGE"; wallet: string }[] = [
      { name: "全仓单向多头", positions: [testPosition({ qty: parse("2"), leverageNum: 20 })], wallet: "8000" },
      {
        name: "逐仓空头",
        positions: [testPosition({ positionSide: "SHORT", marginMode: "ISOLATED", isolatedMargin: parse("3000"), leverageNum: 20 })],
        wallet: "10000",
      },
      {
        name: "双向全仓多空两条腿",
        mode: "HEDGE",
        positions: [testPosition({ qty: parse("2") }), testPosition({ positionSide: "SHORT", qty: parse("0.5"), entryPrice: parse("52000") })],
        wallet: "6000",
      },
    ];
    for (const c of cases) {
      const build = () => {
        const engine = createEngine(testConfig(), {
          accounts: [{ id: "acc-1", walletBalance: parse(c.wallet), positionMode: c.mode ?? "ONE_WAY" }],
          settings: [],
          positions: c.positions,
          orders: [],
        });
        run(engine, bookInput());
        run(engine, markPriceInput("50000"));
        return engine;
      };
      const liq = build().positionViews("acc-1")[0]!.liquidationPrice!;
      expect(liq, c.name).not.toBeNull();
      const isShortSide = c.positions[0]!.positionSide === "SHORT";
      const safe = isShortSide ? liq - parse("0.01") : liq + parse("0.01");
      const unsafe = isShortSide ? liq + parse("0.01") : liq - parse("0.01");

      const stillAlive = build();
      expect(run(stillAlive, markPriceInput(format(safe))).some((e) => e.t === "liquidation"), `${c.name} 强平价 ${format(liq, 2)} 外侧不该强平`).toBe(false);
      const liquidated = build();
      expect(run(liquidated, markPriceInput(format(unsafe))).some((e) => e.t === "liquidation"), `${c.name} 强平价 ${format(liq, 2)} 内侧应该强平`).toBe(true);
    }
  });

  it("缺标记价：依赖它的字段为 null 并点名币对，不拿 0 顶替；逐仓强平价不需要标记价，照样算", () => {
    const engine = engineWith([testPosition({ marginMode: "ISOLATED", isolatedMargin: parse("5000"), leverageNum: 10 })]);
    const view = engine.accountView("acc-1")!;
    expect(view).toMatchObject({ unrealizedPnl: null, marginBalance: null, maintMargin: null, availableBalance: parse("5000"), missingMarkPrices: ["BTCUSDT"] });
    const [p] = engine.positionViews("acc-1");
    expect(p).toMatchObject({ markPrice: null, notional: null, unrealizedPnl: null, initialMargin: null, roe: null });
    expect(format(p!.liquidationPrice!, 2)).toBe("45180.72"); // 算例 A
  });

  it("有未结算的 apply 时读视图直接抛错：读到的必须是已经落库的状态", () => {
    const engine = engineWith([testPosition()]);
    engine.apply(markPriceInput("50000"));
    expect(() => engine.accountView("acc-1")).toThrow("未结算");
    expect(() => engine.positionViews("acc-1")).toThrow("未结算");
    expect(() => engine.openOrders("acc-1")).toThrow("未结算");
    engine.commit();
    expect(engine.accountView("acc-1")).not.toBeNull();
  });

  it("openOrders 按下单时间排序，返回的是拷贝，改了不影响引擎", () => {
    const engine = engineWith([], "10000", [testOrder({ id: "o-2", createdAt: T0 + 1 }), testOrder({ id: "o-1", clientOrderId: "c-0" })]);
    const orders = engine.openOrders("acc-1");
    expect(orders.map((o) => o.id)).toEqual(["o-1", "o-2"]);
    orders[0]!.qty = 999n;
    expect(engine.openOrders("acc-1")[0]!.qty).toBe(parse("1"));
    expect(engine.openOrders("someone-else")).toEqual([]);
  });

  it("ROE 的分母和浮盈用同一个标记价（逐仓空头亏损为负）", () => {
    const engine = engineWith([testPosition({ positionSide: "SHORT", marginMode: "ISOLATED", isolatedMargin: parse("5000"), leverageNum: 10 })]);
    run(engine, markPriceInput("52000"));
    const [p] = engine.positionViews("acc-1");
    const pnl = unrealizedPnl({ positionSide: "SHORT", qty: parse("1"), entryPrice: parse("50000") }, parse("52000"));
    expect(p!.unrealizedPnl).toBe(pnl);
    expect(p!.roe).toBe(divRound(pnl, initialMargin(parse("1"), parse("52000"), 10)));
    expect(p!.notional).toBe(notional(parse("1"), parse("52000")));
    expect(p!.roe! < 0n).toBe(true);
  });

  it("marketView：引擎撮合用的盘口和价格；没收到的部分为 null；未知币对 null；返回拷贝", () => {
    const engine = createEngine(testConfig());
    expect(engine.marketView("BTCUSDT")).toEqual({
      symbol: "BTCUSDT",
      bids: [],
      asks: [],
      bookTs: null,
      markPrice: null,
      fundingRate: null,
      nextFundingTs: null,
      markTs: null,
      lastPrice: null,
    });
    run(engine, bookInput());
    run(engine, markPriceInput("50000"));
    const view = engine.marketView("BTCUSDT")!;
    expect(view).toMatchObject({ bookTs: T0, markPrice: parse("50000"), markTs: T0 });
    expect(view.asks[0]).toEqual({ price: parse("50000"), qty: parse("2") });
    view.asks[0]!.qty = 0n;
    expect(engine.marketView("BTCUSDT")!.asks[0]!.qty).toBe(parse("2"));
    expect(engine.marketView("NOPE")).toBeNull();
  });

  it("allAccountViews：全部账户按 id 排序", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("b"));
    run(engine, registerAccountInput("a", "500"));
    expect(engine.allAccountViews().map((v) => [v.accountId, v.walletBalance])).toEqual([
      ["a", parse("500")],
      ["b", parse("10000")],
    ]);
  });
});
