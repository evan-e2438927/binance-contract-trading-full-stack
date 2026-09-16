import { sql } from "drizzle-orm";
import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chainEnum, positionModeEnum } from "./enums";

/**
 * 账户表 —— 一个钱包地址一个账户，钱包余额的落点。
 *
 * 本项目不接币安 API Key，USDT 由我们自己发放：新账户开户时发 10,000 USDT，写一条
 * `INITIAL` 流水。账户重置也不是直接改 `walletBalance`，而是走正常平仓流程再补一条
 * `RESET` 流水（见 `02-architecture.md` 第九节），为的是守住那条不变式：
 *
 *     accounts.wallet_balance === SUM(ledger_entries.amount)
 *
 * 唯一键是 (chain, address) 而不是 address：同一串十六进制在 EVM 和别的链上是两个人。
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // EVM 统一小写；Solana 保持 base58 原样。
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    // 已结算的钱包余额，是 accounts.wallet_balance === SUM(ledger_entries.amount) 这条
    // 不变式里的左边——任何资金变动都必须同步改这个字段并写一条 ledger_entries。
    walletBalance: bigint("wallet_balance", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    positionMode: positionModeEnum("position_mode")
      .notNull()
      .default("ONE_WAY"),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }), // 上次账户重置的时间，null 表示没重置过
    // 排行榜显示名，默认脱敏地址。
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(), // 最近一次活跃时间
  },
  (t) => [uniqueIndex("accounts_chain_address_uq").on(t.chain, t.address)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
