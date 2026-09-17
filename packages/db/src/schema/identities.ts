import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { authProviderEnum } from "./enums";

/**
 * 登录身份 —— 把"你是谁"和"你的钱"分开：三种登录方式都收敛成一个 (provider, providerId)，
 * 登录时拿它查这张表找到账户；查不到就新建账户 + 这行身份 + 一条 INITIAL 流水。
 *
 * `(provider, providerId)` 唯一：一个身份只能对应一个账户。**应用层规定每个账户永远只挂一个身份**
 * ——注册时一起创建，不提供"再绑定一个"或"合并账户"。同一个人用 MetaMask 和 Phantom、
 * 或者钱包和邮箱各登录一次，会得到各自独立的账户，这是有意的（`00-overview.md` 跨身份账户合并）。
 * 表结构上是 1:N，只是为了以后真要支持绑定时不用改表。
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: authProviderEnum("provider").notNull(),
    // wallet_evm    → 小写地址
    // wallet_solana → base58 原样
    // email         → 小写邮箱
    // google        → Google 的 sub（用户唯一 id，不用 email，因为 email 可换绑）
    providerId: text("provider_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("identities_provider_uq").on(t.provider, t.providerId),
    index("identities_account_idx").on(t.accountId),
  ],
);

export type Identity = typeof identities.$inferSelect;
export type NewIdentity = typeof identities.$inferInsert;
