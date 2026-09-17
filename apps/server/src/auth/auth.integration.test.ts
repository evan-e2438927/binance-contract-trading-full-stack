import "varlock/auto-load";
import {
  accounts,
  authNonces,
  createDb,
  emailVerificationCodes,
  identities,
  ledgerEntries,
  type DbExecutor,
} from "@binance-contract-trading-full-stack/db";
import { createEngine, type Engine } from "@binance-contract-trading-full-stack/engine";
import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import bs58 from "bs58";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import nacl from "tweetnacl";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { createEngineHost } from "../engine-host/engine-host";
import { createAccountRegistrar } from "../engine-host/register-account";
import { createErrorHandler } from "../http/respond";
import { loadEngineConfig, loadEngineSnapshot } from "../persistence/load";
import { persistEvents } from "../persistence/persist";
import type { MailSender } from "./email";
import type { GoogleOAuth } from "./google";
import { createAuthRoutes } from "./routes";

/**
 * 第 12 讲验收：三种方式都能登录并拿到 10,000 USDT；三种身份互相独立不合并。
 *
 * 真数据库（整个用例包在最终回滚的事务里，和第 11 讲集成测试同一个做法）+ 真引擎 + 真宿主 + 真签名；
 * 只有发邮件和 Google 换 token 是假的（一个记下验证码，一个直接返回 sub）。
 */

const db = createDb({ DATABASE_URL: process.env.DATABASE_URL! });
afterAll(async () => {
  await db.$client.end();
});

