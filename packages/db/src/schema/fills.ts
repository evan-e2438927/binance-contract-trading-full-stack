import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { fillRoleEnum, orderSideEnum, positionSideEnum } from "./enums";
import { orders } from "./orders";

/**
 * 成交明细 —— 只追加，永不更新，是"这笔钱为什么变"的最细粒度证据。
 *
 * 一张订单可以分成很多笔成交：限价单被分批吃掉，市价单逐档吃穿五档就是五条 fill，
 * 每条有自己的成交价。`orders.avgPrice` 就是这些行按 qty 加权出来的。
 *
 * 为什么每笔都要记 `role`：MAKER 和 TAKER 费率不同（Maker 可能还是负的返佣），
 * 同一张限价单可能一部分作为 Maker 成交、一部分因价格穿越作为 Taker 成交，
 * 只在订单层面记一个角色会算错手续费。
 *
 * `realizedPnl` 只在减仓的那几笔上非零：开仓和加仓不产生已实现盈亏，只改开仓均价。
 *
 * 这张表和 `ledger_entries` 的分工：fills 记"交易发生了什么"，ledger 记"钱怎么动的"。
 * 一条 fill 通常对应两条 ledger（一条 FEE，减仓时再加一条 REALIZED_PNL）。
 */
export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    side: orderSideEnum("side").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    price: bigint("price", { mode: "bigint" }).notNull(), // 这一笔的实际成交价（不是订单的委托价）
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 这一笔的成交数量（订单可能分好几笔成交）
    role: fillRoleEnum("role").notNull(), // MAKER/TAKER，决定手续费费率
    fee: bigint("fee", { mode: "bigint" }).notNull(), // 这一笔的手续费，向上取整（mulCeil）
    realizedPnl: bigint("realized_pnl", { mode: "bigint" })
      .notNull()
      .default(sql`0`), // 这一笔带来的已实现盈亏，开仓/加仓为 0
    isLiquidation: boolean("is_liquidation").notNull().default(false), // 这一笔是不是强平引起的
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fills_acc_created_idx").on(t.accountId, t.createdAt.desc()),
    index("fills_order_idx").on(t.orderId),
  ],
);

export type Fill = typeof fills.$inferSelect;
export type NewFill = typeof fills.$inferInsert;
