import type { DbExecutor } from "@binance-contract-trading-full-stack/db";
import type { SymbolSpec } from "@binance-contract-trading-full-stack/engine";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger as requestLogger } from "hono/logger";
import { createAccountRoutes } from "./api/account";
import type { ApiDeps } from "./api/context";
import { createOrderRoutes } from "./api/orders";
import { createPositionRoutes } from "./api/positions";
import type { MailSender } from "./auth/email";
import type { GoogleOAuth } from "./auth/google";
import { createAuthRoutes, requireAuth, type AuthEnv } from "./auth/routes";
import type { EngineHost } from "./engine-host/engine-host";
import type { AccountRegistrar } from "./engine-host/register-account";
import { rateLimit } from "./http/rate-limit";
import { createErrorHandler } from "./http/respond";

/**
 * 组装 HTTP 应用：index.ts 和集成测试用同一个入口，测试测到的就是线上的路由、中间件和错误处理。
 *
 * 限流（04-backend-design.md 第 11 节）：
 * - /auth/*：公共接口，按 IP 60 次 / 分钟
 * - /account/*、/positions/*：私有接口，按账户 120 次 / 分钟
 * - /orders（下单、撤单）：按账户 20 次 / 10 秒
 */

export interface AppDeps {
  db: DbExecutor;
  host: EngineHost;
  registrar: AccountRegistrar;
  symbols: readonly SymbolSpec[];
  jwtSecret: string;
  webOrigin: string;
  mailer: MailSender | null;
  google: GoogleOAuth | null;
  secureCookies: boolean;
  now?: () => number;
  logger?: Pick<Console, "log" | "error">;
  /** 请求日志（测试里关掉） */
  logRequests?: boolean;
  /** 取客户端 IP；默认读 TCP 连接的对端地址（部署在反向代理后面时要改成信任代理头） */
  clientIp?: (c: Context) => string | null;
}

function remoteAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null; // app.request() 测试里没有真实连接
  }
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? console;
  const clientIp = deps.clientIp ?? remoteAddress;
  const app = new Hono();

  app.onError(createErrorHandler(logger));
  if (deps.logRequests !== false) app.use(requestLogger());
  app.use(
    "/*",
    cors({
      origin: deps.webOrigin,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      exposeHeaders: ["Retry-After", "X-Idempotent-Replay"],
    }),
  );
  app.get("/", (c) => c.text("OK"));

  const byAccount = (c: Context) => (c as Context<AuthEnv>).get("accountId") ?? null;
  const auth = requireAuth(deps.jwtSecret);
  const privateRateLimit = rateLimit({ name: "private", limit: 120, windowMs: 60_000, key: byAccount, now });

  app.use("/auth/*", rateLimit({ name: "public", limit: 60, windowMs: 60_000, key: clientIp, now }));
  app.route(
    "/auth",
    createAuthRoutes({
      db: deps.db,
      registrar: deps.registrar,
      jwtSecret: deps.jwtSecret,
      webOrigin: deps.webOrigin,
      mailer: deps.mailer,
      google: deps.google,
      secureCookies: deps.secureCookies,
      now,
      logger,
    }),
  );

  const api: ApiDeps = { db: deps.db, host: deps.host, symbols: deps.symbols, jwtSecret: deps.jwtSecret, now };
  app.route("/orders", createOrderRoutes(api, { auth, orderRateLimit: rateLimit({ name: "orders", limit: 20, windowMs: 10_000, key: byAccount, now }) }));
  app.route("/positions", createPositionRoutes(api, { auth, rateLimit: privateRateLimit }));
  app.route("/account", createAccountRoutes(api, { auth, rateLimit: privateRateLimit }));

  return app;
}
