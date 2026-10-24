import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createState, loadSnapshot, toSnapshot } from "../../../../packages/engine/src/state";
import { BTCUSDT_BRACKETS, testConfig } from "../../../../packages/engine/src/testing/fixtures";
import type { EngineSnapshot } from "../../../../packages/engine/src/types";

function snapshotWithOneAccount(balance: string): EngineSnapshot {
  return {
    accounts: [{ id: "acc-1", walletBalance: parse(balance), positionMode: "ONE_WAY" }],
    settings: [],
    positions: [],
    orders: [],
  };
}

describe("createState", () => {
  it("某个币对没有分层表时，启动就报错", () => {
    const config = testConfig();
    config.brackets = {};
    expect(() => createState(config)).toThrow(/没有杠杆分层表/);
  });

  it("分层表按 notionalCap 升序整理，不依赖宿主传进来的顺序", () => {
    const config = testConfig();
    config.brackets = { BTCUSDT: [...BTCUSDT_BRACKETS].reverse() };
    const state = createState(config);
    const caps = state.brackets.get("BTCUSDT")!.map((b) => b.notionalCap);
    expect(caps).toEqual([...caps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe("快照", () => {
  it("toSnapshot 是深拷贝：改返回值影响不到引擎", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));

    const snap = toSnapshot(state);
    snap.accounts[0]!.walletBalance = 0n;

    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });

  it("loadSnapshot 也是深拷贝：之后改传进去的对象，影响不到引擎", () => {
    const state = createState(testConfig());
    const snap = snapshotWithOneAccount("10000");
    loadSnapshot(state, snap);

    snap.accounts[0]!.walletBalance = 0n;

    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });

  it("loadSnapshot 整体替换账户类状态，但保留行情状态", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));
    state.lastPrices.set("BTCUSDT", parse("50000"));

    loadSnapshot(state, {
      accounts: [{ id: "acc-2", walletBalance: parse("500"), positionMode: "HEDGE" }],
      settings: [],
      positions: [],
      orders: [],
    });

    expect([...state.accounts.keys()]).toEqual(["acc-2"]);
    expect(state.lastPrices.get("BTCUSDT")).toBe(parse("50000"));
  });

  it("快照里出现未知币对时拒绝加载，并且不留下半新半旧的状态", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));

    const bad: EngineSnapshot = {
      ...snapshotWithOneAccount("1"),
      settings: [{ accountId: "acc-1", symbol: "DOGEUSDT", leverageNum: 20, marginMode: "CROSS" }],
    };

    expect(() => loadSnapshot(state, bad)).toThrow(/未知币对 DOGEUSDT/);
    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });
});
