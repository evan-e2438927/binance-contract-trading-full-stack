import type {
  FillRole,
  LedgerType,
  MarginMode,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionSide,
} from "@/server-api-module/common/types";

/**
 * 枚举 → 中文。交易页和历史记录页都要显示这些，放 `_shared` 一份，别各写各的
 * （两个模块的说法不一样，用户会以为是两种东西）。
 *
 * 服务端返回的**错误原因**不在这里：那是后端给的中文，原样显示，不翻译（M10 通用规则第 3 条）。
 */

/** 订单类型。LIQUIDATION 是系统强平单，用户自己下不出来 */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  LIMIT: "限价",
  MARKET: "市价",
  STOP: "止损限价",
  STOP_MARKET: "止损市价",
  TAKE_PROFIT: "止盈限价",
  TAKE_PROFIT_MARKET: "止盈市价",
  TRAILING_STOP_MARKET: "跟踪委托",
  LIQUIDATION: "强平",
};

/** 订单状态 */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "挂单中",
  PARTIALLY_FILLED: "部分成交",
  FILLED: "已成交",
  CANCELED: "已撤销",
  EXPIRED: "已过期",
  REJECTED: "已拒绝",
};

/** 买卖方向 */
export const SIDE_LABEL: Record<OrderSide, string> = { BUY: "买入", SELL: "卖出" };

/** 持仓方向。单向模式是 BOTH，没有"多/空"的说法，显示成空串 */
export const POSITION_SIDE_LABEL: Record<PositionSide, string> = { LONG: "多头", SHORT: "空头", BOTH: "" };

/** 保证金模式 */
export const MARGIN_MODE_LABEL: Record<MarginMode, string> = { CROSS: "全仓", ISOLATED: "逐仓" };

/** 成交角色：挂单方 / 吃单方 */
export const FILL_ROLE_LABEL: Record<FillRole, string> = { MAKER: "Maker", TAKER: "Taker" };

/** 资金流水的 8 类（packages/shared 的 LEDGER_TYPE，说法照 08 第 5 节 O-03） */
export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  INITIAL: "开户赠送",
  RESET: "账户重置",
  REALIZED_PNL: "已实现盈亏",
  FEE: "手续费",
  FUNDING: "资金费",
  LIQUIDATION: "强平盈亏",
  LIQUIDATION_FEE: "强平清算费",
  MARGIN_TRANSFER: "逐仓保证金划转",
};
