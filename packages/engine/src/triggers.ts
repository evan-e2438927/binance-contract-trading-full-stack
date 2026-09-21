import { divRound, mulCeil, parse, type Fixed, type WorkingType } from "@binance-contract-trading-full-stack/shared";
import { executeOrder, orderSides } from "./execute-order";
import { putOrder, removeOrder } from "./journal";
import { positionKey, referencePrice, sortedOrders, type EngineState } from "./state";
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
 *
 * ── 跟踪委托 TRAILING_STOP_MARKET（第 15 讲，规则见 07-binance-reference.md 第 14 节）──
 *
 * 它没有固定触发价，止损线跟着价格走：
 *
 * 1. 下单起就开始记 `trackedPrice`——卖单记**最高价**、买单记**最低价**（币安："after order placed"）
 * 2. 激活：卖单要最高价 ≥ 激活价、买单要最低价 ≤ 激活价。不传激活价时取下单那一刻的参照价，
 *    等于"从现在开始跟"，一下单就是激活状态
 * 3. 触发：激活之后，价格从最有利处回撤够了就触发——
 *      卖单：最新价 ≤ 最高价 × (1 − 回调率)
 *      买单：最新价 ≥ 最低价 × (1 + 回调率)
 *    触发后按市价单走，和 *_MARKET 触发单同一条路
 *
 * 参照价用哪个（标记价 / 最新成交价）由 workingType 定，**追踪和触发用同一个**，不混用。
 *
 * 缺口 #53：`trackedPrice` 每跳一次价都在变，但**不发 orderUpdate 事件**——
 * 一秒几十条推送没人看得过来，也会把 WS 打满。前端要看当前跟到哪，走 REST 拉挂单列表
 * （和"排队位置变化不发事件"缺口 #21 同一个取舍）。
 */

type PlaceOrderInput = Extract<EngineInput, { t: "placeOrder" }>;

/**
 * 条件单下单（触发单 + 跟踪委托）：入簿，不冻结保证金、不排队。校验链已经通过。
 *
 * 跟踪委托没传激活价时，取下单那一刻的参照价——币安 activatePrice 的默认行为
 * （"default as the latest price(supporting different workingType)"）。
 * 取不到参照价这一步不会走到：校验链第 14 步已经 MARKET_NOT_READY 拒了。
 */
export function placeTriggerOrder(state: EngineState, input: PlaceOrderInput, validated: ValidatedOrder): EngineEvent[] {
  const { req } = input;
  const isTrailing = req.type === "TRAILING_STOP_MARKET";
  const reference = isTrailing ? referencePrice(state, req.symbol, validated.workingType) : null;
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
    stopPrice: req.stopPrice ?? null,
    workingType: validated.workingType,
    activationPrice: isTrailing ? (req.activationPrice ?? reference) : null,
    callbackRate: isTrailing ? req.callbackRate! : null,
    // 下单那一刻的参照价就是第一个追踪点：从此刻开始记最高 / 最低
    trackedPrice: isTrailing ? reference : null,
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

/**
 * 跟踪委托：把这个币对上的跟踪委托往前推一格——先更新追踪价，再看要不要触发。
 *
 * 顺序很重要：**先更新再判断**。价格一路往有利方向走的那一跳，止损线要跟着挪到新位置，
 * 不能拿旧的最高价去判回撤，否则一路上涨反而会把单子打掉。
 */
export function trackTrailing(
  state: EngineState,
  symbol: string,
  workingType: WorkingType,
  price: Fixed,
  ts: number,
): EngineEvent[] {
  const events: EngineEvent[] = [];
  const candidates = sortedOrders(
    state,
    (o) => o.symbol === symbol && o.type === "TRAILING_STOP_MARKET" && !o.triggered && o.workingType === workingType,
  );
  for (const { id } of candidates) {
    // 重新取：前面触发的单成交后可能平掉仓位，把这张只减仓单连带撤了
    const order = state.orders.get(id);
    if (!order) continue;

    const tracked = nextTracked(order.side, order.trackedPrice, price);
    if (tracked !== order.trackedPrice) {
      // 只改内存，不发事件（缺口 #53）。仍然走 putOrder：宿主落库失败要能回滚
      putOrder(state, { ...order, trackedPrice: tracked, updatedAt: ts });
    }
    if (trailingReached(order.side, tracked, order.activationPrice, order.callbackRate, price)) {
      events.push(...fireTrigger(state, state.orders.get(id) ?? order, ts));
    }
  }
  return events;
}

/** 卖单跟最高价、买单跟最低价。第一次收到行情时直接采用 */
export function nextTracked(side: "BUY" | "SELL", tracked: Fixed | null, price: Fixed): Fixed {
  if (tracked === null) return price;
  return side === "SELL" ? (price > tracked ? price : tracked) : price < tracked ? price : tracked;
}

/**
 * 跟踪委托触发了没有。两个条件都要满足（币安 FAQ 360042299292 的两行表格）：
 * 激活（最有利价穿过激活价）+ 回撤够（从最有利价回撤 ≥ 回调率）。
 *
 * 回调率是百分数（1 = 1%），所以要除以 100。这里用 `mulFloor` / `mulCeil` 把舍入定死在
 * **对用户不利的反方向**：止损线算得晚一点点，不会因为舍入提前把单子打掉。
 */
export function trailingReached(
  side: "BUY" | "SELL",
  tracked: Fixed | null,
  activationPrice: Fixed | null,
  callbackRate: Fixed | null,
  price: Fixed,
): boolean {
  if (tracked === null || activationPrice === null || callbackRate === null) return false;
  const activated = side === "SELL" ? tracked >= activationPrice : tracked <= activationPrice;
  if (!activated) return false;
  const ratio = divRound(callbackRate, parse("100"));
  const gap = mulCeil(tracked, ratio);
  return side === "SELL" ? price <= tracked - gap : price >= tracked + gap;
}

function fireTrigger(state: EngineState, order: Readonly<Order>, ts: number): EngineEvent[] {
  const account = state.accounts.get(order.accountId)!;
  // 先移出挂单簿：重新校验时，第 13、14 步的挂单数、第 9 步的同方向挂单名义价值都不该把它自己算进去
  removeOrder(state, order.id);

  const isMarket =
    order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT_MARKET" || order.type === "TRAILING_STOP_MARKET";
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
      activationPrice: order.activationPrice,
      callbackRate: order.callbackRate,
      trackedPrice: order.trackedPrice,
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
