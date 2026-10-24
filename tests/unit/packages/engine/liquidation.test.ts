import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { marginBalance, notional, unrealizedPnl } from "../../../../packages/engine/src/formulas";
import { findBracket, liquidationPrice, liquidationPriceDetailed, maintMargin, marginRatio } from "../../../../packages/engine/src/liquidation";
import { BTCUSDT_BRACKETS } from "../../../../packages/engine/src/testing/fixtures";

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

describe("4.6 强平价——算例连反向验算一起过，另加币安 FAQ 的真实算例", () => {
  const long1 = { side: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
  const short1 = { side: "SHORT" as const, qty: parse("1"), entryPrice: parse("50000") };
  const isolated = (margin: string, leg: typeof long1 | typeof short1) =>
    liquidationPrice({ walletBalance: parse(margin), otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, legs: [leg], brackets: BTCUSDT_BRACKETS });

  /** ★ 反向验算：强平价上，权益必须等于维持保证金——独立于公式本身的第二条路径，用生产代码里真正用的函数 */
  function equityMinusMaint(wallet: string, legs: readonly (typeof long1 | typeof short1)[], price: bigint): bigint {
    let equity = parse(wallet);
    let maint = 0n;
    for (const leg of legs) {
      equity += unrealizedPnl({ positionSide: leg.side, qty: leg.qty, entryPrice: leg.entryPrice }, price);
      const value = notional(leg.qty, price);
      maint += maintMargin(value, findBracket(BTCUSDT_BRACKETS, value));
    }
    return marginBalance(equity, 0n) - maint;
  }

  it("算例 A · 逐仓多头：45,180.72", () => {
    const liq = isolated("5000", long1)!;
    expect(format(liq, 2)).toBe("45180.72");
    expect(equityMinusMaint("5000", [long1], liq)).toBe(0n);
  });

  it("算例 B · 逐仓空头：54,776.12（缺口 #24：强平价处名义价值已进第 2 层，换档重算；旧文档按第 1 层写的 54,780.88）", () => {
    const liq = isolated("5000", short1)!;
    expect(format(liq, 2)).toBe("54776.12");
    expect(findBracket(BTCUSDT_BRACKETS, notional(short1.qty, liq)).bracketNum).toBe(2);
    expect(equityMinusMaint("5000", [short1], liq)).toBe(0n);
  });

  it("算例 C · 全仓多头（只有这一个仓位）：40,160.64", () => {
    const liq = liquidationPrice({ walletBalance: parse("10000"), otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, legs: [long1], brackets: BTCUSDT_BRACKETS })!;
    expect(format(liq, 2)).toBe("40160.64");
    expect(equityMinusMaint("10000", [long1], liq)).toBe(0n);
  });

  // 币安 FAQ「How to Calculate Liquidation Price of USDⓈ-M Futures Contracts」的单向全仓算例（2026-09-17 抄录）：
  // 钱包 1,535,443.01，两个多头仓位；FAQ 只给了各自所在档的 MMR / cum，所以分层表只传那一档
  const faqTier = (mmr: string, cum: string) => [{ bracketNum: 1, notionalFloor: 0n, notionalCap: parse("100000000"), maxLeverageNum: 125, mmr: parse(mmr), cum: parse(cum) }];

  it("★ 币安 FAQ 算例 · ETHUSDT：1,153.26（第 13 讲前的旧写法算出 1,234.91——全仓 cum 符号反了，缺口 #39）", () => {
    const liq = liquidationPrice({
      walletBalance: parse("1535443.01"),
      otherMaintMarginSum: parse("71200.81144"),
      otherUnrealizedPnlSum: parse("-56354.57"),
      legs: [{ side: "LONG", qty: parse("3683.979"), entryPrice: parse("1456.84") }],
      brackets: faqTier("0.10", "135365"),
    })!;
    expect(format(liq, 2)).toBe("1153.26");
  });

  it("★ 币安 FAQ 算例 · BTCUSDT：26,316.89", () => {
    const liq = liquidationPrice({
      walletBalance: parse("1535443.01"),
      otherMaintMarginSum: parse("356512.508"),
      otherUnrealizedPnlSum: parse("-448192.89"),
      legs: [{ side: "LONG", qty: parse("109.488"), entryPrice: parse("32481.98") }],
      brackets: faqTier("0.025", "16300"),
    })!;
    expect(format(liq, 2)).toBe("26316.89");
  });

  it("全仓 cum 不为 0 的档位也要反算对得上（第 03 讲的算例都在 cum = 0 的第 1 层，漏掉了这种情况）", () => {
    const big = { side: "LONG" as const, qty: parse("10"), entryPrice: parse("50000") }; // 名义价值 500,000，第 3 层 cum 1,050
    const liq = liquidationPrice({ walletBalance: parse("60000"), otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, legs: [big], brackets: BTCUSDT_BRACKETS })!;
    expect(findBracket(BTCUSDT_BRACKETS, notional(big.qty, liq)).cum > 0n).toBe(true);
    expect(equityMinusMaint("60000", [big], liq)).toBe(0n);
  });

  it("双向持仓全仓：多、空两条腿一起算，得到同一个强平价，反算对得上", () => {
    const hedgeShort = { side: "SHORT" as const, qty: parse("0.4"), entryPrice: parse("52000") };
    const liq = liquidationPrice({ walletBalance: parse("5000"), otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, legs: [long1, hedgeShort], brackets: BTCUSDT_BRACKETS })!;
    expect(liq < parse("50000")).toBe(true); // 净多 0.6，价格往下走才会强平
    const diff = equityMinusMaint("5000", [long1, hedgeShort], liq);
    expect(diff >= -2n && diff <= 2n).toBe(true); // 两条腿各自四舍五入，允许 1e-8 量级的舍入差
  });

  it("全仓下别的仓位的维持保证金 / 浮亏会推高本仓位的强平价", () => {
    const base = { walletBalance: parse("10000"), legs: [long1], brackets: BTCUSDT_BRACKETS };
    const alone = liquidationPrice({ ...base, otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n })!;
    const withOthersLosing = liquidationPrice({ ...base, otherMaintMarginSum: parse("100"), otherUnrealizedPnlSum: parse("-500") })!;
    expect(withOthersLosing > alone).toBe(true);
  });

  it("多空完全对冲也有强平价，在上方：浮盈浮亏抵消，但维持保证金随价格上涨，涨得够高权益就不够了", () => {
    const base = { otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, brackets: BTCUSDT_BRACKETS };
    const liq = liquidationPrice({ ...base, walletBalance: parse("1000"), legs: [long1, short1] })!;
    expect(liq > parse("50000")).toBe(true);
    const diff = equityMinusMaint("1000", [long1, short1], liq);
    expect(diff >= -2n && diff <= 2n).toBe(true);
  });

  it("没有强平价时返回 null，不编数字：钱包足够扛到价格归零 / 没有仓位", () => {
    const base = { otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, brackets: BTCUSDT_BRACKETS };
    // 钱包比名义价值还多的多头：价格跌到 0 也爆不了，公式算出负数
    expect(liquidationPrice({ ...base, walletBalance: parse("60000"), legs: [long1] })).toBeNull();
    expect(liquidationPrice({ ...base, walletBalance: parse("1000"), legs: [] })).toBeNull();
  });
});

describe("liquidationPriceDetailed（第 25 讲）：liquidationPrice() 是它的薄包装，区分 null 的具体原因", () => {
  const long1 = { side: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
  const short1 = { side: "SHORT" as const, qty: parse("1"), entryPrice: parse("50000") };
  const base = { otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, brackets: BTCUSDT_BRACKETS };

  /**
   * 双向持仓分母恰好对冲为 0 的一组腿：entryPrice 定得很低（=1）让两条腿都稳稳落在第 1 层（mmr 0.004），
   * 数量 251 / 249 是解 `(qL+qS)×mmr = SCALE×(qL−qS)` 在 bigint 截断下的一组精确解——
   * 不是凑单价 1 美元的多头/空头，纯粹为了让 solve() 内部分母算出恰好 0（双向全仓多空数量对冲，见 liquidation.ts 顶部公式注释）。
   */
  const hedgeLong = { side: "LONG" as const, qty: parse("251"), entryPrice: parse("1") };
  const hedgeShort = { side: "SHORT" as const, qty: parse("249"), entryPrice: parse("1") };

  it("AC-004 (error): liquidationPrice() 的返回值和 liquidationPriceDetailed().price 永远一致（既有算例复核）", () => {
    const cases = [
      { walletBalance: parse("5000"), legs: [long1] },
      { walletBalance: parse("5000"), legs: [short1] },
      { walletBalance: parse("10000"), legs: [long1] },
      { walletBalance: parse("60000"), legs: [long1] }, // MARGIN_SUFFICIENT
      { walletBalance: parse("1000"), legs: [] }, // NO_LEGS
      { walletBalance: parse("1000"), legs: [hedgeLong, hedgeShort] }, // HEDGE_OFFSET
    ];
    for (const c of cases) {
      const input = { ...base, ...c };
      expect(liquidationPrice(input)).toBe(liquidationPriceDetailed(input).price);
    }
  });

  it("AC-002a (happy-path): 双向持仓分母对冲为 0 → { price: null, reason: HEDGE_OFFSET }", () => {
    const result = liquidationPriceDetailed({ ...base, walletBalance: parse("1000"), legs: [hedgeLong, hedgeShort] });
    expect(result).toEqual({ price: null, reason: "HEDGE_OFFSET" });
  });

  it("AC-001a (happy-path): 保证金过于充足、算出价格 ≤ 0 → { price: null, reason: MARGIN_SUFFICIENT }", () => {
    const result = liquidationPriceDetailed({ ...base, walletBalance: parse("60000"), legs: [long1] });
    expect(result).toEqual({ price: null, reason: "MARGIN_SUFFICIENT" });
  });

  it("AC-005 (boundary): legs 为空数组 → { price: null, reason: NO_LEGS }，不抛异常", () => {
    expect(() => liquidationPriceDetailed({ ...base, walletBalance: parse("1000"), legs: [] })).not.toThrow();
    expect(liquidationPriceDetailed({ ...base, walletBalance: parse("1000"), legs: [] })).toEqual({ price: null, reason: "NO_LEGS" });
  });

  it("正常能算出强平价时 reason 为 null", () => {
    const result = liquidationPriceDetailed({ ...base, walletBalance: parse("5000"), legs: [long1] });
    expect(result.price).not.toBeNull();
    expect(result.reason).toBeNull();
  });
});
