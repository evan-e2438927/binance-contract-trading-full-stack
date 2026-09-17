import { sql } from "drizzle-orm";
import {
  bigint,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { positionModeEnum } from "./enums";

/**
 * 账户表 —— 钱包余额的落点，只管交易相关的状态（余额、持仓模式、昵称）。
 *
 * 本项目不在币安下任何真实订单，USDT 由我们自己发放：新账户开户时发 10,000 USDT，写一条
 * `INITIAL` 流水。账户重置也不是直接改 `walletBalance`，而是走正常平仓流程再补一条
 * `RESET` 流水（见 `02-architecture.md` 第九节），为的是守住那条不变式：
 *
 *     accounts.wallet_balance === SUM(ledger_entries.amount)
 *
 * 这张表**不记录任何登录方式**：钱包地址 / 邮箱 / Google 都在 `identities` 表里，
 * 以后再加一种登录方式不用碰这张核心表，也不用给它加可空列。
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 已结算的钱包余额，是 accounts.wallet_balance === SUM(ledger_entries.amount) 这条
    // 不变式里的左边——任何资金变动都必须同步改这个字段并写一条 ledger_entries。
    walletBalance: bigint("wallet_balance", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    positionMode: positionModeEnum("position_mode")
      .notNull()
      .default("ONE_WAY"),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }), // 上次账户重置的时间，null 表示没重置过
    // 排行榜显示名，默认脱敏地址 / 邮箱。
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(), // 最近一次活跃时间
  },
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
