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
