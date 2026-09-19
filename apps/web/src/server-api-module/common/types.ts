import type {
  AuthProvider,
  Chain,
  FillRole,
  LedgerType,
  MarginMode,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionMode,
  PositionSide,
  TimeInForce,
  WorkingType,
} from "@binance-contract-trading-full-stack/shared";

/**
 * 跨模块共用的类型。
 *
 * 服务端对外 JSON 的约定（04-backend-design.md 第 11 节）：
 * - 数值一律是十进制字符串（`Decimal`），前端不许用 Number 参与计算，要算就 parse() 成 bigint 走 packages/shared
 * - 时间一律是毫秒时间戳（number）
 * - 可能算不出来的数（没有标记价时的未实现盈亏、强平价……）是 null，展示成 "--"
 *
 * 服务端改了形状，各模块的 types.ts 要跟着改（对照 apps/server/src/api/serialize.ts、ws/serialize.ts）。
 */

/** 枚举直接用 packages/shared 的，前后端同一份 */
export type {
  AuthProvider,
  Chain,
  FillRole,
  LedgerType,
  MarginMode,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionMode,
  PositionSide,
  TimeInForce,
  WorkingType,
};

/** 十进制字符串，如 "50000.25"、"-0.001"。展示用 lib/format，计算先 parse() 成 bigint */
export type Decimal = string;

/** 游标分页的响应（apps/server/src/http/pagination.ts），按时间倒序 */
export interface Page<T> {
  /** 这一页的记录 */
  items: T[];
  /** 下一页的游标（这一页最后一条的 id），传回 `cursor` 参数；null = 没有下一页 */
  nextCursor: string | null;
}

/** 游标分页的请求参数 */
export interface PageQuery {
  /** 只看某个币对；不传 = 全部 */
  symbol?: string;
  /** 每页条数，1～100，默认 50 */
  limit?: number;
  /** 上一页响应里的 nextCursor；不传 = 第一页 */
  cursor?: string;
}
