import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import {
  orderSideEnum,
  orderStatusEnum,
  orderTypeEnum,
  positionSideEnum,
  timeInForceEnum,
  workingTypeEnum,
} from "./enums";
import { symbols } from "./symbols";

/**
 * 订单表 —— 用户的委托意图 + 它的状态机，全库写入最频繁的表之一。
 *
 * 一张订单从 NEW 出发，被撮合推进到 PARTIALLY_FILLED / FILLED，或被用户 / 系统推到
 * CANCELED / EXPIRED / REJECTED。`executedQty` 和 `avgPrice` 是 `fills` 的滚动汇总，
 * 冗余在这里是为了让"查我的挂单列表"不用每行再去 join 一次成交明细。
 *
 * 三组值得留意的字段：
 * - **`clientOrderId` 幂等**：前端生成，配唯一索引。网络超时重试同一个值只会真正下单一次。
 * - **触发单三件套**（`stopPrice` / `workingType` / `triggered`）：止盈止损单在触发前不进
 *   撮合，只被价格流盯着；`workingType` 决定盯标记价还是最新成交价，两者在剧烈行情下
 *   能差出很多。
 * - **拟真排队两件套**（`queueAhead` / `queueEstimated`）：我们没有真实订单簿的排队位置，
 *   只能从深度快照推算前方还剩多少量。`queueEstimated` 标记这个数是估出来的（进程重启后
 *   必然是），是"宁可说做不到，不要编数字"的一部分——前端要如实标出来。
 *
 * `orders_open_idx` 是部分索引，只索引 NEW / PARTIALLY_FILLED。撮合循环和引擎重启恢复
 * 都只关心活跃挂单，历史订单再多也不拖慢它们。
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrderId: text("client_order_id").notNull(), // 前端生成的幂等键，重试同一个值不会重复下单
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    side: orderSideEnum("side").notNull(), // BUY/SELL，交易动作方向
    positionSide: positionSideEnum("position_side").notNull(), // 这笔单影响哪个仓位槽（BOTH/LONG/SHORT）
    type: orderTypeEnum("type").notNull(),
    timeInForce: timeInForceEnum("time_in_force").notNull().default("GTC"), // 只对限价单有意义
    price: bigint("price", { mode: "bigint" }), // 委托价，市价单为 null
    stopPrice: bigint("stop_price", { mode: "bigint" }), // 触发单的触发价，非触发单为 null
    workingType: workingTypeEnum("working_type")
      .notNull()
      .default("CONTRACT_PRICE"), // 触发单用什么价格判断触发
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 委托数量
    executedQty: bigint("executed_qty", { mode: "bigint" })
      .notNull()
      .default(sql`0`), // 已成交数量
    avgPrice: bigint("avg_price", { mode: "bigint" }).notNull().default(sql`0`), // 已成交部分的加权平均价
    reduceOnly: boolean("reduce_only").notNull().default(false), // 只减仓：不能开新仓，只能减少现有仓位
    closePosition: boolean("close_position").notNull().default(false), // 一键平仓：不指定数量，直接清空整个仓位
    status: orderStatusEnum("status").notNull().default("NEW"),
    triggered: boolean("triggered").notNull().default(false), // 触发单是否已经被标记价/最新价触发过
    queueAhead: bigint("queue_ahead", { mode: "bigint" }).notNull().default(sql`0`), // 拟真排队：前方还剩多少量没成交
    queueEstimated: boolean("queue_estimated").notNull().default(false), // 排队位置是不是估算出来的（重启后会是）
    frozenMargin: bigint("frozen_margin", { mode: "bigint" })
      .notNull()
      .default(sql`0`), // 这张挂单占用/冻结的保证金
    rejectReason: text("reject_reason"), // 状态是 REJECTED/EXPIRED 时，记录具体是哪条错误码/原因
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 下单幂等：同一账户同一个 clientOrderId 只会真正下单一次
    uniqueIndex("orders_acc_client_uq").on(t.accountId, t.clientOrderId),
    // 部分索引：只索引"活跃"挂单（NEW/PARTIALLY_FILLED）。引擎恢复、撮合时按币对高频捞取，靠它。
    index("orders_open_idx")
      .on(t.symbol, t.status)
      .where(sql`status IN ('NEW','PARTIALLY_FILLED')`),
    // 查一个账户的历史挂单列表（按时间倒序分页）
    index("orders_acc_created_idx").on(t.accountId, t.createdAt.desc()),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
