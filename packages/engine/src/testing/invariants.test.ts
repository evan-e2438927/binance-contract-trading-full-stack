import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import type { Account, EngineSnapshot, Order, Position } from "../types";
import { InvariantError, checkInvariants } from "./invariants";
import { BTCUSDT_BRACKETS, T0, testOrder } from "./fixtures";

/**
 * 第 02 讲留空的不变式 ③（可用余额非负）⑥（只减仓/全部平仓单不冻结保证金），
 * 现在有了公式（第 03 讲）可以补上。目前还没有任何 apply() 路径会真的创建仓位/挂单，
 * 这里直接构造快照来单独测这两条——不用等第 04/05 讲把下单校验链和撮合接好。
 */

function account(overrides: Partial<Account> = {}): Account {
  return { id: "acc-1", walletBalance: parse("10000"), positionMode: "ONE_WAY", ...overrides };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    accountId: "acc-1",
    symbol: "BTCUSDT",
    positionSide: "BOTH",
    marginMode: "ISOLATED",
    leverageNum: 10,
    qty: parse("1"),
    entryPrice: parse("50000"),
    isolatedMargin: parse("5000"),
    openedAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return { accounts: [], settings: [], positions: [], orders: [], ...overrides };
}

const noEvents: never[] = [];

/**
 * ③⑥ 和 ① 是不同的不变式：这里只想单独测 ③⑥，所以给账户配一份"流水之和 == walletBalance"
 * 的假流水，让 ① 稳定放行，不要在测别的不变式时被 ① 先抢答报错。
 */
function ledgerSumsFor(accountId: string, walletBalance: bigint): Map<string, bigint> {
  return new Map([[accountId, walletBalance]]);
}

describe("③ 可用余额非负", () => {
  it("逐仓仓位不需要标记价，只算钱包余额减逐仓保证金", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("9975") })],
      positions: [position({ isolatedMargin: parse("5000") })],
    });
    // 9975 − 5000 = 4975 ≥ 0，正常通过
    const ledgerSums = ledgerSumsFor("acc-1", parse("9975"));
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).not.toThrow();
  });

  it("逐仓保证金超过钱包余额——理论上不该发生，但不变式要能抓到", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("100") })],
      positions: [position({ isolatedMargin: parse("5000") })],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("100"));
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).toThrow(InvariantError);
  });

  it("全仓仓位标记价未知时跳过该账户，不误判", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("100") })],
      positions: [position({ marginMode: "CROSS", isolatedMargin: 0n })],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("100"));
    // 没有喂过这个币对的 markPrice，算不出未实现盈亏，应该跳过而不是抛错
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).not.toThrow();
  });

  it("全仓仓位浮亏太大，可用余额为负时抓到", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("10000") })],
      positions: [
        position({ marginMode: "CROSS", isolatedMargin: 0n, qty: parse("1"), entryPrice: parse("50000") }),
      ],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("10000"));
    const marks = new Map([["BTCUSDT", parse("40000")]]); // 浮亏 10000，起始保证金还要另外扣 5000
    expect(() => checkInvariants(s, noEvents, ledgerSums, marks)).toThrow(InvariantError);
  });

  it("挂单冻结保证金也算进减项", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("100") })],
      orders: [testOrder({ frozenMargin: parse("5025") })],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("100"));
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).toThrow(InvariantError);
  });
});

describe("⑥ 只减仓 / 全部平仓单不冻结保证金", () => {
  const ledgerSums = ledgerSumsFor("acc-1", parse("10000"));

  it("reduceOnly 单 frozenMargin 非零时抓到", () => {
    const s = snapshot({
      accounts: [account()],
      orders: [testOrder({ reduceOnly: true, frozenMargin: parse("1") })],
    });
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).toThrow(InvariantError);
  });

  it("closePosition 单 frozenMargin 非零时抓到", () => {
    const s = snapshot({
      accounts: [account()],
      orders: [testOrder({ closePosition: true, frozenMargin: parse("1") })],
    });
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).toThrow(InvariantError);
  });

  it("普通单冻结保证金不受影响", () => {
    const s = snapshot({
      accounts: [account()],
      orders: [testOrder({ frozenMargin: parse("5025") }) satisfies Order],
    });
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map())).not.toThrow();
  });
});

describe("③ 的检查范围（缺口 #19）", () => {
  it("availableScope 里没有的账户不检查：标记价不利变动让可用余额变负是正常的", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("100") })],
      orders: [testOrder({ frozenMargin: parse("5025") })],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("100"));
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map(), { availableScope: new Set() })).not.toThrow();
    expect(() =>
      checkInvariants(s, noEvents, ledgerSums, new Map(), { availableScope: new Set(["acc-1"]) }),
    ).toThrow(/不变式 ③/);
  });
});

describe("⑨ 不能留下该强平没强平的仓位", () => {
  const brackets = { BTCUSDT: BTCUSDT_BRACKETS };

  it("逐仓仓位权益 ≤ 维持保证金时抓到", () => {
    const s = snapshot({ accounts: [account({ walletBalance: parse("9975") })], positions: [position()] });
    const ledgerSums = ledgerSumsFor("acc-1", parse("9975"));
    const options = { availableScope: new Set<string>(), brackets };
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map([["BTCUSDT", parse("45180.73")]]), options)).not.toThrow();
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map([["BTCUSDT", parse("45180.72")]]), options)).toThrow(
      /不变式 ⑨/,
    );
  });

  it("全仓整户权益 ≤ 维持保证金之和时抓到；缺标记价时跳过", () => {
    const s = snapshot({
      accounts: [account({ walletBalance: parse("9975") })],
      positions: [position({ marginMode: "CROSS", isolatedMargin: 0n })],
    });
    const ledgerSums = ledgerSumsFor("acc-1", parse("9975"));
    const options = { availableScope: new Set<string>(), brackets };
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map([["BTCUSDT", parse("40185.74")]]), options)).toThrow(
      /不变式 ⑨/,
    );
    expect(() => checkInvariants(s, noEvents, ledgerSums, new Map(), options)).not.toThrow();
  });
});
