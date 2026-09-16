import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { positionSideEnum } from "./enums";

export const fundingPayments = pgTable(
  "funding_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    fundingRate: bigint("funding_rate", { mode: "bigint" }).notNull(), // 结算时使用的资金费率
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(), // 结算时使用的标记价
    notional: bigint("notional", { mode: "bigint" }).notNull(), // 结算时仓位的名义价值（= markPrice × qty）
    amount: bigint("amount", { mode: "bigint" }).notNull(), // 有符号：多头付给空头（或反之）时，付出方为负
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(), // 结算时间，每 8 小时一次
  },
  (t) => [
    index("funding_acc_settled_idx").on(t.accountId, t.settledAt.desc()),
    // 防重复结算：定时器因重启而重复触发时，唯一约束挡住第二次写入
    uniqueIndex("funding_uq").on(t.accountId, t.symbol, t.positionSide, t.settledAt),
  ],
);

export type FundingPayment = typeof fundingPayments.$inferSelect;
export type NewFundingPayment = typeof fundingPayments.$inferInsert;