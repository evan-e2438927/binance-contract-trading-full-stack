import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { positionSideEnum } from "./enums";

/**
 * 资金费结算明细 —— 每 8 小时一次，永续合约把价格拉回现货的机制。
 *
 * 永续合约没有交割日，靠资金费维持锚定：费率为正时多头付给空头，为负时反过来。
 * 结算时刻（UTC 00:00 / 08:00 / 16:00）扫描所有活跃仓位，按 `notional × fundingRate`
 * 算出金额，走 `ledger_entries` 的 FUNDING 类型改余额。
 *
 * 这张表是那次结算的**现场快照**：当时的费率、当时的标记价、当时的名义价值都存下来。
 * 不存的话，事后用户问"为什么扣了我 12 块"，只能拿现在的价格去倒推，算不回去。
 *
 * `funding_uq` 唯一索引是防重复结算的最后一道闸：定时器因进程重启而重复触发时，
 * 第二次写入会被唯一约束挡住，不会重复扣钱。写代码时别去 catch 掉它然后忽略——
 * 冲突了说明逻辑有问题，该让它抛出来。
 */
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