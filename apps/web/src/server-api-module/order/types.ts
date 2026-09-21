import type {
  Decimal,
  MarginMode,
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
  /** 触发价；非条件单为 null。**跟踪委托也是 null**（币安：这个字段对它无意义） */
  stopPrice: Decimal | null;
  /** 跟踪委托的激活价：最有利价穿过它才开始算回撤。下单没传时是下单那一刻的参照价；其它类型为 null */
  activationPrice: Decimal | null;
  /** 跟踪委托的回调率，**百分数**（"1" = 1%），范围 0.1 ~ 10，和币安 callbackRate 一个口径；其它类型为 null */
  callbackRate: Decimal | null;
  /** 跟踪委托下单以来追到的最有利价（卖单最高、买单最低）。还没收到行情时为 null；其它类型为 null。
   *  ⚠️ 它每跳一次价都在变，但服务端**不推**（缺口 #53）——列表里的值来自最近一次 REST，可能略旧 */
  trackedPrice: Decimal | null;
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
  /** 触发价；条件单需要（跟踪委托不要传） */
  stopPrice?: Decimal;
  /** 跟踪委托的激活价，可选。不传 = 从下单那一刻开始跟 */
  activationPrice?: Decimal;
  /** 跟踪委托的回调率，百分数（"1" = 1%），0.1 ~ 10。跟踪委托必填 */
  callbackRate?: Decimal;
  /** 触发价参照；条件单可选 */
  workingType?: WorkingType;
  /** 数量；closePosition 单不传 */
  qty?: Decimal;
  /** 只减仓 */
  reduceOnly?: boolean;
  /** 触发后全部平仓（只用于 STOP_MARKET / TAKE_PROFIT_MARKET） */
  closePosition?: boolean;
}

/**
 * POST /orders/preview 请求体：还没下单时的预估，只读，不产生订单。
 * 杠杆和保证金模式用账户在这个币对上的当前设置（先调 POST /positions/leverage 改），这里不传。
 */
export interface PreviewOrderBody {
  /** 币对名 */
  symbol: string;
  /** 买 / 卖 */
  side: OrderSide;
  /** 单向模式不传（默认 BOTH）；双向模式传 LONG / SHORT */
  positionSide?: PositionSide;
  /** 委托价；市价类不传，服务端用标记价估 */
  price?: Decimal;
  /** 数量；不传就只要 maxQty */
  qty?: Decimal;
}

/** POST /orders/preview 响应。算不出来的项为 null，原因在 warnings 里 */
export interface OrderPreview {
  symbol: string;
  /** 该币对当前杠杆 */
  leverage: number;
  /** 该币对当前保证金模式 */
  marginMode: MarginMode;
  /** 估算用的价格：限价是委托价，市价是标记价 */
  price: Decimal | null;
  /** 开仓成本 = 起始保证金 + 开仓亏损 + 预留 Taker 手续费，和下单校验用的是同一个函数 */
  cost: Decimal | null;
  /** 可开最大数量（可用余额、分层上限、币对上限取小，已对齐 stepSize） */
  maxQty: Decimal | null;
  /** 这一单成交后的强平价；仓位小到钱包能扛住价格归零时为 null */
  liquidationPrice: Decimal | null;
  /** 某项算不出来的原因，可以原样显示 */
  warnings: string[];
}
