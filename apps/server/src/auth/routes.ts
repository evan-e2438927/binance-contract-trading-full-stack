import {
  accounts,
  authNonces,
  emailVerificationCodes,
  identities,
  type DbExecutor,
} from "@binance-contract-trading-full-stack/db";
import { AppError, CHAIN, type AuthProvider } from "@binance-contract-trading-full-stack/shared";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AccountRegistrar } from "../engine-host/register-account";
import { ok, parseBody } from "../http/respond";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_INTERVAL_MS,
  EMAIL_CODE_TTL_MS,
  emailCodeMatches,
  generateEmailCode,
  hashEmailCode,
  normalizeEmail,
  type MailSender,
} from "./email";
import type { GoogleOAuth } from "./google";
import { defaultNickname } from "./nickname";
import { signToken, verifyToken } from "./tokens";
import { buildSignInMessage, generateNonce, NONCE_TTL_MS, normalizeAddress, providerOfChain, verifyWalletSignature } from "./wallet";

/**
 * 鉴权路由（04-backend-design.md 第 11 节"认证"）。
 *
 * 三种登录方式只在"怎么证明你拥有这个 providerId"上不同，证明完都走 loginWithIdentity：
 * 查 identities → 查不到就开户（账户 + 身份 + INITIAL 流水一个事务，register-account.ts）→ 签发同一套 JWT。
 */

export interface AuthDeps {
  db: DbExecutor;
  registrar: AccountRegistrar;
  jwtSecret: string;
  /** 前端来源：钱包签名文本的 domain / URI、Google 登录完跳回的地址 */
  webOrigin: string;
  /** null = 这个环境发不了邮件（生产环境没配 Resend），发码接口返回 SERVICE_UNAVAILABLE */
  mailer: MailSender | null;
  /** null = 没配 Google OAuth，/auth/google 跳回前端并带 SERVICE_UNAVAILABLE */
  google: GoogleOAuth | null;
  /** 生产环境 cookie 加 Secure（本地 http 开发不能加，否则浏览器不回传） */
  secureCookies: boolean;
  now?: () => number;
  logger?: Pick<Console, "log" | "error">;
}

export type AuthEnv = { Variables: { accountId: string } };

const GOOGLE_STATE_COOKIE = "google_oauth_state";
const GOOGLE_VERIFIER_COOKIE = "google_code_verifier";
const GOOGLE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const walletNonceSchema = z.object({
  address: z.string({ error: "缺少钱包地址" }).min(1, "缺少钱包地址"),
  chain: z.enum(CHAIN, { error: "chain 只能是 evm 或 solana" }),
});
const walletVerifySchema = walletNonceSchema.extend({
  nonce: z.string({ error: "缺少 nonce" }).min(1, "缺少 nonce"),
  signature: z.string({ error: "缺少签名" }).min(1, "缺少签名"),
});
const emailSchema = z.string({ error: "缺少邮箱" }).trim().pipe(z.email({ error: "邮箱格式不正确" }));
const emailCodeSchema = z.object({ email: emailSchema });
const emailVerifySchema = z.object({
  email: emailSchema,
  code: z.string({ error: "缺少验证码" }).regex(/^\d{6}$/, "验证码是 6 位数字"),
});

/** Authorization: Bearer <jwt> → c.var.accountId。第 13 讲的私有接口都挂这个 */
export function requireAuth(jwtSecret: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    const match = header?.match(/^Bearer (.+)$/);
    if (!match) throw new AppError("UNAUTHORIZED", "请先登录");
    c.set("accountId", await verifyToken(match[1]!, jwtSecret));
    await next();
  };
}

