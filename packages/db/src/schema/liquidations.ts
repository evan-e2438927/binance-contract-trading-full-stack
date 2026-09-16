import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum, positionSideEnum } from "./enums";

export const liquidations = pgTable(
  "liquidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    marginMode: marginModeEnum("margin_mode").notNull(), // 被强平时这个仓位是全仓还是逐仓
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 被强平的数量
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull(), // 被强平仓位的开仓均价
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(), // 触发强平那一刻的标记价，强平按这个价格平仓
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(), // 强平这笔带来的已实现盈亏（通常是负的）
    liquidationFee: bigint("liquidation_fee", { mode: "bigint" }).notNull(), // 强平清算费，比普通手续费高
    // 下面两个是取证字段：用户质疑"我不该被强平"时，把这两个数摆出来就能说清楚，别省。
    marginBalanceBefore: bigint("margin_balance_before", { mode: "bigint" }).notNull(), // 强平前一刻的保证金余额
    maintMarginAt: bigint("maint_margin_at", { mode: "bigint" }).notNull(), // 强平前一刻算出的维持保证金要求
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("liq_acc_created_idx").on(t.accountId, t.createdAt.desc())],
);

export type Liquidation = typeof liquidations.$inferSelect;
export type NewLiquidation = typeof liquidations.$inferInsert;