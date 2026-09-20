import type {
  OrderSide,
  OrderType,
  PositionMode,
  PositionSide,
  TimeInForce,
  WorkingType,
} from "@/server-api-module/common/types";
import type { PlaceOrderBody } from "@/server-api-module/order/types";

/**
 * 表单 → `POST /orders` 的请求体（M07）。
 *
 * 这里只做"形状"，不做校验（校验在 order-validate.ts，服务端的校验链才是标准）。
 * 两张表照抄设计文档，不要自己推——推错是这块最常见的 bug：
 * - 开平 → side / positionSide：`05-frontend-design.md` 第 10 节
 * - 条件单方向 → STOP / TAKE_PROFIT：引擎 validate-order.ts 的触发条件
 */

/** 下单面板的三个 tab */
export type OrderTab = "LIMIT" | "MARKET" | "CONDITIONAL";

/** 条件单触发后按什么下：限价还是市价 */
export type ConditionalExec = "LIMIT" | "MARKET";

/** 双向持仓模式下的开 / 平切换；单向模式不显示 */
export type OpenClose = "OPEN" | "CLOSE";

export interface OrderFormValues {
  tab: OrderTab;
  side: OrderSide;
  openClose: OpenClose;
  price: string;
  triggerPrice: string;
  workingType: WorkingType;
  conditionalExec: ConditionalExec;
  qty: string;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
}

/**
 * 开 / 平 → positionSide（`05` 第 10 节那张表）：
 *   开多 BUY + LONG ｜ 平多 SELL + LONG ｜ 开空 SELL + SHORT ｜ 平空 BUY + SHORT
 * 单向模式一律 BOTH。
 */
export function positionSideOf(mode: PositionMode, side: OrderSide, openClose: OpenClose): PositionSide {
  if (mode === "ONE_WAY") return "BOTH";
  if (openClose === "OPEN") return side === "BUY" ? "LONG" : "SHORT";
  return side === "BUY" ? "SHORT" : "LONG";
}

/**
 * 条件单是止损还是止盈：看触发价在参照价（最新价 / 标记价，跟 workingType 走）的哪一边。
 *   买：触发价 ≥ 参照价 → 止损买（涨上去认输买回）；触发价 < 参照价 → 止盈买（跌下来落袋买回）
 *   卖：触发价 ≤ 参照价 → 止损卖；触发价 > 参照价 → 止盈卖
 * 和引擎的触发条件一致，方向反了会变成"下单即触发"被拒（校验链第 14 步）。
 */
export function conditionalTypeOf(
  side: OrderSide,
  triggerPrice: bigint,
  referencePrice: bigint,
  exec: ConditionalExec,
): Extract<OrderType, "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET"> {
  const isStop = side === "BUY" ? triggerPrice >= referencePrice : triggerPrice <= referencePrice;
  if (isStop) return exec === "MARKET" ? "STOP_MARKET" : "STOP";
  return exec === "MARKET" ? "TAKE_PROFIT_MARKET" : "TAKE_PROFIT";
}

export interface BuildOrderArgs {
  values: OrderFormValues;
  symbol: string;
  positionMode: PositionMode;
  clientOrderId: string;
  /** 条件单判方向用的参照价：workingType 是标记价就传标记价，否则传最新价 */
  referencePrice: bigint | null;
  /** 触发价，已经 parse 成 bigint；条件单必填 */
  triggerPriceFixed: bigint | null;
}

/** 表单 → 请求体。条件单缺参照价（行情还没来）时返回 null，调用方不要提交 */
export function buildPlaceOrderBody(args: BuildOrderArgs): PlaceOrderBody | null {
  const { values, symbol, positionMode, clientOrderId } = args;
  const positionSide = positionSideOf(positionMode, values.side, values.openClose);
  const base = {
    clientOrderId,
    symbol,
    side: values.side,
    positionSide,
    // 只减仓在双向模式下不允许传（币安规则），平仓靠 positionSide 表达
    reduceOnly: positionMode === "ONE_WAY" && values.reduceOnly ? true : undefined,
  };

  if (values.tab === "MARKET") {
    return { ...base, type: "MARKET", qty: values.qty };
  }
  if (values.tab === "LIMIT") {
    return { ...base, type: "LIMIT", timeInForce: values.timeInForce, price: values.price, qty: values.qty };
  }

  if (args.triggerPriceFixed === null || args.referencePrice === null) return null;
  const type = conditionalTypeOf(values.side, args.triggerPriceFixed, args.referencePrice, values.conditionalExec);
  return {
    ...base,
    type,
    stopPrice: values.triggerPrice,
    workingType: values.workingType,
    qty: values.qty,
    ...(values.conditionalExec === "LIMIT" ? { price: values.price, timeInForce: values.timeInForce } : {}),
  };
}
