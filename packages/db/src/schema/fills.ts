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
      .default(0n), // 这一笔带来的已实现盈亏，开仓/加仓为 0
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
