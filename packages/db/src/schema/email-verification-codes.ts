import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 邮箱登录的一次性验证码 —— 和 `auth_nonces` 同一个模式：一次性、有效期、用过即废。
 *
 * 区别是这里**只存哈希**：验证码只有 6 位数字，泄库后被暴力撞出来的风险远高于钱包签名 nonce，
 * 存 sha256 之后即使数据库被拖也不能直接拿去登录。明文只通过邮件发出，不落库、不回响应体。
 *
 * 防枚举：`attempts` 到 5 次这条记录直接作废。防刷：同一邮箱 60 秒内不能重复请求发码。
 * 这张表是可清理的：过期记录定期删掉不影响任何业务。
 */
export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(), // 小写邮箱，和 identities.provider_id 同一种规范化
    codeHash: text("code_hash").notNull(), // sha256(6 位验证码)，不存明文
    attempts: integer("attempts").notNull().default(0), // 输错次数，到 5 次作废
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 有效期 5 分钟
    usedAt: timestamp("used_at", { withTimezone: true }), // 非空说明已经验证成功用过一次
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    index("email_codes_expires_idx").on(t.expiresAt),
  ],
);

export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type NewEmailVerificationCode = typeof emailVerificationCodes.$inferInsert;
