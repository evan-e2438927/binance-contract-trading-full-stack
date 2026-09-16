import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { marginBalance, notional, unrealizedPnl } from "./formulas";
import { findBracket, liquidationPrice, maintMargin, marginRatio } from "./liquidation";
import { BTCUSDT_BRACKETS } from "./testing/fixtures";

describe("4.5 杠杆分层与维持保证金", () => {
  it.each([
    ["40000", 1, "160"],
    ["50000", 1, "200"], // 边界：按第 1 层算
    ["200000", 2, "950"],
    ["1000000", 3, "6950"],
  ] as const)("名义价值 %s → 第 %s 层，维持保证金 %s", (notionalValue, bracketNum, expected) => {
    const bracket = findBracket(BTCUSDT_BRACKETS, parse(notionalValue));
    expect(bracket.bracketNum).toBe(bracketNum);
    expect(maintMargin(parse(notionalValue), bracket)).toBe(parse(expected));
  });

  it("名义价值恰好等于两层边界时，两层算出的维持保证金必须相等（分层表连续性）", () => {
    const boundary = parse("50000");
    const lower = maintMargin(boundary, BTCUSDT_BRACKETS[0]!);
    const upper = maintMargin(boundary, BTCUSDT_BRACKETS[1]!);
    expect(lower).toBe(upper);
  });

  it("超出最后一层上限时兜底用最后一层，不抛错", () => {
    const huge = parse("900000000"); // 超过第 10 层上限 800,000,000
    const bracket = findBracket(BTCUSDT_BRACKETS, huge);
    expect(bracket.bracketNum).toBe(10);
  });

  it("空分层表直接抛错——这是接线错误，不是业务场景", () => {
    expect(() => findBracket([], parse("1"))).toThrow();
  });
});

describe("4.6 保证金率", () => {
  it("维持保证金 ÷ 保证金余额", () => {
    expect(marginRatio(parse("200"), parse("1000"))).toBe(parse("0.2"));
  });

  it("保证金余额 ≤ 0（已穿仓）时直接判定 ≥100%，不真的去除", () => {
    expect(marginRatio(parse("200"), 0n)).toBe(parse("1"));
    expect(marginRatio(parse("200"), parse("-50"))).toBe(parse("1"));
  });
});

describe("4.6 强平价——三个算例都要连反向验算一起过", () => {
  const bracket1 = BTCUSDT_BRACKETS[0]!; // mmr 0.4%, cum 0

  it("算例 A · 逐仓多头：45,180.72", () => {
    const liq = liquidationPrice({
      positionSide: "LONG",
      marginMode: "ISOLATED",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: parse("5000"),
      walletBalance: 0n, // 逐仓不看这个字段
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    expect(format(liq, 2)).toBe("45180.72");

    // ★ 反向验算：强平价上，保证金余额必须等于维持保证金——这是独立于公式本身的第二条路径。
    // 两边都要走生产代码里真正用的函数（unrealizedPnl/maintMargin），不能手写 mul() 重算一遍——
    // liq 本身已经四舍五入过一次，手写的截断算法和公式内部的四舍五入对不上，会差 1e-8。
    const pos = { positionSide: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
    const marginBalanceAtLiq = marginBalance(parse("5000"), unrealizedPnl(pos, liq));
    const maintMarginAtLiq = maintMargin(notional(pos.qty, liq), bracket1);
    expect(marginBalanceAtLiq).toBe(maintMarginAtLiq);
  });

  it("算例 B · 逐仓空头：54,780.88", () => {
    const liq = liquidationPrice({
      positionSide: "SHORT",
      marginMode: "ISOLATED",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: parse("5000"),
      walletBalance: 0n,
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    expect(format(liq, 2)).toBe("54780.88");

    const pos = { positionSide: "SHORT" as const, qty: parse("1"), entryPrice: parse("50000") };
    const marginBalanceAtLiq = marginBalance(parse("5000"), unrealizedPnl(pos, liq));
    const maintMarginAtLiq = maintMargin(notional(pos.qty, liq), bracket1);
    expect(marginBalanceAtLiq).toBe(maintMarginAtLiq);
  });

  it("算例 C · 全仓多头（只有这一个仓位）：40,160.64", () => {
    const liq = liquidationPrice({
      positionSide: "LONG",
      marginMode: "CROSS",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: 0n,
      walletBalance: parse("10000"),
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    expect(format(liq, 2)).toBe("40160.64");

    const pos = { positionSide: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
    const marginBalanceAtLiq = marginBalance(parse("10000"), unrealizedPnl(pos, liq));
    const maintMarginAtLiq = maintMargin(notional(pos.qty, liq), bracket1);
    expect(marginBalanceAtLiq).toBe(maintMarginAtLiq);
  });

  it("对比 A 和 C：同样的仓位，全仓强平价比逐仓低——全仓拿整个账户兜底", () => {
    const isolated = liquidationPrice({
      positionSide: "LONG",
      marginMode: "ISOLATED",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: parse("5000"),
      walletBalance: 0n,
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    const cross = liquidationPrice({
      positionSide: "LONG",
      marginMode: "CROSS",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: 0n,
      walletBalance: parse("10000"),
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    expect(cross < isolated).toBe(true);
  });

  it("全仓下别的仓位的维持保证金/浮亏会推高本仓位的强平价", () => {
    const withoutOthers = liquidationPrice({
      positionSide: "LONG",
      marginMode: "CROSS",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: 0n,
      walletBalance: parse("10000"),
      otherCrossMaintMarginSum: 0n,
      otherCrossUnrealizedPnlSum: 0n,
      bracket: bracket1,
    });
    const withOthersLosing = liquidationPrice({
      positionSide: "LONG",
      marginMode: "CROSS",
      qty: parse("1"),
      entryPrice: parse("50000"),
      isolatedMargin: 0n,
      walletBalance: parse("10000"),
      otherCrossMaintMarginSum: parse("100"),
      otherCrossUnrealizedPnlSum: parse("-500"), // 别的仓位在浮亏
      bracket: bracket1,
    });
    // 别的仓位占用维持保证金、又在浮亏，会更早触发这个仓位的强平——强平价应该更高（更容易碰到）
    expect(withOthersLosing > withoutOthers).toBe(true);
  });

  it("分母为 0（mmr 和方向凑巧抵消）时抛错，不返回一个没有意义的数字", () => {
    // 100% mmr、杠杆 1x 的极端层，做多时分母 = qty×1 − qty = 0
    const weirdBracket = { mmr: parse("1"), cum: 0n };
    expect(() =>
      liquidationPrice({
        positionSide: "LONG",
        marginMode: "ISOLATED",
        qty: parse("1"),
        entryPrice: parse("50000"),
        isolatedMargin: parse("50000"),
        walletBalance: 0n,
        otherCrossMaintMarginSum: 0n,
        otherCrossUnrealizedPnlSum: 0n,
        bracket: weirdBracket,
      }),
    ).toThrow();
  });
});
