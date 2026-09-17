export const ERROR_CODES = [
  // 认证
  "UNAUTHORIZED", // 缺 token 或 token 无效
  "TOKEN_EXPIRED", // token 过期，需要重新签名登录
  "NONCE_INVALID", // 登录用的 nonce 不存在、已过期或已用过一次
  "SIGNATURE_INVALID", // 钱包签名验证失败

  // 下单校验链（严格按顺序执行，见 04-backend-design.md 第 6 节，前一步没过不会走到后一步）
  "SYMBOL_NOT_TRADING", // 第 1 步：币对不存在，或未开放交易
  "MARKET_NOT_READY", // 第 2 步：行情还没就绪（没有盘口/标记价），暂不接受下单
  "INVALID_PARAMS", // 第 3 步：订单类型/TIF/价格/触发价的参数组合不合法
  "POSITION_SIDE_MISMATCH", // 第 4 步：positionSide 和当前持仓模式（单向/双向）对不上
  "PRICE_FILTER", // 第 5 步：委托价不是 tickSize 的整数倍
  "LOT_SIZE", // 第 5 步：委托数量不是 stepSize 的整数倍
  "MIN_NOTIONAL", // 第 6 步：数量或名义价值低于该币对的最小下单门槛
  "PERCENT_PRICE", // 第 7 步：委托价偏离标记价超过 ±5%（防止用天价/地板价试探系统）
  "REDUCE_ONLY_REJECTED", // 第 8 步：只减仓单没有对应仓位，或数量超过了仓位剩余
  "LEVERAGE_TOO_HIGH", // 第 9 步：成交后名义价值所在的杠杆分层，不允许当前设置的杠杆倍数
  "INSUFFICIENT_MARGIN", // 第 10 步：可用余额不够支付起始保证金 + 预留的吃单手续费
  "MARKET_ORDER_TOO_LARGE", // 第 11 步：市价单数量超过了对手盘可见深度的一半
  "POST_ONLY_REJECTED", // 第 12 步：GTX（只做 Maker）单如果下去会立刻吃单成交，直接拒
  "TOO_MANY_ORDERS", // 第 13 步：该账户当前挂单数已经到了 200 张的上限
  "WOULD_IMMEDIATELY_TRIGGER", // 第 14 步：触发单的触发价在下单时就已经被穿过（币安 -2021，第 09 讲）

  // 仓位与账户
  "ORDER_NOT_FOUND", // 撤单时订单不存在，或已经是终态
  "POSITION_NOT_FOUND", // 平仓/加减保证金时找不到对应仓位
  "MARGIN_MODE_LOCKED", // 该币对还有持仓或挂单，不能切换全仓/逐仓
  "POSITION_MODE_LOCKED", // 账户还有任何持仓或挂单，不能切换单向/双向持仓模式
  "RESET_COOLING_DOWN", // 账户重置有冷却时间，冷却期内不能再次重置
  "MARGIN_WOULD_LIQUIDATE", // 逐仓减保证金后会让保证金率立刻 ≥ 100%（相当于自己把自己强平），不允许

  // 系统
  "RATE_LIMITED", // 触发限流
  "INTERNAL_ERROR", // 服务端内部错误，兜底用
  "SERVICE_UNAVAILABLE", // 引擎还没就绪（启动中，或行情断连导致暂停撮合）
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  NONCE_INVALID: 400,
  SIGNATURE_INVALID: 400,
  SYMBOL_NOT_TRADING: 400,
  MARKET_NOT_READY: 503,
  INVALID_PARAMS: 400,
  POSITION_SIDE_MISMATCH: 400,
  PRICE_FILTER: 400,
  LOT_SIZE: 400,
  MIN_NOTIONAL: 400,
  PERCENT_PRICE: 400,
  REDUCE_ONLY_REJECTED: 400,
  LEVERAGE_TOO_HIGH: 400,
  INSUFFICIENT_MARGIN: 400,
  MARKET_ORDER_TOO_LARGE: 400,
  POST_ONLY_REJECTED: 400,
  TOO_MANY_ORDERS: 429,
  WOULD_IMMEDIATELY_TRIGGER: 400,
  ORDER_NOT_FOUND: 404,
  POSITION_NOT_FOUND: 404,
  MARGIN_MODE_LOCKED: 409,
  POSITION_MODE_LOCKED: 409,
  RESET_COOLING_DOWN: 409,
  MARGIN_WOULD_LIQUIDATE: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** 服务端 ↔ 前端统一错误信封 { ok:false, error:{code,message} } 里的 error。message 是给用户直接看的中文。 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}
