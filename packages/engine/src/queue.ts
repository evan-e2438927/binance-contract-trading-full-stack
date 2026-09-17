import type { Fixed, OrderSide } from "@binance-contract-trading-full-stack/shared";
import type { Level } from "./types";

/**
 * 04-backend-design.md 5.5 节：拟真排队。这个文件只算数——给定挂单、盘口或者一笔行情成交，
 * 算出新的排队位置和能成交多少。不碰 EngineState，状态怎么改、成交怎么落账在 resting-orders.ts。
 *
 * 我们看不到币安队列的内部，只能看到每个价位的总量（depth20）和逐笔成交（aggTrade）。
 * 所有推断都往"保守"那边倒：宁可让用户的单成交慢一点，也不能让它比真实交易所更容易成交
 * （02-architecture.md 失真点 #3）。
 */

export interface QueuePosition {
  /** 前方还剩多少量。 */
  queueAhead: Fixed;
  /** 是不是估出来的：挂单价在可见 20 档之外，看不到真实值。 */
  queueEstimated: boolean;
}

/**
 * 挂单价在自己这一侧盘口（买单看 bids、卖单看 asks）里的位置：
 * - at：正好有这一档，前方是这一档的总量
 * - inside：在可见范围内但没有这一档（比最优价还优，或者落在两档之间的空价位）——前方没人
 * - beyond：比可见的最深一档还深，看不到
 */
type Spot = { kind: "at"; qty: Fixed } | { kind: "inside" } | { kind: "beyond" };

function locate(levels: readonly Level[], side: OrderSide, price: Fixed): Spot {
  const deepest = levels[levels.length - 1];
  if (!deepest) return { kind: "beyond" }; // 这一侧一档都没有：什么都看不到
  const level = levels.find((l) => l.price === price);
  if (level) return { kind: "at", qty: level.qty };
  // 买单价格越低越深，卖单价格越高越深
  const deeper = side === "BUY" ? price < deepest.price : price > deepest.price;
  return deeper ? { kind: "beyond" } : { kind: "inside" };
}

function ownSide(book: { bids: readonly Level[]; asks: readonly Level[] }, side: OrderSide): readonly Level[] {
  return side === "BUY" ? book.bids : book.asks;
}

/**
 * 下单时的初始排队位置。
 *
 * 和设计文档 5.5 节伪代码的一处不同：挂单价在可见范围内、但落在两档之间的空价位上，
 * 伪代码会走到"用最深档兜底"。depth20 给的是前 20 个**非空**价位，范围内缺的价位就是 0 量，
 * 前方确实没人，排队位置是 0，而且不是估算（设计缺口 #20）。
 */
export function estimateQueueAhead(
  side: OrderSide,
  price: Fixed,
  book: { bids: readonly Level[]; asks: readonly Level[] },
): QueuePosition {
  const levels = ownSide(book, side);
  const spot = locate(levels, side, price);
  switch (spot.kind) {
    case "at":
      return { queueAhead: spot.qty, queueEstimated: false };
    case "inside":
      return { queueAhead: 0n, queueEstimated: false };
    case "beyond":
      // 看不到真实值，用最深一档的量兜底，等价位进入可见范围再校准。
      // 一侧盘口为空时校验链第 2 步已经拒单，走到这里说明调用方没校验
      if (levels.length === 0) throw new Error(`盘口 ${side === "BUY" ? "bids" : "asks"} 为空，无法估算排队位置`);
      return { queueAhead: levels[levels.length - 1]!.qty, queueEstimated: true };
  }
}

/**
 * 盘口更新后的夹逼（设计文档 5.5 节"撤单造成的队列变化"）。
 *
 * - 这一档还在：前方的量不可能超过这一档的总量，取 min。估算过的单直接换成真实值
 * - 在可见范围内但这一档没了：被吃光或者全撤了，我排第一，归零
 * - 比可见范围还深：看不到，**保持不动**
 *
 * 最后一条和设计文档伪代码不同：伪代码只要找不到这一档就归零，但价格往反方向跑远、
 * 我的挂单掉出 20 档时也找不到——那时候归零等于凭空把用户排到队首（设计缺口 #20）。
 */
export function reconcileQueue(
  order: { side: OrderSide; price: Fixed } & QueuePosition,
  book: { bids: readonly Level[]; asks: readonly Level[] },
): QueuePosition {
  const spot = locate(ownSide(book, order.side), order.side, order.price);
  switch (spot.kind) {
    case "at":
      if (order.queueEstimated) return { queueAhead: spot.qty, queueEstimated: false };
      return { queueAhead: order.queueAhead < spot.qty ? order.queueAhead : spot.qty, queueEstimated: false };
    case "inside":
      return { queueAhead: 0n, queueEstimated: false };
    case "beyond":
      return { queueAhead: order.queueAhead, queueEstimated: order.queueEstimated };
  }
}

export interface ConsumeResult {
  queueAhead: Fixed;
  /** 这笔行情成交能让挂单成交多少，0n 表示不成交。成交价永远是挂单价，由调用方填。 */
  fillQty: Fixed;
}

/**
 * 用一笔行情成交消耗排队位置（设计文档 5.5 节"用成交流消耗队列"）。
 *
 * `m`（buyerIsMaker）决定这笔成交吃的是哪一侧的挂单：
 * - m = true：买方是 Maker，主动卖单吃掉了买单 → 推进**买单**的队列
 * - m = false：卖方是 Maker，主动买单吃掉了卖单 → 推进**卖单**的队列
 * 弄反了，挂单会在完全不该成交的时候成交。
 */
export function consumeQueue(
  order: { side: OrderSide; price: Fixed; queueAhead: Fixed; remainingQty: Fixed },
  trade: { price: Fixed; qty: Fixed; buyerIsMaker: boolean },
): ConsumeResult {
  const unchanged = { queueAhead: order.queueAhead, fillQty: 0n };
  const hitsMySide = order.side === "BUY" ? trade.buyerIsMaker : !trade.buyerIsMaker;
  if (!hitsMySide || trade.qty === 0n || order.remainingQty === 0n) return unchanged;

  // ① 成交价比我的挂单价更优（买单：别人在更高的价位成交）：那是排在我前面价位的队列，与我无关
  const better = order.side === "BUY" ? trade.price > order.price : trade.price < order.price;
  if (better) return unchanged;

  // ② 成交价穿过了我的价位：我这一档已经被吃光，剩余全部成交
  const through = order.side === "BUY" ? trade.price < order.price : trade.price > order.price;
  if (through) return { queueAhead: 0n, fillQty: order.remainingQty };

  // ③ 正好在我的价位：先消耗前方的量，多出来的才轮到我
  if (trade.qty <= order.queueAhead) {
    return { queueAhead: order.queueAhead - trade.qty, fillQty: 0n };
  }
  const leftover = trade.qty - order.queueAhead;
  return { queueAhead: 0n, fillQty: leftover < order.remainingQty ? leftover : order.remainingQty };
}