export function createAuthRoutes(deps: AuthDeps) {
  const { db, jwtSecret, webOrigin } = deps;
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? console;

  async function findAccountId(provider: AuthProvider, providerId: string): Promise<string | undefined> {
    const [row] = await db
      .select({ accountId: identities.accountId })
      .from(identities)
      .where(and(eq(identities.provider, provider), eq(identities.providerId, providerId)));
    return row?.accountId;
  }

  /** 三种登录方式的汇合点 */
  async function loginWithIdentity(provider: AuthProvider, providerId: string) {
    let accountId = await findAccountId(provider, providerId);
    let isNew = false;
    if (!accountId) {
      try {
        accountId = await deps.registrar.register({ provider, providerId, nickname: defaultNickname(provider, providerId) });
        isNew = true;
      } catch (error) {
        // 同一个身份并发首次登录：另一个请求先建好了，撞了唯一索引。再查一次就是它
        if (!isUniqueViolation(error, "identities_provider_uq")) throw error;
        accountId = await findAccountId(provider, providerId);
        if (!accountId) throw error;
      }
    }
    await db.update(accounts).set({ lastSeenAt: new Date(now()) }).where(eq(accounts.id, accountId));
    const token = await signToken(accountId, jwtSecret, now());
    return { token, account: { id: accountId, isNew } };
  }

  const routes = new Hono<AuthEnv>();

  // ——— 钱包 ———

  routes.post("/nonce", async (c) => {
    const body = await parseBody(c, walletNonceSchema);
    const address = normalizeAddress(body.chain, body.address);
    if (!address) throw new AppError("INVALID_PARAMS", "钱包地址格式不正确");

    const nonce = generateNonce();
    const issuedAtMs = now();
    const expiresAtMs = issuedAtMs + NONCE_TTL_MS;
    const message = buildSignInMessage({ chain: body.chain, address, nonce, webOrigin, issuedAtMs, expiresAtMs });
    await db.insert(authNonces).values({
      address,
      chain: body.chain,
      nonce,
      message,
      expiresAt: new Date(expiresAtMs),
      createdAt: new Date(issuedAtMs),
    });
    return ok(c, { nonce, message, expiresAt: expiresAtMs });
  });

  routes.post("/verify", async (c) => {
    const body = await parseBody(c, walletVerifySchema);
    const address = normalizeAddress(body.chain, body.address);
    if (!address) throw new AppError("INVALID_PARAMS", "钱包地址格式不正确");

    // 先原子地"领走"这个 nonce，再验签（设计文档是验签后再标记，缺口 #38）：
    // 条件 UPDATE 只有一个请求能成功，两个并发请求拿同一个签名来不会都登录；
    // 签名不对也算用掉了，想再试就重新要 nonce，不能对着同一段文本反复试。
    const nowDate = new Date(now());
    const [claimed] = await db
      .update(authNonces)
      .set({ usedAt: nowDate })
      .where(
        and(
          eq(authNonces.nonce, body.nonce),
          eq(authNonces.chain, body.chain),
          eq(authNonces.address, address),
          isNull(authNonces.usedAt),
          gt(authNonces.expiresAt, nowDate),
        ),
      )
      .returning({ message: authNonces.message });
    if (!claimed) throw new AppError("NONCE_INVALID", "登录请求已失效，请重新发起登录");

    // ★ 验签用库里存的原文，不用客户端传上来的任何文本
    const valid = await verifyWalletSignature(body.chain, address, claimed.message, body.signature);
    if (!valid) throw new AppError("SIGNATURE_INVALID", "签名验证失败，请重新发起登录");

    return ok(c, await loginWithIdentity(providerOfChain(body.chain), address));
  });

  // ——— 邮箱 ———

  routes.post("/email/code", async (c) => {
    const email = normalizeEmail((await parseBody(c, emailCodeSchema)).email);
    const mailer = deps.mailer;
    if (!mailer) throw new AppError("SERVICE_UNAVAILABLE", "邮箱登录暂时不可用");

    const nowMs = now();
    const expiresAtMs = nowMs + EMAIL_CODE_TTL_MS;
    await db.transaction(async (tx) => {
      // 同一邮箱的发码串行：两个并发请求不会都通过 60 秒检查。事务级锁，提交或回滚自动释放
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`email_code:${email}`}))`);
      const [recent] = await tx
        .select({ id: emailVerificationCodes.id })
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.email, email),
            gt(emailVerificationCodes.createdAt, new Date(nowMs - EMAIL_CODE_RESEND_INTERVAL_MS)),
          ),
        )
        .limit(1);
      if (recent) throw new AppError("EMAIL_CODE_RATE_LIMITED", "验证码发送太频繁，请 60 秒后再试");

      const code = generateEmailCode();
      await tx.insert(emailVerificationCodes).values({
        email,
        codeHash: hashEmailCode(code),
        expiresAt: new Date(expiresAtMs),
        createdAt: new Date(nowMs),
      });
      // 发信放在事务里：发失败整条记录回滚，用户马上重试不会被 60 秒限制卡住
      try {
        await mailer.sendLoginCode(email, code);
      } catch (error) {
        logger.error("[auth] 验证码邮件发送失败", error);
        throw new AppError("SERVICE_UNAVAILABLE", "验证码邮件发送失败，请稍后重试");
      }
    });
    return ok(c, { expiresAt: expiresAtMs });
  });

  routes.post("/email/verify", async (c) => {
    const body = await parseBody(c, emailVerifySchema);
    const email = normalizeEmail(body.email);
    const nowDate = new Date(now());

    // 只认这个邮箱最近发的一条：重新发码之后，旧码自动失效
    const [record] = await db
      .select()
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.email, email))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    if (!record) throw new AppError("EMAIL_CODE_INVALID", "验证码不正确");
    if (record.usedAt || record.expiresAt <= nowDate) throw new AppError("EMAIL_CODE_EXPIRED", "验证码已失效，请重新获取");
    if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      throw new AppError("EMAIL_CODE_TOO_MANY_ATTEMPTS", "验证码错误次数过多，请重新获取");
    }

    if (!emailCodeMatches(body.code, record.codeHash)) {
      // attempts + 1 在数据库里做，并发的错误尝试不会互相覆盖
      const [updated] = await db
        .update(emailVerificationCodes)
        .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
        .where(and(eq(emailVerificationCodes.id, record.id), lt(emailVerificationCodes.attempts, EMAIL_CODE_MAX_ATTEMPTS)))
        .returning({ attempts: emailVerificationCodes.attempts });
      if (!updated || updated.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        throw new AppError("EMAIL_CODE_TOO_MANY_ATTEMPTS", "验证码错误次数过多，请重新获取");
      }
      throw new AppError("EMAIL_CODE_INVALID", `验证码不正确，还可以再试 ${EMAIL_CODE_MAX_ATTEMPTS - updated.attempts} 次`);
    }

    // 条件 UPDATE 领走这条记录：并发两个正确请求只有一个能成功
    const [claimed] = await db
      .update(emailVerificationCodes)
      .set({ usedAt: nowDate })
      .where(
        and(
          eq(emailVerificationCodes.id, record.id),
          isNull(emailVerificationCodes.usedAt),
          lt(emailVerificationCodes.attempts, EMAIL_CODE_MAX_ATTEMPTS),
          gt(emailVerificationCodes.expiresAt, nowDate),
        ),
      )
      .returning({ id: emailVerificationCodes.id });
    if (!claimed) throw new AppError("EMAIL_CODE_EXPIRED", "验证码已失效，请重新获取");

    return ok(c, await loginWithIdentity("email", email));
  });

  // ——— Google ———
  // 这两个是浏览器跳转，不是 JSON 接口：出错也是跳回前端，把错误码放在 fragment 里

  const redirectToWeb = (c: Context<AuthEnv>, fragment: Record<string, string>) =>
    c.redirect(`${webOrigin}/login/callback#${new URLSearchParams(fragment).toString()}`, 302);

  routes.get("/google", (c) => {
    if (!deps.google) return redirectToWeb(c, { error: "SERVICE_UNAVAILABLE" });
    const { state, codeVerifier, url } = deps.google.start();
    const cookieOptions = {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "Lax" as const, // 从 Google 跳回来是顶层导航，Lax 会带上 cookie
      path: "/auth/google",
      maxAge: GOOGLE_COOKIE_MAX_AGE_SECONDS,
    };
    setCookie(c, GOOGLE_STATE_COOKIE, state, cookieOptions);
    setCookie(c, GOOGLE_VERIFIER_COOKIE, codeVerifier, cookieOptions);
    return c.redirect(url.toString(), 302);
  });

  routes.get("/google/callback", async (c) => {
    const expectedState = getCookie(c, GOOGLE_STATE_COOKIE);
    const codeVerifier = getCookie(c, GOOGLE_VERIFIER_COOKIE);
    // 一次性：不管成功失败都清掉
    deleteCookie(c, GOOGLE_STATE_COOKIE, { path: "/auth/google" });
    deleteCookie(c, GOOGLE_VERIFIER_COOKIE, { path: "/auth/google" });

    if (!deps.google) return redirectToWeb(c, { error: "SERVICE_UNAVAILABLE" });
    const state = c.req.query("state");
    if (!state || !expectedState || !codeVerifier || state !== expectedState) {
      return redirectToWeb(c, { error: "OAUTH_STATE_MISMATCH" });
    }
    const code = c.req.query("code");
    if (!code) return redirectToWeb(c, { error: "UNAUTHORIZED" }); // 用户在 Google 页面点了取消

    let sub: string;
    try {
      sub = await deps.google.exchange(code, codeVerifier);
    } catch (error) {
      logger.error("[auth] Google code 换 token 失败", error);
      return redirectToWeb(c, { error: "UNAUTHORIZED" });
    }
    try {
      const result = await loginWithIdentity("google", sub);
      // ★ token 放 fragment（#）不放 query：fragment 不发给服务端、不进访问日志、不进 Referer
      return redirectToWeb(c, { token: result.token, isNew: result.account.isNew ? "1" : "0" });
    } catch (error) {
      logger.error("[auth] Google 登录开户失败", error);
      return redirectToWeb(c, { error: "INTERNAL_ERROR" });
    }
  });

  // ——— 通用 ———

  routes.get("/me", requireAuth(jwtSecret), async (c) => {
    const accountId = c.var.accountId;
    const [row] = await db
      .select({
        id: accounts.id,
        nickname: accounts.nickname,
        createdAt: accounts.createdAt,
        provider: identities.provider,
        providerId: identities.providerId,
      })
      .from(accounts)
      .innerJoin(identities, eq(identities.accountId, accounts.id))
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!row) throw new AppError("UNAUTHORIZED", "账户不存在，请重新登录");
    return ok(c, {
      account: { id: row.id, nickname: row.nickname, createdAt: row.createdAt.getTime() },
      identity: { provider: row.provider, providerId: row.providerId },
    });
  });

  return routes;
}

/** Postgres 23505 唯一约束冲突。drizzle 会把驱动错误包在 cause 里，一层层往下找 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === "23505" && e.constraint === constraint) return true;
    current = e.cause;
  }
  return false;
}
