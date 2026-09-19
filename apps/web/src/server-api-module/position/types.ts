import type { Decimal, MarginMode, PositionSide } from "../common/types";

/** 仓位模块（/positions/*）的 DTO。来源：apps/server/src/api/positions.ts、api/serialize.ts */

/**
 * 仓位，按币安 positionRisk 表示法（字段口径 2026-09-17 对照币安核对）：
 * 单向模式 positionSide = BOTH、positionAmt 多正空负；双向模式 LONG 为正、SHORT 为负。
 * REST（/account/positions）和 WS `position` 推送同一个形状。
 * 平仓后会推一条 positionAmt = "0" 的，前端据此删掉这一行。
 */
export interface Position {
  /** 币对名 */
  symbol: string;
  /** 单向模式 BOTH；双向模式 LONG / SHORT */
  positionSide: PositionSide;
  /** 持仓数量（基础币种），带符号：多正空负；"0" 表示已平仓 */
  positionAmt: Decimal;
  /** 全仓 / 逐仓 */
  marginMode: MarginMode;
  /** 杠杆倍数 */
  leverage: number;
  /** 开仓均价 */
  entryPrice: Decimal;
  /** 标记价；缺标记价时为 null */
  markPrice: Decimal | null;
  /** 名义价值（按标记价）；缺标记价时为 null */
  notional: Decimal | null;
  /** 未实现盈亏（按标记价）；缺标记价时为 null */
  unrealizedPnl: Decimal | null;
  /** 起始保证金（按标记价 ÷ 杠杆）；缺标记价时为 null */
  initialMargin: Decimal | null;
  /** 维持保证金；缺标记价时为 null */
  maintMargin: Decimal | null;
  /** 逐仓保证金；全仓为 "0" */
  isolatedMargin: Decimal;
  /** 预估强平价；null = 没有强平价，或缺标记价算不出来 */
  liquidationPrice: Decimal | null;
  /** 回报率 = 未实现盈亏 ÷ 按标记价的起始保证金，比例（0.2 = 20%）；缺标记价时为 null */
  roe: Decimal | null;
  /** 开仓时间 */
  openedAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/** POST /positions/leverage 响应 */
export interface SetLeverageResult {
  /** 币对名 */
  symbol: string;
  /** 调整后的杠杆倍数 */
  leverage: number;
  /** 这个杠杆下允许的最大名义价值（USDT） */
  maxNotional: Decimal;
}

/** POST /positions/margin-mode 响应 */
export interface SetMarginModeResult {
  /** 币对名 */
  symbol: string;
  /** 调整后的保证金模式 */
  marginMode: MarginMode;
}

/** POST /positions/isolated-margin 请求体：调整逐仓保证金 */
export interface AdjustIsolatedMarginBody {
  /** 币对名 */
  symbol: string;
  /** 单向模式不传（默认 BOTH）；双向模式必须传 LONG / SHORT */
  positionSide?: PositionSide;
  /** 调整金额（USDT），正数 */
  amount: Decimal;
  /** ADD 追加 · REDUCE 减少 */
  type: "ADD" | "REDUCE";
}