class Rollback extends Error {}
async function inRollback(fn: (tx: DbExecutor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const JWT_SECRET = "integration-test-secret-0123456789abcdef";
const WEB = "http://localhost:3001";
const quiet = { log: () => {}, error: () => {} };

async function setup(tx: DbExecutor) {
  const engine: Engine = createEngine(await loadEngineConfig(tx), await loadEngineSnapshot(tx));
  const modes = new Map<string, PositionMode>();
  let clock = Date.now();
  const now = () => clock;
  const registrar = createAccountRegistrar({ submit: (input) => host.submit(input), now });
  const host = createEngineHost({
    engine,
    isSymbolReady: () => true,
    logger: quiet,
    persist: (events) =>
      persistEvents(tx, events, { positionModeOf: (id) => modes.get(id)!, pendingRegistrationOf: registrar.pendingRegistrationOf }),
    onCommitted(input) {
      if (input.t === "registerAccount") modes.set(input.accountId, input.positionMode);
    },
  });

  const sentCodes = new Map<string, string>();
  const mailer: MailSender = {
    async sendLoginCode(to, code) {
      sentCodes.set(to, code);
    },
  };
  const google: GoogleOAuth = {
    start: () => ({ state: "state-1", codeVerifier: "verifier-1", url: new URL("https://accounts.google.com/o/oauth2/v2/auth?state=state-1") }),
    exchange: async (code) => `google-sub-${code}`,
  };

  const app = new Hono();
  app.onError(createErrorHandler(quiet));
  app.route("/auth", createAuthRoutes({ db: tx, registrar, jwtSecret: JWT_SECRET, webOrigin: WEB, mailer, google, secureCookies: false, now, logger: quiet }));

  const post = async (path: string, body: unknown) => {
    const res = await app.request(`/auth${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    return { status: res.status, json: (await res.json()) as any };
  };
  return {
    engine,
    app,
    post,
    sentCodes,
    advance: (ms: number) => (clock += ms),
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function evmLogin(ctx: Ctx, privateKey: `0x${string}`) {
  const signer = privateKeyToAccount(privateKey);
  const nonce = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
  expect(nonce.status).toBe(200);
  const signature = await signer.signMessage({ message: nonce.json.data.message });
  return ctx.post("/verify", { address: signer.address, chain: "evm", nonce: nonce.json.data.nonce, signature });
}

async function solanaLogin(ctx: Ctx, keys: nacl.SignKeyPair) {
  const address = bs58.encode(keys.publicKey);
  const nonce = await ctx.post("/nonce", { address, chain: "solana" });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.json.data.message), keys.secretKey));
  return ctx.post("/verify", { address, chain: "solana", nonce: nonce.json.data.nonce, signature });
}

async function emailLogin(ctx: Ctx, email: string) {
  const sent = await ctx.post("/email/code", { email });
  expect(sent.status).toBe(200);
  return ctx.post("/email/verify", { email, code: ctx.sentCodes.get(email.trim().toLowerCase()) });
}

async function googleLogin(ctx: Ctx, code: string) {
  const start = await ctx.app.request("/auth/google");
  expect(start.status).toBe(302);
  const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const callback = await ctx.app.request(`/auth/google/callback?code=${code}&state=state-1`, { headers: { Cookie: cookies } });
  expect(callback.status).toBe(302);
  return new URLSearchParams(new URL(callback.headers.get("Location")!).hash.slice(1));
}

async function walletOf(tx: DbExecutor, accountId: string) {
  const [row] = await tx.select({ wallet: accounts.walletBalance }).from(accounts).where(eq(accounts.id, accountId));
  const ledger = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, accountId));
  return { wallet: row?.wallet, ledger: ledger.map((l) => [l.type, l.amount, l.balanceAfter]) };
}

describe("鉴权（第 12 讲验收，真数据库）", () => {
  it("★ 钱包 EVM / 钱包 Solana / 邮箱 / Google 四种身份都能登录，各得一个 10,000 USDT 的独立账户；再次登录回到同一个账户", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const evmKey = generatePrivateKey();
      const solKeys = nacl.sign.keyPair();

      const evm = await evmLogin(ctx, evmKey);
      const sol = await solanaLogin(ctx, solKeys);
      const mail = await emailLogin(ctx, "  Alice.Test@Example.com ");
      const goog = await googleLogin(ctx, "abc");

      expect(evm.status).toBe(200);
      expect(sol.status).toBe(200);
      expect(mail.status).toBe(200);
      expect(goog.get("error")).toBeNull();
      expect(goog.get("isNew")).toBe("1");

      const googleMe = await ctx.app.request("/auth/me", { headers: { Authorization: `Bearer ${goog.get("token")}` } });
      const googleAccountId = ((await googleMe.json()) as any).data.account.id as string;
      const ids = [evm.json.data.account.id, sol.json.data.account.id, mail.json.data.account.id, googleAccountId];
      expect(new Set(ids).size).toBe(4); // 互相独立，不合并
      for (const r of [evm, sol, mail]) expect(r.json.data.account.isNew).toBe(true);

      // 每个账户：库里 10,000，正好一条 INITIAL 流水，引擎内存里也是 10,000
      for (const id of ids) {
        expect(await walletOf(tx, id)).toEqual({ wallet: parse("10000"), ledger: [["INITIAL", parse("10000"), parse("10000")]] });
        expect(ctx.engine.snapshot().accounts.find((a) => a.id === id)?.walletBalance).toBe(parse("10000"));
      }

      // 身份按规范化形式存：EVM 小写地址、邮箱小写、Google sub
      const rows = await tx.select().from(identities).where(inArray(identities.accountId, ids));
      expect(rows.map((r) => [r.provider, r.providerId]).sort()).toEqual(
        [
          ["email", "alice.test@example.com"],
          ["google", "google-sub-abc"],
          ["wallet_evm", privateKeyToAccount(evmKey).address.toLowerCase()],
          ["wallet_solana", bs58.encode(solKeys.publicKey)],
        ].sort(),
      );

      // 再登录一次：同一个账户，isNew = false，不再发钱
      ctx.advance(61_000); // 过了邮箱 60 秒发码间隔
      const evmAgain = await evmLogin(ctx, evmKey);
      const mailAgain = await emailLogin(ctx, "alice.test@example.com");
      const googAgain = await googleLogin(ctx, "abc");
      expect(evmAgain.json.data.account).toEqual({ id: ids[0], isNew: false });
      expect(mailAgain.json.data.account).toEqual({ id: ids[2], isNew: false });
      expect(googAgain.get("isNew")).toBe("0");
      expect((await walletOf(tx, ids[0])).ledger).toHaveLength(1);

      // /auth/me：三种登录方式签发的是同一种 token
      const me = await ctx.app.request("/auth/me", { headers: { Authorization: `Bearer ${mail.json.data.token}` } });
      expect(((await me.json()) as any).data).toMatchObject({
        account: { id: ids[2], nickname: "al***@example.com" },
        identity: { provider: "email", providerId: "alice.test@example.com" },
      });
    });
  });

  it("同一个身份并发首次登录：只建一个账户、只发一次钱，两个请求都拿到这个账户", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const accountsBefore = ctx.engine.snapshot().accounts.length;
      const key = generatePrivateKey();
      const signer = privateKeyToAccount(key);
      const n1 = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
      const n2 = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
      const verify = async (n: typeof n1) =>
        ctx.post("/verify", { address: signer.address, chain: "evm", nonce: n.json.data.nonce, signature: await signer.signMessage({ message: n.json.data.message }) });

      const [r1, r2] = await Promise.all([verify(n1), verify(n2)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(r1.json.data.account.id).toBe(r2.json.data.account.id);
      expect([r1.json.data.account.isNew, r2.json.data.account.isNew].sort()).toEqual([false, true]);

      const rows = await tx.select().from(identities).where(eq(identities.providerId, signer.address.toLowerCase()));
      expect(rows).toHaveLength(1);
      expect((await walletOf(tx, r1.json.data.account.id)).ledger).toHaveLength(1);
      // 撞唯一索引的那次注册：库里没有留下半截账户，引擎也回滚掉了
      const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.account_id = a.id)`)).rows as [{ count: number }];
      expect(count).toBe(0);
      expect(ctx.engine.snapshot().accounts.length).toBe(accountsBefore + 1);
    });
  });

  it("钱包：nonce 只能用一次、过期作废、签名不对也会用掉；验签只认库里的原文", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const signer = privateKeyToAccount(generatePrivateKey());
      const n = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
      const { nonce, message } = n.json.data;
      expect(message).toContain(`Nonce: ${nonce}`);
      expect(message).toContain("localhost:3001 wants you to sign in with your Ethereum account:");

      // 用另一段自己构造的文本签名：服务端验的是库里的原文，不过
      const forged = await ctx.post("/verify", { address: signer.address, chain: "evm", nonce, signature: await signer.signMessage({ message: "whatever" }) });
      expect(forged.json.error.code).toBe("SIGNATURE_INVALID");
      // 失败也用掉了
      const retry = await ctx.post("/verify", { address: signer.address, chain: "evm", nonce, signature: await signer.signMessage({ message }) });
      expect(retry.json.error.code).toBe("NONCE_INVALID");
      const [row] = await tx.select().from(authNonces).where(eq(authNonces.nonce, nonce));
      expect(row!.usedAt).not.toBeNull();

      // 过期
      const n2 = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
      ctx.advance(5 * 60_000);
      const late = await ctx.post("/verify", { address: signer.address, chain: "evm", nonce: n2.json.data.nonce, signature: await signer.signMessage({ message: n2.json.data.message }) });
      expect(late.status).toBe(400);
      expect(late.json.error.code).toBe("NONCE_INVALID");

      // 别人的地址拿我的 nonce
      const n3 = await ctx.post("/nonce", { address: signer.address, chain: "evm" });
      const other = privateKeyToAccount(generatePrivateKey());
      const stolen = await ctx.post("/verify", { address: other.address, chain: "evm", nonce: n3.json.data.nonce, signature: await other.signMessage({ message: n3.json.data.message }) });
      expect(stolen.json.error.code).toBe("NONCE_INVALID");

      const bad = await ctx.post("/nonce", { address: "0x1234", chain: "evm" });
      expect(bad).toMatchObject({ status: 400, json: { ok: false, error: { code: "INVALID_PARAMS" } } });
    });
  });

  it("邮箱：60 秒内不能重发；错 5 次作废；过期；重发后旧码失效；库里不存明文", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const email = "bob@example.com";
      expect((await ctx.post("/email/code", { email })).status).toBe(200);
      const first = ctx.sentCodes.get(email)!;
      const [row] = await tx.select().from(emailVerificationCodes).where(eq(emailVerificationCodes.email, email));
      expect(row!.codeHash).not.toContain(first);

      const again = await ctx.post("/email/code", { email });
      expect(again).toMatchObject({ status: 429, json: { error: { code: "EMAIL_CODE_RATE_LIMITED" } } });

      const wrong = first === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 4; i++) {
        const r = await ctx.post("/email/verify", { email, code: wrong });
        expect(r.json.error.code).toBe("EMAIL_CODE_INVALID");
        expect(r.json.error.message).toContain(`${5 - i} 次`);
      }
      expect((await ctx.post("/email/verify", { email, code: wrong })).json.error.code).toBe("EMAIL_CODE_TOO_MANY_ATTEMPTS");
      // 作废之后正确的码也不行
      expect((await ctx.post("/email/verify", { email, code: first })).json.error.code).toBe("EMAIL_CODE_TOO_MANY_ATTEMPTS");

      // 重发：旧码失效，新码能用
      ctx.advance(60_001);
      await ctx.post("/email/code", { email });
      const second = ctx.sentCodes.get(email)!;
      if (second !== first) expect((await ctx.post("/email/verify", { email, code: first })).json.error.code).toBe("EMAIL_CODE_INVALID");
      const okLogin = await ctx.post("/email/verify", { email, code: second });
      expect(okLogin.status).toBe(200);
      // 用过一次就失效
      expect((await ctx.post("/email/verify", { email, code: second })).json.error.code).toBe("EMAIL_CODE_EXPIRED");

      // 过期
      ctx.advance(60_001);
      await ctx.post("/email/code", { email });
      ctx.advance(5 * 60_000);
      expect((await ctx.post("/email/verify", { email, code: ctx.sentCodes.get(email) })).json.error.code).toBe("EMAIL_CODE_EXPIRED");

      // 没发过码的邮箱、格式不对
      expect((await ctx.post("/email/verify", { email: "nobody@example.com", code: "123456" })).json.error.code).toBe("EMAIL_CODE_INVALID");
      expect((await ctx.post("/email/code", { email: "not-an-email" })).json.error.code).toBe("INVALID_PARAMS");
    });
  });

  it("Google：state 对不上 / 没有 cookie 都跳回前端带 OAUTH_STATE_MISMATCH，不建账户", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const before = ctx.engine.snapshot().accounts.length;

      const start = await ctx.app.request("/auth/google");
      expect(start.headers.get("Location")).toContain("accounts.google.com");
      const setCookies = start.headers.getSetCookie();
      expect(setCookies.every((c) => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c) && /Path=\/auth\/google/i.test(c))).toBe(true);
      const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

      const mismatch = await ctx.app.request("/auth/google/callback?code=x&state=evil", { headers: { Cookie: cookies } });
      expect(mismatch.headers.get("Location")).toBe(`${WEB}/login/callback#error=OAUTH_STATE_MISMATCH`);
      const noCookie = await ctx.app.request("/auth/google/callback?code=x&state=state-1");
      expect(noCookie.headers.get("Location")).toBe(`${WEB}/login/callback#error=OAUTH_STATE_MISMATCH`);
      const cancelled = await ctx.app.request("/auth/google/callback?state=state-1&error=access_denied", { headers: { Cookie: cookies } });
      expect(cancelled.headers.get("Location")).toBe(`${WEB}/login/callback#error=UNAUTHORIZED`);

      expect(ctx.engine.snapshot().accounts.length).toBe(before);
    });
  });

  it("/auth/me：没 token、token 不对都是 401 UNAUTHORIZED", async () => {
    await inRollback(async (tx) => {
      const ctx = await setup(tx);
      const none = await ctx.app.request("/auth/me");
      expect(none.status).toBe(401);
      expect(((await none.json()) as any).error.code).toBe("UNAUTHORIZED");
      const bad = await ctx.app.request("/auth/me", { headers: { Authorization: "Bearer nope" } });
      expect(((await bad.json()) as any).error.code).toBe("UNAUTHORIZED");
    });
  });
});
