import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chainEnum } from "./enums";

/**
 * 钱包登录的一次性挑战值 —— 证明"你确实持有这个地址的私钥"。
 *
 * 流程：前端报地址 → 服务端生成 nonce、拼成 message 存这里 → 用户用钱包签名 →
 * 服务端拿**这张表里存的 message 原文**验签，验过就发 JWT。
 *
 * 两道防重放：`expiresAt` 卡 5 分钟有效期，`usedAt` 用过一次就不能再用。
 * 之所以要存完整 message 而不是只存 nonce，是因为验签必须用服务端认定的原文——
 * 拿客户端回传的 message 去验，等于让攻击者自己决定签的是什么。
 *
 * 这张表是可清理的：过期记录定期删掉不影响任何业务。
 */
export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    nonce: text("nonce").notNull(), // 随机挑战值，拼进 message 里让用户签名，防重放攻击
    message: text("message").notNull(), // 完整待签名原文，验签必须用这份服务端存的原文
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 有效期 5 分钟
    usedAt: timestamp("used_at", { withTimezone: true }), // 非空说明已经验签成功用过一次，防止重放
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("nonces_addr_idx").on(t.chain, t.address),
    index("nonces_expires_idx").on(t.expiresAt),
  ],
);

export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
