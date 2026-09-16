import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { ledgerTypeEnum } from "./enums";

/**
 * 资金流水 —— ★ 账目的唯一真相。只追加，永不更新，永不删除。
 *
 * 这条不变式是整个项目最硬的一条：
 *
 *     accounts.wallet_balance === SUM(ledger_entries.amount)
 *
 * `accounts.wallet_balance` 只是为了避免每次读余额都做一次全表 SUM 而存的缓存值；
 * 真正说了算的是这张表。`reconcile:ledger` 脚本就是拿两边对账，对不上说明某处改了余额
 * 没写流水——那是本项目最危险的一类 bug，宁可脚本报错停下，也不要让它悄悄漂移。
 *
 * 所以：**任何资金变动都必须在同一个事务里改 `accounts.wallet_balance` 并写一条这里的行**。
 * 账户重置也不例外（走平仓 + RESET 流水，而不是直接把余额设回 10,000）。
 *
 * 字段约定：
 * - `amount` 有符号，收入为正、支出为负，所以 SUM 出来就是余额，不用按 type 分情况加减。
 * - `balanceAfter` 是这笔发生后的余额快照。冗余存它，流水页才能直接展示"当时余额"，
 *   而不用从头累加；对账时也能二分定位是哪一笔开始错的。
 * - `refType` + `refId` 指回具体的 fill / funding_payment / liquidation，
 *   用户问"这 4.99 是哪来的"能一路查到那笔成交。
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: ledgerTypeEnum("type").notNull(), // 这笔钱属于 LEDGER_TYPE 8 类中的哪一类
    symbol: text("symbol"), // 和某个币对相关的流水（如手续费/资金费）才填，INITIAL/RESET 这类为 null
    amount: bigint("amount", { mode: "bigint" }).notNull(), // 有符号：收入为正，支出为负
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(), // 这笔发生后的余额快照，查流水页不用累加
    refType: text("ref_type"), // 关联的业务对象类型，如 'fill'/'funding'/'liquidation'
    refId: uuid("ref_id"), // 关联的业务对象 id，配合 refType 能查到这笔钱具体是哪次成交/结算引起的
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_acc_created_idx").on(t.accountId, t.createdAt.desc()), // 流水分页查询
    index("ledger_acc_type_idx").on(t.accountId, t.type), // 按类型筛选流水（比如只看手续费）
  ],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
