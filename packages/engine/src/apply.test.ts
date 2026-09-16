import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { applyInput } from "./apply";
import { createState } from "./state";
import { T0, registerAccountInput, testConfig } from "./testing/fixtures";

describe("registerAccount", () => {
  it("开户产出一条 INITIAL 的 balanceUpdate，并把账户放进内存", () => {
    const state = createState(testConfig());

    const events = applyInput(state, registerAccountInput("acc-1", "10000"));

    expect(events).toEqual([
      {
        t: "balanceUpdate",
        accountId: "acc-1",
        walletBalance: parse("10000"),
        delta: parse("10000"),
        reason: "INITIAL",
        symbol: null,
        ref: null,
        ts: T0,
      },
    ]);
    expect(state.accounts.get("acc-1")).toEqual({
      id: "acc-1",
      walletBalance: parse("10000"),
      positionMode: "ONE_WAY",
    });
  });

  it("重复注册是宿主的 bug，直接抛错", () => {
    const state = createState(testConfig());
    applyInput(state, registerAccountInput("acc-1"));
    expect(() => applyInput(state, registerAccountInput("acc-1"))).toThrow(/已经在引擎里了/);
  });

  it("初始余额为负时抛错", () => {
    const state = createState(testConfig());
    expect(() => applyInput(state, registerAccountInput("acc-1", "-1"))).toThrow(/不能为负/);
  });
});

describe("行情输入", () => {
  it("book 覆盖该币对的盘口快照", () => {
    const state = createState(testConfig());
    const bids = [{ price: parse("49999.9"), qty: parse("1.5") }];
    const asks = [{ price: parse("50000"), qty: parse("2") }];

    const events = applyInput(state, { t: "book", symbol: "BTCUSDT", bids, asks, ts: T0 });

    expect(events).toEqual([]);
    expect(state.books.get("BTCUSDT")).toEqual({ bids, asks, ts: T0 });
  });

  it("book 存的是拷贝：宿主之后改自己的数组，影响不到引擎", () => {
    const state = createState(testConfig());
    const bids = [{ price: parse("49999.9"), qty: parse("1.5") }];
    applyInput(state, { t: "book", symbol: "BTCUSDT", bids, asks: [], ts: T0 });

    bids[0]!.qty = 0n;

    expect(state.books.get("BTCUSDT")!.bids[0]!.qty).toBe(parse("1.5"));
  });

  it("markPrice 更新标记价、资金费率和下次结算时间", () => {
    const state = createState(testConfig());
    applyInput(state, {
      t: "markPrice",
      symbol: "BTCUSDT",
      markPrice: parse("50010"),
      fundingRate: parse("0.0001"),
      nextFundingTs: T0 + 3_600_000,
      ts: T0,
    });

    expect(state.marks.get("BTCUSDT")).toEqual({
      markPrice: parse("50010"),
      fundingRate: parse("0.0001"),
      nextFundingTs: T0 + 3_600_000,
      ts: T0,
    });
  });

  it("trade 更新最新价", () => {
    const state = createState(testConfig());
    applyInput(state, {
      t: "trade",
      symbol: "BTCUSDT",
      price: parse("50001.2"),
      qty: parse("0.3"),
      buyerIsMaker: false,
      ts: T0,
    });
    expect(state.lastPrices.get("BTCUSDT")).toBe(parse("50001.2"));
  });

  it("未知币对是宿主接线错误，直接抛错", () => {
    const state = createState(testConfig());
    expect(() =>
      applyInput(state, { t: "book", symbol: "DOGEUSDT", bids: [], asks: [], ts: T0 }),
    ).toThrow(/未知币对 DOGEUSDT/);
  });
});

describe("尚未实现的输入", () => {
  it("明确抛错，而不是悄悄返回空数组", () => {
    const state = createState(testConfig());
    expect(() =>
      applyInput(state, { t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 }),
    ).toThrow(/还没有实现输入 "cancelOrder"/);
  });
});
