import type {
  Decimal,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionSide,
  TimeInForce,
  WorkingType,
} from "../common/types";

/**
 * 订单模块（/orders）的 DTO。来源：apps/server/src/api/orders.ts、api/serialize.ts。
 * 当前挂单、历史委托的查询在 account 模块（路径是 /account/orders），但形状都是这里的 Order。
 */

/**
 * 订单。REST（挂单 / 历史委托 / 下单撤单的返回）和 WS `order` 推送同一个形状。
 * 挂单来自引擎（排队位置实时），历史委托来自数据库。
 */
export interface Order {
  /** 订单 id（uuid） */
  id: string;
  /** 客户端订单 id；下单时没传由服务端生成（web_ 开头） */
  clientOrderId: string;
  /** 币对名 */
  symbol: string;
  /** 买 / 卖 */
  side: OrderSide;
  /** 单向模式为 BOTH；双向模式 LONG / SHORT */
  positionSide: PositionSide;
  /** 订单类型；LIQUIDATION 是系统强平单 */
  type: OrderType;
  /** 有效方式，只对限价单有意义（服务端对其他类型也会给默认值 GTC，别拿它判断单子类型） */
  timeInForce: TimeInForce | null;
  /** 委托价；市价单为 null */
  price: Decimal | null;
  /** 触发价；非条件单为 null */
  stopPrice: Decimal | null;
  /** 触发价参照：标记价 / 最新价，只对条件单有意义 */
  workingType: WorkingType | null;
  /** 委托数量；closePosition 单为 0（触发那一刻按仓位现算） */
  qty: Decimal;
  /** 已成交数量 */
  executedQty: Decimal;
  /** 成交均价；还没成交时为 "0" */
  avgPrice: Decimal;
  /** 只减仓 */
  reduceOnly: boolean;
  /** 触发后全部平仓（条件单） */
  closePosition: boolean;
  /** 订单状态 */
  status: OrderStatus;
  /** 条件单是否已被触发 */
  triggered: boolean;
  /** 前方排队量（基础币种）——这个模拟盘的招牌列，限价单在同价位前面还排着多少 */
  queueAhead: Decimal;
  /** true = 该价位超出可见 20 档，queueAhead 是估算值，展示时加 "≈" */
  queueEstimated: boolean;
  /** 这张挂单冻结的保证金（含 Taker 手续费预留） */
  frozenMargin: Decimal;
  /** 过期 / 拒绝的原因；其他状态为 null */
  rejectReason: string | null;
  /** 下单时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/**
 * POST /orders 请求体。参数规则照币安 New Order（07-binance-reference.md 第 2 节）；
 * 组合是否合法由服务端校验，不认识的参数直接拒。
 */
export interface PlaceOrderBody {
  /** 客户端订单 id，1～36 位字母、数字或 . : / _ -。幂等：同一个 id 重复提交，返回已存在的那张单 */
  clientOrderId?: string;
  /** 币对名 */
  symbol: string;
  /** 买 / 卖 */
  side: OrderSide;
  /** 单向模式不传（默认 BOTH）；双向模式必须传 LONG / SHORT */
  positionSide?: PositionSide;
  /** 订单类型；LIQUIDATION 只有系统能下 */
  type: Exclude<OrderType, "LIQUIDATION">;
  /** 有效方式；限价单需要 */
  timeInForce?: TimeInForce;
  /** 委托价；限价类需要 */
  price?: Decimal;
  /** 触发价；条件单需要 */
  stopPrice?: Decimal;
  /** 触发价参照；条件单可选 */
  workingType?: WorkingType;
  /** 数量；closePosition 单不传 */
  qty?: Decimal;
  /** 只减仓 */
  reduceOnly?: boolean;
  /** 触发后全部平仓（只用于 STOP_MARKET / TAKE_PROFIT_MARKET） */
  closePosition?: boolean;
}
