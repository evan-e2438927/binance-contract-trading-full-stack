import { divRound, type Fixed, type FillRole, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { fee as feeOf, initialMargin, notional } from "./formulas";
import { putAccount, putOrder, putPosition, removeOrder, removePosition } from "./journal";
import { addToPosition, reducePosition, splitReverseFill } from "./position";
import { estimateQueueAhead } from "./queue";
import { positionKey, settingOf, sortedOrders, type EngineState } from "./state";
import type { EngineEvent, EngineInput, Fill, Level, Order, Position } from "./types";
import { limitOpenCost, type Direction, type ValidatedOrder } from "./validate-order";

/**
 * 04-backend-design.md 5.3 / 5.4 节：校验通过的订单在下单那一刻能成交多少就成交多少。
 *
 * - 市价单：逐档吃对手盘，第 11 步已保证深度够，一定全部成交
 * - 限价单：先判断会不会立刻成交（穿透盘口）。穿透的部分当 Taker 成交，价格不超过委托价；
 *   IOC 剩余过期，FOK 不能全成就整单过期，GTC 剩余挂进挂单簿、排队位置是 0
 * - 不穿透的 GTC / GTX 限价单：估算排队位置后挂进挂单簿，之后由行情成交流推进（第 06 讲，queue.ts / resting-orders.ts）
 * - 触发单：未触发时由 triggers.ts 入簿；触发那一刻转成 MARKET / LIMIT 请求再走这里，origin 带上原订单的身份
 *
 * 盘口快照本身不被修改：多个模拟用户可以吃同一档流动性（02-architecture.md 已知失真点 #2）。
 */

type PlaceOrderInput = Extract<EngineInput, { t: "placeOrder" }>;

/** 一笔待成交：价格和数量。 */
interface Take {
  price: Fixed;
  qty: Fixed;
}

/**
 * 触发单触发时（第 09 讲）用来保留原订单身份的字段：订单类型仍是 STOP / TAKE_PROFIT…、触发价、
 * triggered = true、下单时间、closePosition。成交机制只看 req.type（已经转成 MARKET 或 LIMIT）。
 */
export type OrderOrigin = Pick<Order, "type" | "stopPrice" | "workingType" | "createdAt" | "closePosition">;

export function executeOrder(
  state: EngineState,
  input: PlaceOrderInput,
  validated: ValidatedOrder,
  origin?: OrderOrigin,
): EngineEvent[] {
  const { req } = input;
  if (req.type !== "MARKET" && req.type !== "LIMIT") {
    throw new Error(`executeOrder 只处理 MARKET / LIMIT，触发单（${req.type}）要先经过 triggers.ts`);
  }

  const book = state.books.get(req.symbol)!; // 第 2 步保证了存在
  const levels = req.side === "BUY" ? book.asks : book.bids;
  const limitPrice = req.type === "LIMIT" ? req.price! : null;

  let order: Order = {
    id: input.orderId,
    clientOrderId: req.clientOrderId,
    accountId: input.accountId,
    symbol: req.symbol,
    side: req.side,
    positionSide: req.positionSide,
    type: origin?.type ?? req.type,
    timeInForce: validated.timeInForce,
    price: limitPrice,
    stopPrice: origin?.stopPrice ?? null,
    workingType: origin?.workingType ?? validated.workingType,
    qty: validated.qty,
    executedQty: 0n,
    avgPrice: 0n,
    reduceOnly: validated.reduceOnly,
    closePosition: origin?.closePosition ?? validated.closePosition,
    status: "NEW",
    triggered: origin !== undefined,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n,
    rejectReason: null,
    createdAt: origin?.createdAt ?? input.ts,
    updatedAt: input.ts,
  };

  // ── 限价单：先判定会不会立刻成交（5.4 节） ──
  if (limitPrice !== null) {
    const best = levels[0]!.price;
    const crosses = req.side === "BUY" ? limitPrice >= best : limitPrice <= best;
    if (!crosses) {
      if (order.timeInForce === "IOC" || order.timeInForce === "FOK") {
        order = { ...order, status: "EXPIRED", rejectReason: `${order.timeInForce} 单没有可以立即成交的对手盘` };
        return [{ t: "orderUpdate", order }];
      }
      // GTC / GTX 不穿透：是 Maker，估算排队位置后挂进挂单簿，冻结整张单的开仓成本（5.4 节 else 分支）
      order = {
        ...order,
        ...estimateQueueAhead(order.side, limitPrice, book),
        frozenMargin: restingFrozenMargin(state, order, order.qty),
      };
      putOrder(state, order);
      return [{ t: "orderUpdate", order }];
    }
  }

  const takes = takeLevels(levels, order.qty, limitPrice, req.side);
  const takeable = takes.reduce((sum, take) => sum + take.qty, 0n);

  if (req.type === "MARKET" && takeable < order.qty) {
    throw new Error(`市价单 ${order.id} 深度不够，校验链第 11 步应该已经拒掉了`);
  }
  if (order.timeInForce === "FOK" && takeable < order.qty) {
    // FOK：不能全部成交就整单过期，一笔都不成交
    order = {
      ...order,
      status: "EXPIRED",
      rejectReason: `FOK 单无法全部成交：委托价内可成交 ${takeable}，委托 ${order.qty}`,
    };
    return [{ t: "orderUpdate", order }];
  }

  // ── 逐笔成交 ──
  const fillEvents: EngineEvent[] = [];
  const closedSides = new Set<Direction>();
  let notionalSum = 0n;
  let fillCount = 0;
  for (const take of takes) {
    const result = applyFill(state, order, take.price, take.qty, "TAKER", `${order.id}:${fillCount + 1}`, input.ts);
    if (!result) break; // 只减仓单没有仓位可减了（缺口 #18 的成交时截断）
    fillCount++;
    fillEvents.push(...result.events);
    for (const side of result.closedSides) closedSides.add(side);
    order = { ...order, executedQty: order.executedQty + result.fill.qty };
    notionalSum += notional(result.fill.qty, result.fill.price);
  }
  if (order.executedQty > 0n) {
    order = { ...order, avgPrice: divRound(notionalSum, order.executedQty) };
  }

  // ── 订单的最终状态 ──
  const remaining = order.qty - order.executedQty;
  if (remaining === 0n) {
    order = { ...order, status: "FILLED" };
  } else if (req.type === "MARKET" || order.timeInForce === "IOC" || nothingLeftToClose(state, order)) {
    // 市价单 / IOC 剩余部分过期；只减仓类订单已经没有仓位可减，剩余部分同样过期
    order = { ...order, status: "EXPIRED", rejectReason: `未成交的 ${remaining} 已过期` };
  } else {
    // GTC 穿透后的剩余部分挂单：它已经把这个价位的对手盘吃光，自己排在第一个，排队位置是 0（5.4 节）
    order = {
      ...order,
      status: order.executedQty > 0n ? "PARTIALLY_FILLED" : "NEW",
      queueAhead: 0n,
      queueEstimated: false,
      frozenMargin: restingFrozenMargin(state, order, remaining),
    };
    putOrder(state, order);
  }

  // 订单事件放在最前面：数据库里 fills.order_id 外键引用 orders，宿主要先写订单再写成交
  return [
    { t: "orderUpdate", order },
    ...fillEvents,
    ...cancelResidualClosingOrders(state, order, closedSides, input.ts),
    ...(fillCount > 0 ? refreshFrozenMargins(state, order, input.ts) : []),
  ];
}

/** 按价格顺序吃档位，限价单不超过委托价。不修改盘口。 */
function takeLevels(levels: readonly Level[], qty: Fixed, limitPrice: Fixed | null, side: "BUY" | "SELL"): Take[] {
  const takes: Take[] = [];
  let remaining = qty;
  for (const level of levels) {
    if (remaining === 0n) break;
    if (limitPrice !== null && (side === "BUY" ? level.price > limitPrice : level.price < limitPrice)) break;
    const take = remaining < level.qty ? remaining : level.qty;
    takes.push({ price: level.price, qty: take });
    remaining -= take;
  }
  return takes;
}

// ─────────────────────────────────────────────────────────────
// 一笔成交落账：仓位 → 已实现盈亏 → 手续费 → 余额
// 第 06 讲的 Maker 成交（resting-orders.ts）也走这里
// ─────────────────────────────────────────────────────────────

export interface FillResult {
  fill: Fill;
  events: EngineEvent[];
  /** 这笔成交把哪个方向的仓位平到了 0。 */
  closedSides: Direction[];
}

/**
 * 一笔成交落账。fillId 由调用方拼：下单时吃单是 `订单id:序号`，挂单被行情成交是 `订单id:t归集成交id`。
 * 返回 null 表示这是只减仓类订单、但已经没有仓位可减（缺口 #18：成交时截断）。
 *
 * 顺序（04-backend-design.md 4.4 节）：
 * 1. 先平：单向模式的反向仓位、双向模式的平仓方向，最多平到仓位数量，算已实现盈亏、按比例释放逐仓保证金
 * 2. 再开：剩下的数量按成交价开仓 / 加仓（单向模式超过仓位的部分就是反手）
 * 3. 手续费按整笔成交量收，向上取整
 * 4. 已实现盈亏、手续费各发一条 balanceUpdate——全系统只有这一种事件能改钱包余额
 */
export function applyFill(
  state: EngineState,
  order: Readonly<Order>,
  price: Fixed,
  requestedQty: Fixed,
  role: FillRole,
  fillId: string,
  ts: number,
): FillResult | null {
  const account = state.accounts.get(order.accountId);
  if (!account) throw new Error(`成交的订单 ${order.id} 属于不存在的账户 ${order.accountId}`);

  const sides = orderSides(account.positionMode, order);
  const closeKey = positionKey(order.accountId, order.symbol, sides.closeSide);
  const closeTarget = sides.canClose ? state.positions.get(closeKey) : undefined;
  const closable = closeTarget && closeTarget.qty > 0n ? closeTarget.qty : 0n;

  // 缺口 #18：只减仓类订单最多成交到当前剩余仓位，多出来的不成交
  let qty = requestedQty;
  if (sides.closingOnly) {
    if (closable === 0n) return null;
    if (qty > closable) qty = closable;
  }

  const events: EngineEvent[] = [];
  const closedSides: Direction[] = [];
  let realizedPnl = 0n;
  let openQty = qty;

  // ① 平仓部分。成交量超过仓位就是反手（只有单向模式会走到，双向模式的平仓方向单上面已经截断），
  //    用第 03 讲的 splitReverseFill 拆成"平掉全部仓位 + 剩余开反向仓"
  if (closeTarget && closable > 0n) {
    const closeQty = qty > closable ? splitReverseFill(closable, qty).closeQty : qty;
    const reduced = reducePosition(
      closeTarget.positionSide,
      closeTarget.qty,
      closeTarget.entryPrice,
      closeTarget.isolatedMargin,
      closeQty,
      price,
    );
    realizedPnl = reduced.realizedPnl;
    const updated: Position = {
      ...closeTarget,
      qty: reduced.qty,
      isolatedMargin: closeTarget.isolatedMargin - reduced.releasedMargin,
      updatedAt: ts,
    };
    events.push({ t: "positionUpdate", position: updated });
    if (reduced.qty === 0n) {
      // 仓位平完：发一条 qty = 0 的更新让宿主落库，然后移出内存（和终态订单一样，内存里只留活着的）
      removePosition(state, closeKey);
      closedSides.push(sides.closeSide);
    } else {
      putPosition(state, updated);
    }
    openQty = qty - closeQty;
  }

  // ② 开仓 / 加仓部分
  if (openQty > 0n) {
    const setting = settingOf(state, order.accountId, order.symbol);
    const openKey = positionKey(order.accountId, order.symbol, sides.openSide);
    const existing = state.positions.get(openKey);
    if (existing && (existing.leverageNum !== setting.leverageNum || existing.marginMode !== setting.marginMode)) {
      // 调杠杆 / 切保证金模式要到第 08 讲才实现，那时候必须保证已有仓位和设置同步；走到这里说明没同步
      throw new Error(
        `仓位 ${openKey} 的杠杆 / 保证金模式（${existing.leverageNum}x ${existing.marginMode}）` +
          `和当前设置（${setting.leverageNum}x ${setting.marginMode}）不一致`,
      );
    }
    const added = addToPosition(existing?.qty ?? 0n, existing?.entryPrice ?? 0n, openQty, price);
    const addedIsolatedMargin =
      setting.marginMode === "ISOLATED" ? initialMargin(openQty, price, setting.leverageNum) : 0n;
    const position: Position = {
      accountId: order.accountId,
      symbol: order.symbol,
      positionSide: sides.openSide,
      marginMode: setting.marginMode,
      leverageNum: setting.leverageNum,
      qty: added.qty,
      entryPrice: added.entryPrice,
      isolatedMargin: (existing?.isolatedMargin ?? 0n) + addedIsolatedMargin,
      openedAt: existing?.openedAt ?? ts,
      updatedAt: ts,
    };
    putPosition(state, position);
    events.push({ t: "positionUpdate", position });
  }

  // ③ 手续费 + ④ 余额
  const fill: Fill = {
    id: fillId,
    orderId: order.id,
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    positionSide: order.positionSide,
    price,
    qty,
    role,
    fee: feeOf(qty, price, role, state.config.fees),
    realizedPnl,
    isLiquidation: false,
    ts,
  };
  events.unshift({ t: "fill", fill });

  let walletBalance = account.walletBalance;
  const ref = { type: "fill" as const, id: fill.id };
  if (realizedPnl !== 0n) {
    walletBalance += realizedPnl;
    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance,
      delta: realizedPnl,
      reason: "REALIZED_PNL",
      symbol: order.symbol,
      ref,
      ts,
    });
  }
  if (fill.fee > 0n) {
    walletBalance -= fill.fee;
    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance,
      delta: -fill.fee,
      reason: "FEE",
      symbol: order.symbol,
      ref,
      ts,
    });
  }
  if (walletBalance !== account.walletBalance) {
    putAccount(state, { ...account, walletBalance });
  }

  return { fill, events, closedSides };
}

