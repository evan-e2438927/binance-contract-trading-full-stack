import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createEngine } from "./create-engine";
import { T0, registerAccountInput, testConfig } from "./testing/fixtures";

describe("createEngine：apply 之后必须 commit 或 rollback", () => {
  it("commit：本次改动生效", () => {
    const engine = createEngine(testConfig());

    engine.apply(registerAccountInput("acc-1", "10000"));
    engine.commit();

    expect(engine.snapshot().accounts).toEqual([
      { id: "acc-1", walletBalance: parse("10000"), positionMode: "ONE_WAY" },
    ]);
  });

  it("rollback：回到 apply 之前，就像这次开户从没发生过", () => {
    const engine = createEngine(testConfig());

    engine.apply(registerAccountInput("acc-1", "10000"));
    engine.rollback();

    expect(engine.snapshot().accounts).toEqual([]);
    // 真的回去了：同一个账户可以再注册一次，而不是报"重复注册"
    expect(() => engine.apply(registerAccountInput("acc-1", "10000"))).not.toThrow();
  });

  it("上一次 apply 没结算就喂下一个输入，是宿主的 bug，直接抛错", () => {
    const engine = createEngine(testConfig());
    engine.apply(registerAccountInput("acc-1"));

    expect(() => engine.apply(registerAccountInput("acc-2"))).toThrow(/还没有 commit\(\) 或 rollback\(\)/);
  });

  it("没有待结算的 apply 时，commit / rollback 都抛错", () => {
    const engine = createEngine(testConfig());

    expect(() => engine.commit()).toThrow(/commit\(\) 调用多余/);
    expect(() => engine.rollback()).toThrow(/rollback\(\) 调用多余/);
  });

  it("apply 抛出程序错误时已经自动回滚，不会卡在未结算状态", () => {
    const engine = createEngine(testConfig());

    expect(() => engine.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, ts: T0 })).toThrow(
      /还没有实现输入/,
    );

    expect(() => engine.rollback()).toThrow(/调用多余/);
    expect(() => engine.apply(registerAccountInput("acc-1"))).not.toThrow();
  });

  it("有未结算的 apply 时不能 restore", () => {
    const engine = createEngine(testConfig());
    engine.apply(registerAccountInput("acc-1"));

    expect(() => engine.restore({ accounts: [], settings: [], positions: [], orders: [] })).toThrow(
      /未结算的 apply/,
    );
  });
});
