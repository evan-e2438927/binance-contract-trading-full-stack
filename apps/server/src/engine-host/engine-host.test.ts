import { createEngine, type EngineEvent, type EngineInput } from "@binance-contract-trading-full-stack/engine";
import {
  T0,
  bookInput,
  markPriceInput,
  orderRequest,
  placeOrderInput,
  registerAccountInput,
  testConfig,
} from "@binance-contract-trading-full-stack/engine/testing/fixtures";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createEngineHost } from "./engine-host";

const silent = { log: () => {}, error: () => {} };
const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

function setup({ ready = true } = {}) {
  const engine = createEngine(testConfig());
  const written: EngineEvent[][] = [];
  const state = { failNext: false, ready, persistDelayMs: 0 };
  const host = createEngineHost({
    engine,
    logger: silent,
    isSymbolReady: () => state.ready,
    async persist(events) {
      if (state.persistDelayMs) await new Promise((r) => setTimeout(r, state.persistDelayMs));
      if (state.failNext) {
        state.failNext = false;
        throw new Error("数据库挂了");
      }
      written.push([...events]);
    },
  });
  return { engine, host, written, state };
}

async function ready(host: ReturnType<typeof setup>["host"]) {
  await host.submit(registerAccountInput("acc-1", "100000"));
  host.feedMarket(bookInput());
  host.feedMarket(markPriceInput("50000"));
  await host.idle();
}

describe("串行处理", () => {
  it("并发提交也按顺序一个个 apply → 落库 → commit，不会撞上\"上一次还没结算\"", async () => {
    const { host, written, state } = setup();
    await ready(host);
    state.persistDelayMs = 5;
    const results = await Promise.all(
      [1, 2, 3].map((n) => host.submit(placeOrderInput(orderRequest({ ...market, clientOrderId: `c-${n}`, qty: parse("0.1") }), "acc-1", `o-${n}`, T0 + n))),
    );
    expect(results.map((events) => events[0]!.t)).toEqual(["orderUpdate", "orderUpdate", "orderUpdate"]);
    expect(written.map((events) => (events[0] as Extract<EngineEvent, { t: "orderUpdate" }>).order?.id).slice(-3)).toEqual(["o-1", "o-2", "o-3"]);
  });

  it("没有事件的输入不落库", async () => {
    const { host, written } = setup();
    host.feedMarket(bookInput());
    host.feedMarket(markPriceInput("50000"));
    await host.idle();
    expect(written).toEqual([]);
  });
});

describe("落库失败", () => {
  it("★ rollback：内存回到 apply 之前，和数据库一致；调用方拿到错误；之后的输入照常处理", async () => {
    const { engine, host, state } = setup();
    await ready(host);
    const before = engine.snapshot();

    state.failNext = true;
    await expect(host.submit(placeOrderInput(orderRequest({ ...market, qty: parse("1") })))).rejects.toThrow("数据库挂了");
    expect(engine.snapshot()).toEqual(before);

    const events = await host.submit(placeOrderInput(orderRequest({ ...market, qty: parse("1") })));
    expect(events[0]).toMatchObject({ t: "orderUpdate", order: { status: "FILLED" } });
  });

  it("引擎抛程序错误：引擎已自动撤销，宿主不再 rollback，队列不卡死", async () => {
    const { host } = setup();
    await expect(host.submit({ t: "setLeverage", accountId: "ghost", symbol: "BTCUSDT", leverageNum: 10, ts: T0 })).rejects.toThrow(/不在引擎里/);
    await expect(host.submit(registerAccountInput("acc-1"))).resolves.toHaveLength(1);
  });
});

describe("行情没就绪（缺口 #16 宿主一半）", () => {
  it("下单直接拒 MARKET_NOT_READY，不进引擎", async () => {
    const { engine, host, state } = setup();
    await ready(host);
    state.ready = false;
    const events = await host.submit(placeOrderInput(orderRequest({ ...market, qty: parse("1") })));
    expect(events).toEqual([expect.objectContaining({ t: "rejected", code: "MARKET_NOT_READY" })]);
    expect(engine.snapshot().positions).toEqual([]);
  });

  it("行情成交、标记价丢掉；盘口照常喂", async () => {
    const { engine, host, state } = setup({ ready: false });
    await host.submit(registerAccountInput("acc-1", "100000"));
    host.feedMarket(bookInput());
    host.feedMarket(markPriceInput("50000"));
    await host.idle();
    state.ready = true;
    // 标记价被丢了：校验链第 2 步会报行情未就绪
    const events = await host.submit(placeOrderInput(orderRequest({ ...market, qty: parse("1") })));
    expect(events[0]).toMatchObject({ t: "rejected", code: "MARKET_NOT_READY" });
    expect(engine.snapshot().orders).toEqual([]);
  });

  it("资金费结算跳过", async () => {
    const { host, state } = setup();
    state.ready = false;
    const input: EngineInput = { t: "settleFunding", symbol: "BTCUSDT", rate: parse("0.0001"), markPrice: parse("50000"), ts: T0 };
    await expect(host.submit(input)).resolves.toEqual([]);
  });
});

describe("盘口合并", () => {
  it("队列里还没处理的旧盘口被新盘口替换，只 apply 最新的", async () => {
    const { engine, host, state } = setup();
    await ready(host);
    state.persistDelayMs = 20;
    const slow = host.submit(placeOrderInput(orderRequest({ ...market, qty: parse("0.1") })));
    for (let i = 1; i <= 5; i++) {
      host.feedMarket({ ...bookInput(T0 + i), asks: [{ price: parse(String(50000 + i)), qty: parse("1") }] });
    }
    await slow;
    await host.idle();
    // 只有最新的盘口进了引擎：以卖一 50,005 成交
    const events = await host.submit(placeOrderInput(orderRequest({ ...market, clientOrderId: "c-2", qty: parse("0.1") }), "acc-1", "o-2"));
    expect(events.find((e) => e.t === "fill")).toMatchObject({ fill: { price: parse("50005") } });
    expect(engine.snapshot().orders).toEqual([]);
  });
});
