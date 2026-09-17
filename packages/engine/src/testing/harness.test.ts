import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import type { Order } from "../types";
import { T0, registerAccountInput, testConfig } from "./fixtures";
import { createTestEngine } from "./harness";
import { InvariantError, checkRollback } from "./invariants";

function filledOrder(): Order {
  return {
    id: "o-1",
    clientOrderId: "c-1",
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    timeInForce: "GTC",
    price: parse("50000"),
    stopPrice: null,
    workingType: "CONTRACT_PRICE",
    qty: parse("1"),
    executedQty: parse("1"),
    avgPrice: parse("50000"),
    reduceOnly: false,
    closePosition: false,
    status: "FILLED",
    triggered: false,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n,
    rejectReason: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

describe("测试脚手架", () => {
  it("正常流程下不变式全部通过，并累加流水", () => {
    const te = createTestEngine(testConfig());

    te.apply(registerAccountInput("acc-1", "10000"));
    te.apply(registerAccountInput("acc-2", "500"));

    expect(te.ledgerSum("acc-1")).toBe(parse("10000"));
    expect(te.ledgerSum("acc-2")).toBe(parse("500"));
    expect(te.events).toHaveLength(2);
  });

  // ↓ 下面两条在"测试测试器"：故意制造坏状态，确认不变式真的会响。
  //   不变式检查如果永远不报错，它就只是一段让人安心的摆设。

  it("余额被改了但没有对应流水 → 下一次 apply 抛出不变式 ①", () => {
    const te = createTestEngine(testConfig());
    te.apply(registerAccountInput("acc-1", "10000"));

    // 绕过脚手架，直接把余额改成 20000，模拟"改了余额没写流水"的 bug
    const snap = te.engine.snapshot();
    snap.accounts[0]!.walletBalance = parse("20000");
    te.engine.restore(snap);

    const next = { t: "trade", symbol: "BTCUSDT", price: parse("50000"), qty: parse("1"), buyerIsMaker: true, ts: T0 } as const;
    expect(() => te.apply(next)).toThrow(InvariantError);
    expect(() => te.apply(next)).toThrow(/不变式 ①/);
  });

  it("终态订单留在内存里 → 抛出不变式 ⑧", () => {
    const te = createTestEngine(testConfig());
    te.apply(registerAccountInput("acc-1", "10000"));

    const snap = te.engine.snapshot();
    snap.orders.push(filledOrder());
    te.engine.restore(snap);

    expect(() =>
      te.apply({ t: "trade", symbol: "BTCUSDT", price: parse("50000"), qty: parse("1"), buyerIsMaker: true, ts: T0 }),
    ).toThrow(/不变式 ⑧/);
  });

  it("回滚自检：内容一样、只是顺序不同，不算回滚不完整", () => {
    const a = { id: "acc-1", walletBalance: parse("1"), positionMode: "ONE_WAY" } as const;
    const b = { id: "acc-2", walletBalance: parse("2"), positionMode: "ONE_WAY" } as const;
    const empty = { settings: [], positions: [], orders: [] };

    expect(() => checkRollback({ accounts: [a, b], ...empty }, { accounts: [b, a], ...empty })).not.toThrow();
  });

  it("回滚自检：有一处改动没被撤回 → 抛出回滚不完整", () => {
    const empty = { settings: [], positions: [], orders: [] };
    const before = { accounts: [{ id: "acc-1", walletBalance: parse("10000"), positionMode: "ONE_WAY" as const }], ...empty };
    const leaked = { accounts: [{ id: "acc-1", walletBalance: parse("9999"), positionMode: "ONE_WAY" as const }], ...empty };

    expect(() => checkRollback(before, leaked)).toThrow(InvariantError);
    expect(() => checkRollback(before, leaked)).toThrow(/回滚不完整：accounts/);
  });
});
