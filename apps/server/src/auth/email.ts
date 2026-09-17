import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * 邮箱验证码的纯函数和发信（04-backend-design.md 第 11 节"邮箱验证码"）。
 * 数据库读写（email_verification_codes）在 routes.ts。
 */

export const EMAIL_CODE_TTL_MS = 5 * 60_000;
export const EMAIL_CODE_RESEND_INTERVAL_MS = 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/** 去空格、转小写。identities.provider_id 和 email_verification_codes.email 用的都是这个形式 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 6 位数字，前导 0 保留。用 crypto.randomInt，不用 Math.random */
export function generateEmailCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** sha256 十六进制。库里只存这个，明文只出现在邮件里 */
export function hashEmailCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** 常量时间比较，避免按"前几位对了多快返回"去猜 */
export function emailCodeMatches(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashEmailCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MailSender {
  sendLoginCode(to: string, code: string): Promise<void>;
}

/**
 * Resend 发信：POST https://api.resend.com/emails，Bearer 鉴权，body 至少 from / to / subject / text 或 html
 * （2026-09-17 对照 resend.com/docs/api-reference/emails/send-email）。
 * 就一个请求，不引 SDK。from 的域名要先在 Resend 后台验证过。
 */
export function createResendSender(options: { apiKey: string; from: string; fetch?: typeof fetch }): MailSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async sendLoginCode(to, code) {
      const minutes = EMAIL_CODE_TTL_MS / 60_000;
      const response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: options.from,
          to: [to],
          subject: `登录验证码 ${code}`,
          text: `你的登录验证码是 ${code}，${minutes} 分钟内有效。\n\n如果不是你本人操作，忽略这封邮件即可。`,
        }),
      });
      if (!response.ok) {
        // 响应体里可能有 Resend 的错误说明，只进服务端日志，不回给前端
        throw new Error(`Resend 发信失败：HTTP ${response.status} ${await response.text().catch(() => "")}`);
      }
    },
  };
}

/**
 * 本地开发没配 RESEND_API_KEY 时用：验证码打到服务端日志里。
 * **只在 NODE_ENV=development 启用**（index.ts 决定）；生产环境没配就直接返回 SERVICE_UNAVAILABLE，
 * 不假装发出去了。
 */
export function createConsoleSender(logger: Pick<Console, "log"> = console): MailSender {
  return {
    async sendLoginCode(to, code) {
      logger.log(`[auth] ⚠️ 开发模式未配置 RESEND_API_KEY，验证码不发邮件：${to} → ${code}`);
    },
  };
}
