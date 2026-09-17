import { putOrder, removeOrder } from "./journal";
import { addToPosition } from "./position";
import { consumeQueue, reconcileQueue } from "./queue";
import {
  applyFill,
  cancelResidualClosingOrders,
  nothingLeftToClose,
  refreshFrozenMargins,
  restingFrozenMargin,
} from "./execute-order";
import { sortedOrders, type EngineState } from "./state";
import type { EngineEvent, EngineInput, Order } from "./types";

/**
 * 挂单簿里的订单怎么随行情变化（04-backend-design.md 5.2 节主循环的 depth / aggTrade 两行）：
 *
 * - 盘口更新：夹逼每张挂单的排队位置
 * - 行情成交：消耗排队位置，轮到了就按**挂单价**成交（Maker），走第 05 讲的 applyFill 落账
 * - 用户撤单
 *
 * 模拟挂单之间互不撮合，也不消耗真实流动性：同一笔行情成交可以同时让多个用户的挂单成交
 * （02-architecture.md 失真点 #2）。所以每张挂单独立地和这笔成交比，谁先谁后只影响事件顺序。
 */

type InputOf<T extends EngineInput["t"]> = Extract<EngineInput, { t: T }>;

/** 某个币对上参与撮合的挂单，按下单时间、再按 id 排序（排序的理由见 state.ts 的 sortedOrders）。 */
function restingOrders(state: EngineState, symbol: string): Readonly<Order>[] {
  // 还没触发的触发单不在盘口上（第 09 讲）
  return sortedOrders(state, (o) => o.symbol === symbol && o.price !== null && (o.type === "LIMIT" || o.triggered));
}

// ─────────────────────────────────────────────────────────────
// 盘口更新：夹逼排队位置
// ─────────────────────────────────────────────────────────────

/**
 * 排队位置的变化**不发事件**：它每 100ms 就可能变一次，挂单一多，宿主光写库就写不过来。
 * 内存里的值是准的；数据库里的 queue_ahead 只在订单有别的变化（成交、撤单）时跟着 orderUpdate 一起写，
 * 进程重启后反正要按当时盘口保守重置（04-backend-design.md 第 10 节"重启恢复"第 4 步），旧值用不上（设计缺口 #21）。
 */
export function reconcileBook(state: EngineState, input: InputOf<"book">): EngineEvent[] {
  const book = state.books.get(input.symbol)!; // 调用方刚写进去
  for (const order of restingOrders(state, input.symbol)) {
    const next = reconcileQueue({ ...order, price: order.price! }, book);
    if (next.queueAhead !== order.queueAhead || next.queueEstimated !== order.queueEstimated) {
      putOrder(state, { ...order, ...next });
    }
  }
  return [];
}

// ─────────────────────────────────────────────────────────────
// 行情成交：消耗排队位置、Maker 成交
// ─────────────────────────────────────────────────────────────

export function matchTrade(state: EngineState, input: InputOf<"trade">): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const { id } of restingOrders(state, input.symbol)) {
    // 每张单重新从状态里取：前面某张单的成交可能已经把它当作残余只减仓单撤掉了
    const order = state.orders.get(id);
    if (!order) continue;

    const price = order.price!;
    const result = consumeQueue(
      { side: order.side, price, queueAhead: order.queueAhead, remainingQty: order.qty - order.executedQty },
      input,
    );
    if (result.fillQty === 0n) {
      if (result.queueAhead !== order.queueAhead) putOrder(state, { ...order, queueAhead: result.queueAhead });
      continue;
    }
    events.push(...fillResting(state, { ...order, queueAhead: result.queueAhead }, result.fillQty, input));
  }
  return events;
}

/** 一张挂单被行情成交吃到：按挂单价成交、更新订单、处理剩余部分。 */
function fillResting(
  state: EngineState,
  order: Readonly<Order>,
  qty: bigint,
  input: InputOf<"trade">,
): EngineEvent[] {
  const price = order.price!;
  // ★ 成交价是挂单价，不是行情成交价：挂单方永远按自己的价格成交
  const result = applyFill(state, order, price, qty, "MAKER", `${order.id}:t${input.tradeId}`, input.ts);

  let updated: Order = { ...order, updatedAt: input.ts };
  if (result) {
    updated = {
      ...updated,
      executedQty: order.executedQty + result.fill.qty,
      // 订单成交均价和仓位均价同一套算法：按数量加权、四舍五入到 8 位
      avgPrice: addToPosition(order.executedQty, order.avgPrice, result.fill.qty, price).entryPrice,
    };
  }

  const remaining = updated.qty - updated.executedQty;
  if (remaining === 0n) {
    updated = { ...updated, status: "FILLED", frozenMargin: 0n };
    removeOrder(state, order.id);
  } else if (nothingLeftToClose(state, updated)) {
    // 只减仓类挂单，仓位已经被这笔（或者别的单）平完了，剩下的撤掉（缺口 #18）
    updated = { ...updated, status: "CANCELED", frozenMargin: 0n, rejectReason: "仓位已平完，只减仓单自动撤销" };
    removeOrder(state, order.id);
  } else {
    // 部分成交：冻结保证金按剩余部分重算（仓位变了，剩余里"会开仓"的部分也可能变了）
    updated = {
      ...updated,
      status: updated.executedQty > 0n ? "PARTIALLY_FILLED" : updated.status,
      frozenMargin: restingFrozenMargin(state, updated, remaining),
    };
    putOrder(state, updated);
  }

  // 和第 05 讲一样，订单事件在最前面（fills.order_id 外键）
  return [
    { t: "orderUpdate", order: updated },
    ...(result ? result.events : []),
    ...(result ? cancelResidualClosingOrders(state, updated, new Set(result.closedSides), input.ts) : []),
    ...(result ? refreshFrozenMargins(state, updated, input.ts) : []),
  ];
}

// ─────────────────────────────────────────────────────────────
// 撤单
// ─────────────────────────────────────────────────────────────

/**
 * 用户撤单。订单不存在、已经是终态（终态订单不在内存里）、或者不属于这个账户，一律报 ORDER_NOT_FOUND——
 * 不区分"不是你的单"和"没有这张单"，免得别人拿订单 id 探测（币安同样只回 -2011 "Unknown order sent"）。
 * 冻结保证金不需要单独释放：可用余额是现算的，订单从内存里拿掉，它的 frozenMargin 自然就不算了。
 */
export function cancelOrder(state: EngineState, input: InputOf<"cancelOrder">): EngineEvent[] {
  const order = state.orders.get(input.orderId);
  if (!order || order.accountId !== input.accountId) {
    return [
      {
        t: "rejected",
        accountId: input.accountId,
        input: "cancelOrder",
        clientOrderId: null,
        orderId: input.orderId,
        code: "ORDER_NOT_FOUND",
        message: `订单 ${input.orderId} 不存在或已经结束`,
        ts: input.ts,
      },
    ];
  }
  removeOrder(state, order.id);
  return [{ t: "orderUpdate", order: { ...order, status: "CANCELED", frozenMargin: 0n, updatedAt: input.ts } }];
}
