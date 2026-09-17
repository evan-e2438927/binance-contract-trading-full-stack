import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { consumeQueue, estimateQueueAhead, reconcileQueue } from "./queue";
import type { Level } from "./types";

function levels(rows: [string, string][]): Level[] {
  return rows.map(([price, qty]) => ({ price: parse(price), qty: parse(qty) }));
}

/** 买盘 50,000 / 49,950 / 49,900，卖盘 50,000.5 / 50,050 / 50,100。 */
const book = {
  bids: levels([
    ["50000", "1"],
    ["49950", "2"],
    ["49900", "3"],
  ]),
  asks: levels([
    ["50000.5", "1"],
    ["50050", "2"],
    ["50100", "3"],
  ]),
};

describe("estimateQueueAhead：下单时的初始排队位置", () => {
  it("挂单价正好有一档：前方是这一档的总量", () => {
    expect(estimateQueueAhead("BUY", parse("49950"), book)).toEqual({ queueAhead: parse("2"), queueEstimated: false });
    expect(estimateQueueAhead("SELL", parse("50050"), book)).toEqual({ queueAhead: parse("2"), queueEstimated: false });
  });

  it("挂单价优于最优价：前方没人", () => {
    expect(estimateQueueAhead("BUY", parse("50000.2"), book)).toEqual({ queueAhead: 0n, queueEstimated: false });
    expect(estimateQueueAhead("SELL", parse("50000.3"), book)).toEqual({ queueAhead: 0n, queueEstimated: false });
  });

  it("可见范围内的空价位：depth20 只给非空价位，缺的就是 0 量，前方没人，不是估算（缺口 #20）", () => {
    expect(estimateQueueAhead("BUY", parse("49920"), book)).toEqual({ queueAhead: 0n, queueEstimated: false });
    expect(estimateQueueAhead("SELL", parse("50070"), book)).toEqual({ queueAhead: 0n, queueEstimated: false });
  });

  it("比可见最深一档还深：用最深档的量兜底，标记为估算", () => {
    expect(estimateQueueAhead("BUY", parse("49000"), book)).toEqual({ queueAhead: parse("3"), queueEstimated: true });
    expect(estimateQueueAhead("SELL", parse("51000"), book)).toEqual({ queueAhead: parse("3"), queueEstimated: true });
  });

  it("这一侧盘口为空：没法估，抛错（校验链第 2 步应该已经拒单）", () => {
    expect(() => estimateQueueAhead("BUY", parse("49000"), { bids: [], asks: book.asks })).toThrow(/盘口 bids 为空/);
  });
});

describe("reconcileQueue：盘口更新后夹逼", () => {
  const buy = { side: "BUY" as const, price: parse("49900") };

  it("这一档总量降到比前方还少：夹到总量", () => {
    expect(reconcileQueue({ ...buy, queueAhead: parse("5"), queueEstimated: false }, book)).toEqual({
      queueAhead: parse("3"),
      queueEstimated: false,
    });
  });

  it("这一档总量比前方多：不动（撤单默认发生在我后面）", () => {
    expect(reconcileQueue({ ...buy, queueAhead: parse("1.2"), queueEstimated: false }, book)).toEqual({
      queueAhead: parse("1.2"),
      queueEstimated: false,
    });
  });

  it("估算过的单进入可见范围：直接换成真实值，哪怕比估算值大", () => {
    expect(reconcileQueue({ ...buy, queueAhead: parse("0.5"), queueEstimated: true }, book)).toEqual({
      queueAhead: parse("3"),
      queueEstimated: false,
    });
  });

  it("可见范围内这一档没了：被吃光或全撤，排第一", () => {
    const order = { side: "BUY" as const, price: parse("49920"), queueAhead: parse("4"), queueEstimated: false };
    expect(reconcileQueue(order, book)).toEqual({ queueAhead: 0n, queueEstimated: false });
  });

  it("掉出可见范围：看不到，保持不动——不能当成被吃光归零（缺口 #20）", () => {
    const order = { side: "BUY" as const, price: parse("49000"), queueAhead: parse("4"), queueEstimated: false };
    expect(reconcileQueue(order, book)).toEqual({ queueAhead: parse("4"), queueEstimated: false });
    const sell = { side: "SELL" as const, price: parse("51000"), queueAhead: parse("4"), queueEstimated: true };
    expect(reconcileQueue(sell, book)).toEqual({ queueAhead: parse("4"), queueEstimated: true });
  });
});

describe("consumeQueue：行情成交消耗排队位置", () => {
  const buy = { side: "BUY" as const, price: parse("49900"), queueAhead: parse("3"), remainingQty: parse("0.5") };
  const sell = { side: "SELL" as const, price: parse("50100"), queueAhead: parse("3"), remainingQty: parse("0.5") };
  const trade = (price: string, qty: string, buyerIsMaker: boolean) => ({
    price: parse(price),
    qty: parse(qty),
    buyerIsMaker,
  });

  it("m = true 推进买单，m = false 推进卖单", () => {
    expect(consumeQueue(buy, trade("49900", "1.2", true))).toEqual({ queueAhead: parse("1.8"), fillQty: 0n });
    expect(consumeQueue(sell, trade("50100", "1.2", false))).toEqual({ queueAhead: parse("1.8"), fillQty: 0n });
  });

  it("★ 方向不对的成交不推进队列：买单收到 m = false、卖单收到 m = true，哪怕价格穿透也不动", () => {
    expect(consumeQueue(buy, trade("49900", "10", false))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
    expect(consumeQueue(buy, trade("49000", "10", false))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
    expect(consumeQueue(sell, trade("51000", "10", true))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
  });

  it("成交价比挂单价更优：是前面价位的队列，与我无关", () => {
    expect(consumeQueue(buy, trade("49950", "10", true))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
    expect(consumeQueue(sell, trade("50050", "10", false))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
  });

  it("成交价穿过挂单价：这一档已被吃光，剩余全部成交", () => {
    expect(consumeQueue(buy, trade("49880", "0.001", true))).toEqual({ queueAhead: 0n, fillQty: parse("0.5") });
    expect(consumeQueue(sell, trade("50100.1", "0.001", false))).toEqual({ queueAhead: 0n, fillQty: parse("0.5") });
  });

  it("正好在挂单价、量刚好等于前方：前方清零，我还没成交", () => {
    expect(consumeQueue(buy, trade("49900", "3", true))).toEqual({ queueAhead: 0n, fillQty: 0n });
  });

  it("正好在挂单价、量超过前方：多出来的给我，最多成交到剩余数量", () => {
    expect(consumeQueue(buy, trade("49900", "3.2", true))).toEqual({ queueAhead: 0n, fillQty: parse("0.2") });
    expect(consumeQueue(buy, trade("49900", "5", true))).toEqual({ queueAhead: 0n, fillQty: parse("0.5") });
  });

  it("成交量为 0（只有 RPI 订单参与的成交，nq = 0）：什么都不动", () => {
    expect(consumeQueue(buy, trade("49000", "0", true))).toEqual({ queueAhead: parse("3"), fillQty: 0n });
  });
});
