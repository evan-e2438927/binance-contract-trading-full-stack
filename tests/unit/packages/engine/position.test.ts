import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { addToPosition, reducePosition, splitReverseFill } from "../../../../packages/engine/src/position";

describe("加仓：加权平均开仓价", () => {
  it("01-domain-knowledge.md 4.4 节算例：1 BTC @ 50,000 再买 1 BTC @ 52,000 → 2 BTC @ 51,000", () => {
    const result = addToPosition(parse("1"), parse("50000"), parse("1"), parse("52000"));
    expect(result.qty).toBe(parse("2"));
    expect(result.entryPrice).toBe(parse("51000"));
  });

  it("从零开仓：加权平均退化成直接取成交价", () => {
    const result = addToPosition(0n, 0n, parse("1"), parse("50000"));
    expect(result.qty).toBe(parse("1"));
    expect(result.entryPrice).toBe(parse("50000"));
  });

  it("不等量加仓按数量加权，不是简单平均", () => {
    // 1 BTC @ 50,000 + 3 BTC @ 54,000 → 4 BTC @ (50000+162000)/4 = 53,000
    const result = addToPosition(parse("1"), parse("50000"), parse("3"), parse("54000"));
    expect(result.qty).toBe(parse("4"));
    expect(result.entryPrice).toBe(parse("53000"));
  });
});

describe("减仓：均价不变，已实现盈亏按方向算", () => {
  it("01-domain-knowledge.md 4.4 节算例：2 BTC @ 51,000 卖 1 BTC @ 53,000 → 已实现 +2,000，剩 1 BTC 均价仍 51,000", () => {
    const result = reducePosition("LONG", parse("2"), parse("51000"), 0n, parse("1"), parse("53000"));
    expect(result.qty).toBe(parse("1"));
    expect(result.realizedPnl).toBe(parse("2000"));
  });

  it("空头减仓：价格跌破开仓价是盈利", () => {
    const result = reducePosition("SHORT", parse("1"), parse("50000"), 0n, parse("1"), parse("48000"));
    expect(result.realizedPnl).toBe(parse("2000"));
  });

  it("已实现盈亏向下取整（保守），不四舍五入", () => {
    // diff = 0.00000009，closeQty = 0.5 → 真实值 0.000000045，四舍五入该进到 5，截断给 4
    const result = reducePosition(
      "LONG",
      parse("1"),
      parse("50000"),
      0n,
      parse("0.5"),
      parse("50000.00000009"),
    );
    expect(result.realizedPnl).toBe(4n); // 不是四舍五入后的 5n
  });

  it("亏损时向下取整是多算亏损（第 05 讲从朝零截断改成 mulFloor）", () => {
    // diff = −0.00000009，closeQty = 0.5 → 真实值 −0.000000045，朝零截断给 −4，向下取整给 −5
    const result = reducePosition(
      "LONG",
      parse("1"),
      parse("50000.00000009"),
      0n,
      parse("0.5"),
      parse("50000"),
    );
    expect(result.realizedPnl).toBe(-5n);
  });

  it("closeQty 超过 currentQty 直接抛错——反手要走 splitReverseFill", () => {
    expect(() =>
      reducePosition("LONG", parse("1"), parse("50000"), 0n, parse("2"), parse("50000")),
    ).toThrow();
  });

  describe("逐仓保证金按比例释放", () => {
    it("全部平仓：released 正好等于全部 isolatedMargin，不受除法截断影响", () => {
      const result = reducePosition(
        "LONG",
        parse("1"),
        parse("50000"),
        parse("5000"),
        parse("1"),
        parse("50000"),
      );
      expect(result.releasedMargin).toBe(parse("5000"));
    });

    it("部分平仓：按比例释放", () => {
      // 2 BTC 仓位，逐仓保证金 5000，平掉一半 → 释放 2500
      const result = reducePosition(
        "LONG",
        parse("2"),
        parse("50000"),
        parse("5000"),
        parse("1"),
        parse("50000"),
      );
      expect(result.releasedMargin).toBe(parse("2500"));
    });
  });
});

describe("反手拆分：只算怎么拆，不算加/减仓本身", () => {
  it("单向模式 2 BTC 多单被 3 BTC 卖单打穿：拆成平 2 BTC + 开 1 BTC 反向仓", () => {
    const split = splitReverseFill(parse("2"), parse("3"));
    expect(split.closeQty).toBe(parse("2"));
    expect(split.openQty).toBe(parse("1"));
  });

  it("成交量没超过仓位时不该调用这个函数——直接抛错，别悄悄算出 0", () => {
    expect(() => splitReverseFill(parse("2"), parse("2"))).toThrow();
    expect(() => splitReverseFill(parse("2"), parse("1"))).toThrow();
  });
});
