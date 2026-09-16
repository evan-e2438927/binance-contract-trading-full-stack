import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chainEnum } from "./enums";

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