// ─────────────────────────────────────────────────────────────
// 订单方向
// ─────────────────────────────────────────────────────────────

interface OrderSides {
  openSide: Direction;
  closeSide: Direction;
  /** 这张单会不会平掉现有仓位：单向模式任何单都可能（反向就平），双向模式只有平仓方向的单。 */
  canClose: boolean;
  /** 只减仓类订单：只能平、不能开。 */
  closingOnly: boolean;
}

/**
 * 和校验链第 8 步前面的方向计算是同一套规则：
 * 单向模式开仓方向看买卖（买 → 多），平的是反方向；双向模式开平都看 positionSide，
 * SELL + LONG / BUY + SHORT 是平仓方向，天生只减仓。
 */
export function orderSides(positionMode: PositionMode, order: Pick<Order, "side" | "positionSide" | "reduceOnly" | "closePosition">): OrderSides {
  if (positionMode === "HEDGE") {
    const side = order.positionSide as Direction;
    const closing =
      (order.side === "SELL" && order.positionSide === "LONG") || (order.side === "BUY" && order.positionSide === "SHORT");
    return { openSide: side, closeSide: side, canClose: closing, closingOnly: closing };
  }
  const openSide: Direction = order.side === "BUY" ? "LONG" : "SHORT";
  return {
    openSide,
    closeSide: openSide === "LONG" ? "SHORT" : "LONG",
    canClose: true,
    closingOnly: order.reduceOnly || order.closePosition,
  };
}

