import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import {
  availableBalance,
  fee,
  frozenMargin,
  fundingFee,
  initialMargin,
  marginBalance,
  notional,
  unrealizedPnl,
} from "./formulas";
import { testConfig } from "./testing/fixtures";

describe("4.1 基础", () => {
  it("notional = qty × price", () => {
    expect(notional(parse("1"), parse("50000"))).toBe(parse("50000"));
  });

  it("initialMargin = notional ÷ leverageNum", () => {
    expect(initialMargin(parse("1"), parse("50000"), 10)).toBe(parse("5000"));
  });

  it("initialMargin 除不尽时四舍五入", () => {
    // 100 ÷ 3 = 33.333…，四舍五入到 8 位是 33.33333333
    expect(initialMargin(parse("100"), parse("1"), 3)).toBe(parse("33.33333333"));
  });

  it("initialMargin 杠杆不是正整数直接抛错——程序错误，不是业务拒绝", () => {
    expect(() => initialMargin(parse("1"), parse("50000"), 0)).toThrow();
  });

  it("unrealizedPnl 多头：现价高于开仓价是正", () => {
    const p = { positionSide: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
    expect(unrealizedPnl(p, parse("51000"))).toBe(parse("1000"));
  });

  it("unrealizedPnl 空头：现价低于开仓价是正", () => {
    const p = { positionSide: "SHORT" as const, qty: parse("1"), entryPrice: parse("50000") };
    expect(unrealizedPnl(p, parse("49000"))).toBe(parse("1000"));
  });

  it("marginBalance = 钱包余额 + 未实现盈亏之和", () => {
    expect(marginBalance(parse("10000"), parse("1000"))).toBe(parse("11000"));
    expect(marginBalance(parse("10000"), parse("-500"))).toBe(parse("9500"));
  });
});

describe("4.2 可用余额", () => {
  it("01-domain-knowledge.md 第十二节算例：逐仓开仓后可用余额只扣手续费，不扣逐仓保证金本身", () => {
    // 这条测试同时锁定了设计缺口 #6 的结论：开仓时逐仓保证金不产生 walletBalance 的变动，
    // 只是把这笔钱从"可用"标成"锁定"——isolatedMarginSum 直接体现在 availableBalance 的减项里，
    // 不需要在 walletBalance 上再扣一次。见 docs/tutorial/03-formulas.md。
    const walletBalance = parse("9975"); // 10000 − 25 Taker 手续费
    const available = availableBalance({
      walletBalance,
      crossUnrealizedPnlSum: 0n,
      crossInitialMarginSum: 0n,
      isolatedMarginSum: parse("5000"),
      frozenMarginSum: 0n,
    });
    expect(available).toBe(parse("4975"));
  });

  it("全仓浮盈能拿来开新仓：crossUnrealizedPnlSum 是加项", () => {
    const available = availableBalance({
      walletBalance: parse("10000"),
      crossUnrealizedPnlSum: parse("1000"),
      crossInitialMarginSum: parse("5000"),
      isolatedMarginSum: 0n,
      frozenMarginSum: 0n,
    });
    expect(available).toBe(parse("6000"));
  });

  it("挂单冻结保证金也是减项", () => {
    const available = availableBalance({
      walletBalance: parse("10000"),
      crossUnrealizedPnlSum: 0n,
      crossInitialMarginSum: 0n,
      isolatedMarginSum: 0n,
      frozenMarginSum: parse("2000"),
    });
    expect(available).toBe(parse("8000"));
  });
});

describe("4.3 挂单冻结保证金", () => {
  const takerFeeRate = testConfig().fees.takerFeeRate; // 0.05%

  it("普通限价单：起始保证金 + 按 Taker 费率预留的手续费", () => {
    const frozen = frozenMargin(
      { reduceOnly: false, closePosition: false, qty: parse("1"), price: parse("50000"), leverageNum: 10 },
      takerFeeRate,
    );
    // 5000（起始保证金） + 25（50000 × 0.05%，向上取整）
    expect(frozen).toBe(parse("5025"));
  });

  it("只减仓单不冻结保证金", () => {
    const frozen = frozenMargin(
      { reduceOnly: true, closePosition: false, qty: parse("1"), price: parse("50000"), leverageNum: 10 },
      takerFeeRate,
    );
    expect(frozen).toBe(0n);
  });

  it("全部平仓单不冻结保证金", () => {
    const frozen = frozenMargin(
      { reduceOnly: false, closePosition: true, qty: parse("1"), price: parse("50000"), leverageNum: 10 },
      takerFeeRate,
    );
    expect(frozen).toBe(0n);
  });
});

describe("4.7 资金费", () => {
  it("01-domain-knowledge.md 第八节算例：1 BTC 多单，标记价 50,000，费率 +0.01% → 付出 5 USDT", () => {
    const p = { positionSide: "LONG" as const, qty: parse("1") };
    expect(fundingFee(p, parse("0.0001"), parse("50000"))).toBe(parse("-5"));
  });

  it("费率为正时空头收到（正流水）", () => {
    const p = { positionSide: "SHORT" as const, qty: parse("1") };
    expect(fundingFee(p, parse("0.0001"), parse("50000"))).toBe(parse("5"));
  });
});

describe("4.8 手续费", () => {
  const feeConfig = testConfig().fees;

  it("01-domain-knowledge.md 第九节算例：市价开仓 1 BTC @ 50,000，Taker 费 25 USDT", () => {
    expect(fee(parse("1"), parse("50000"), "TAKER", feeConfig)).toBe(parse("25"));
  });

  it("01-domain-knowledge.md 第十二节步骤 4：限价平多 52,000，Maker 费 10.4 USDT", () => {
    expect(fee(parse("1"), parse("52000"), "MAKER", feeConfig)).toBe(parse("10.4"));
  });

  it("有余数时向上取整，不低估摩擦成本", () => {
    // 0.00000003 × 0.0005 远小于最小单位，也要收够 1 个最小单位
    expect(fee(parse("0.00000003"), parse("1"), "TAKER", feeConfig)).toBe(1n);
  });
});
