import type { Fixed, WorkingType } from "@binance-contract-trading-full-stack/shared";
import { executeOrder, orderSides } from "./execute-order";
import { putOrder, removeOrder } from "./journal";
import { positionKey, sortedOrders, type EngineState } from "./state";
import type { EngineEvent, EngineInput, Order, PlaceOrderRequest } from "./types";
import { triggerReached, type ValidatedOrder, validateOrder } from "./validate-order";

/**
 * 04-backend-design.md 第 7 节：触发单（STOP / STOP_MARKET / TAKE_PROFIT / TAKE_PROFIT_MARKET）。
 * 规则按币安 New Algo Order 接口说明核对（`docs/design/07-binance-reference.md` 第 2、10 节）：
 *
 * 1. 下单：校验链第 14 步查过触发价没被穿过、条件单总数没超；入簿时 triggered = false，**不冻结保证金**、不排队
 * 2. 触发判定：价格按 workingType 取——MARK_PRICE 看标记价推送，CONTRACT_PRICE（默认）看最新成交价推送
 *      STOP / STOP_MARKET            买：价格 ≥ 触发价    卖：价格 ≤ 触发价
 *      TAKE_PROFIT / TAKE_PROFIT_MARKET  买：价格 ≤ 触发价    卖：价格 ≥ 触发价
 * 3. 触发那一刻：转成 MARKET（*_MARKET）或 LIMIT（STOP / TAKE_PROFIT，按委托价和 TIF）请求，**重新走一遍校验链**，
 *    通过就按第 05、06 讲成交或挂单。closePosition 单的数量按触发那一刻的全部仓位算
 * 4. 触发时校验不通过：
 *    - GTX 会吃单 → EXPIRED（缺口 #13，和普通 GTX 在撮合里过期一致）
 *    - 其它（保证金不够、深度不够、没仓位可减……）→ REJECTED，原因写进 rejectReason
 *      （币安条件单状态 REJECTED："denied by the matching engine, such as in scenarios of margin check failures"）
 *
 * 和币安刻意不同：币安触发后是新下一张普通单（新的 orderId），我们沿用同一张订单、triggered 置 true，
 * 数据库 orders 表本来就有 triggered 列，少一层 algoId ↔ orderId 映射。
 */

type PlaceOrderInput = Extract<EngineInput, { t: "placeOrder" }>;

/** 触发单下单：入簿，不冻结保证金、不排队。校验链已经通过。 */
export function placeTriggerOrder(state: EngineState, input: PlaceOrderInput, validated: ValidatedOrder): EngineEvent[] {
  const { req } = input;
  const order: Order = {
    id: input.orderId,
    clientOrderId: req.clientOrderId,
    accountId: input.accountId,
    symbol: req.symbol,
    side: req.side,
    positionSide: req.positionSide,
    type: req.type,
    timeInForce: validated.timeInForce,
    price: req.price ?? null,
    stopPrice: req.stopPrice!,
    workingType: validated.workingType,
    qty: validated.qty, // closePosition 单为 0，触发时按仓位现算
    executedQty: 0n,
    avgPrice: 0n,
    reduceOnly: validated.reduceOnly,
    closePosition: validated.closePosition,
    status: "NEW",
    triggered: false,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n, // 币安：条件单未触发时不占保证金
    rejectReason: null,
    createdAt: input.ts,
    updatedAt: input.ts,
  };
  putOrder(state, order);
  return [{ t: "orderUpdate", order }];
}

/** 某个币对上某种价格类型的触发单，按下单时间检查一遍，满足条件的触发。 */
export function checkTriggers(
  state: EngineState,
  symbol: string,
  workingType: WorkingType,
  price: Fixed,
  ts: number,
): EngineEvent[] {
  const events: EngineEvent[] = [];
  const candidates = sortedOrders(
    state,
    (o) => o.symbol === symbol && o.stopPrice !== null && !o.triggered && o.workingType === workingType,
  );
  for (const { id } of candidates) {
    // 重新取：前面触发的单成交后可能平掉了仓位，把这张只减仓类触发单连带撤掉了
    const order = state.orders.get(id);
    if (!order || !triggerReached(order.type, order.side, order.stopPrice!, price)) continue;
    events.push(...fireTrigger(state, order, ts));
  }
  return events;
}

function fireTrigger(state: EngineState, order: Readonly<Order>, ts: number): EngineEvent[] {
  const account = state.accounts.get(order.accountId)!;
  // 先移出挂单簿：重新校验时，第 13、14 步的挂单数、第 9 步的同方向挂单名义价值都不该把它自己算进去
  removeOrder(state, order.id);

  const isMarket = order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT_MARKET";
  const hedge = account.positionMode === "HEDGE";
  let qty = order.qty;
  if (order.closePosition) {
    // 币安："If triggered, close all current long position (if SELL) or current short position (if BUY)"
    const { closeSide } = orderSides(account.positionMode, order);
    qty = state.positions.get(positionKey(order.accountId, order.symbol, closeSide))?.qty ?? 0n;
    if (qty === 0n) return [finish(order, "REJECTED", "触发时已经没有可以平的仓位", ts)];
  }

  const req: PlaceOrderRequest = {
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    positionSide: order.positionSide,
    type: isMarket ? "MARKET" : "LIMIT",
    ...(isMarket ? {} : { price: order.price!, timeInForce: order.timeInForce }),
    qty,
    // 双向模式不能传 reduceOnly（第 04 讲）；单向模式 closePosition 转成只减仓
    ...(hedge ? {} : { reduceOnly: order.reduceOnly || order.closePosition }),
  };

  const validation = validateOrder(state, order.accountId, req);
  if (!validation.ok) {
    const status = validation.code === "POST_ONLY_REJECTED" ? "EXPIRED" : "REJECTED";
    return [finish(order, status, `触发时${validation.message}（${validation.code}）`, ts)];
  }

  return executeOrder(
    state,
    { t: "placeOrder", accountId: order.accountId, orderId: order.id, req, ts },
    validation.order,
    {
      type: order.type,
      stopPrice: order.stopPrice,
      workingType: order.workingType,
      createdAt: order.createdAt,
      closePosition: order.closePosition,
    },
  );
}

/** 触发失败：订单已经移出挂单簿，发一条终态 orderUpdate。 */
function finish(
  order: Readonly<Order>,
  status: "EXPIRED" | "REJECTED",
  reason: string,
  ts: number,
): EngineEvent {
  return { t: "orderUpdate", order: { ...order, triggered: true, status, rejectReason: reason, updatedAt: ts } };
}