/** 只减仓类订单，且对应方向已经没有仓位了。 */
export function nothingLeftToClose(state: EngineState, order: Readonly<Order>): boolean {
  const sides = orderSides(state.accounts.get(order.accountId)!.positionMode, order);
  if (!sides.closingOnly) return false;
  const target = state.positions.get(positionKey(order.accountId, order.symbol, sides.closeSide));
  return !target || target.qty === 0n;
}

/**
 * 挂进挂单簿的剩余部分要冻结的保证金：只算其中"会开仓"的部分，和下单时第 10 步同一个公式（limitOpenCost）。
 * 单向模式下，剩余数量里还能平掉的反向仓位部分不冻结；只减仓类订单不冻结（不变式 ⑥）。
 */
export function restingFrozenMargin(
  state: EngineState,
  order: Readonly<Order>,
  remaining: Fixed,
  /** 第 08 讲调杠杆前试算用：按这个杠杆算，不传就按当前设置。 */
  leverageNum = settingOf(state, order.accountId, order.symbol).leverageNum,
): Fixed {
  const account = state.accounts.get(order.accountId)!;
  const sides = orderSides(account.positionMode, order);
  if (sides.closingOnly) return 0n;

  let openPart = remaining;
  if (sides.canClose) {
    const target = state.positions.get(positionKey(order.accountId, order.symbol, sides.closeSide));
    if (target) openPart = remaining > target.qty ? remaining - target.qty : 0n;
  }
  if (openPart === 0n) return 0n;

  return limitOpenCost({
    openSide: sides.openSide,
    qty: openPart,
    price: order.price!,
    markPrice: state.marks.get(order.symbol)!.markPrice,
    lastPrice: state.lastPrices.get(order.symbol),
    leverageNum,
    takerFeeRate: state.config.fees.takerFeeRate,
  }).total;
}

