import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { applyInput } from "../../../../packages/engine/src/apply";
import { beginJournal, putAccount, putOrder, removeOrder, rollbackJournal } from "../../../../packages/engine/src/journal";
import { createState, loadSnapshot } from "../../../../packages/engine/src/state";
import { T0, testConfig, testOrder } from "../../../../packages/engine/src/testing/fixtures";
import type { Account } from "../../../../packages/engine/src/types";

function stateWithAccount(balance: string) {
  const state = createState(testConfig());
  loadSnapshot(state, {
    accounts: [{ id: "acc-1", walletBalance: parse(balance), positionMode: "ONE_WAY" }],
    settings: [],
    positions: [],
    orders: [testOrder({ id: "o-1" })],
  });
  return state;
}

describe("undo 日志", () => {
  it("同一个键在一次 apply 里改了多次，回滚回到 apply 之前，而不是上一步", () => {
    const state = stateWithAccount("10000");
    beginJournal(state);

    putAccount(state, { id: "acc-1", walletBalance: parse("9000"), positionMode: "ONE_WAY" });
    putAccount(state, { id: "acc-1", walletBalance: parse("8000"), positionMode: "ONE_WAY" });
    rollbackJournal(state);

    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });

  it("本次新增的键回滚后消失，本次删除的键回滚后回来", () => {
    const state = stateWithAccount("10000");
    beginJournal(state);

    removeOrder(state, "o-1");
    putOrder(state, testOrder({ id: "o-2" }));
    rollbackJournal(state);

    expect([...state.orders.keys()]).toEqual(["o-1"]);
  });

  it("回滚不动行情类状态：币安的价格不会因为我们写库失败就倒退", () => {
    const state = stateWithAccount("10000");
    beginJournal(state);

    applyInput(state, { t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50001.2"), qty: parse("0.3"), buyerIsMaker: false, ts: T0 });
    rollbackJournal(state);

    expect(state.lastPrices.get("BTCUSDT")).toBe(parse("50001.2"));
  });

  it("进了引擎的账户类对象被冻结：绕过类型原地改，运行时直接抛错", () => {
    const state = stateWithAccount("10000");
    // 日志只存旧对象的引用。如果允许原地改，旧值会被一起改掉，回滚就回不去了
    const account = state.accounts.get("acc-1") as Account;
    expect(() => {
      account.walletBalance = 0n;
    }).toThrow(TypeError);
  });
});