/**
 * 仓位平完之后，同一方向上残余的只减仓类挂单已经没有仓位可减，撤掉（01-domain-knowledge.md："仓位平完后
 * 残余的只减仓单自动撤销"；04-backend-design.md 第 3 节状态机：只减仓单失效 → CANCELED）。
 */
export function cancelResidualClosingOrders(
  state: EngineState,
  current: Readonly<Order>,
  closedSides: ReadonlySet<Direction>,
  ts: number,
): EngineEvent[] {
  if (closedSides.size === 0) return [];
  const account = state.accounts.get(current.accountId)!;
  const events: EngineEvent[] = [];
  for (const order of [...state.orders.values()]) {
    if (order.accountId !== current.accountId || order.symbol !== current.symbol) continue;
    const sides = orderSides(account.positionMode, order);
    if (!sides.closingOnly || !closedSides.has(sides.closeSide)) continue;
    const canceled: Order = { ...order, status: "CANCELED", rejectReason: "仓位已平完，只减仓单自动撤销", updatedAt: ts };
    removeOrder(state, order.id);
    events.push({ t: "orderUpdate", order: canceled });
  }
  return events;
}

/**
 * 设计缺口 #23（第 07 讲定）：成交改变了仓位之后，同一账户同一币对上**其它**挂单的冻结保证金按新仓位重算。
 *
 * 冻结保证金只算"会开仓"的那部分（restingFrozenMargin），而"会开仓"多少取决于当前仓位：
 * 单向模式持多 1、挂卖 2，只冻结开空 1 的成本；多头被别的单平掉之后，这张卖单全成交会开空 2，
 * 不重算的话冻结只有一半，可用余额被高估，用户能多开仓。反过来仓位变大时，冻结会变少，同样要跟上。
 *
 * 只在仓位变化时重算，标记价 / 最新价变化时不重算（开仓亏损、空单假设价格会跟着变，但每个 tick 重算所有挂单代价太大）。
 * 冻结保证金是 orders 表的一列，变了就发 orderUpdate。
 */
export function refreshFrozenMargins(state: EngineState, current: Readonly<Order>, ts: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  const others = sortedOrders(
    state,
    (o) => o.accountId === current.accountId && o.symbol === current.symbol && o.id !== current.id && o.price !== null,
  );
  for (const order of others) {
    // 未触发的触发单不冻结保证金（第 09 讲），不参与
    if (order.type !== "LIMIT" && !order.triggered) continue;
    const next = restingFrozenMargin(state, order, order.qty - order.executedQty);
    if (next === order.frozenMargin) continue;
    const updated: Order = { ...order, frozenMargin: next, updatedAt: ts };
    putOrder(state, updated);
    events.push({ t: "orderUpdate", order: updated });
  }
  return events;
}
