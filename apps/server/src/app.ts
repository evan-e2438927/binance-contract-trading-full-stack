import type { DbExecutor } from "@binance-contract-trading-full-stack/db";
import type { SymbolSpec } from "@binance-contract-trading-full-stack/engine";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger as requestLogger } from "hono/logger";
import { createAccountRoutes } from "./api/account";
import type { ApiDeps } from "./api/context";
import { createLeaderboardRoutes } from "./api/leaderboard";
import { createMarketRoutes } from "./api/market";
import { createOrderRoutes } from "./api/orders";
import { createPositionRoutes } from "./api/positions";
import { createSystemRoutes } from "./api/system";
import type { MailSender } from "./auth/email";
import type { GoogleOAuth } from "./auth/google";
import { createAuthRoutes, requireAuth, type AuthEnv } from "./auth/routes";
import type { EngineHost } from "./engine-host/engine-host";
import type { AccountRegistrar } from "./engine-host/register-account";
import { rateLimit } from "./http/rate-limit";
import type { BinanceRest } from "./market/binance-rest";
import type { FeedStatus } from "./market/market-feed";
import type { MarketState } from "./market/market-state";
import { createErrorHandler } from "./http/respond";

/**
 * 组装 HTTP 应用：index.ts 和集成测试用同一个入口，测试测到的就是线上的路由、中间件和错误处理。
 *
 * 限流（04-backend-design.md 第 11 节）：
 * - /auth/*、/market/*、/leaderboard：公共接口，按 IP 60 次 / 分钟（三组共用一个额度）
 * - /account/*、/positions/*：私有接口，按账户 120 次 / 分钟
 * - /orders（下单、撤单）：按账户 20 次 / 10 秒
 */

export interface AppDeps {
  db: DbExecutor;
  /** 撮合/风控/清算的唯一入口：所有下单、撤单、行情推送、只读查询都要排它的队 */
  host: EngineHost;
  /** 开户：鉴权层验完身份后交给它排队建账户 */
  registrar: AccountRegistrar;
  /** 支持交易的币对列表（分层表、精度等元数据） */
  symbols: readonly SymbolSpec[];
  /** 行情连接状态；symbolReady 为 false 时该币对暂停撮合 */
  feed: { status(): FeedStatus; symbolReady(symbol: string): boolean };
  /** 最新标记价格/指数价格/资金费率缓存，REST 查询和清算用 */
  marketState: MarketState;
  binanceRest: BinanceRest;
  jwtSecret: string;
  /** CORS 允许的前端源 */
  webOrigin: string;
  /** null = 没配邮件服务，邮箱验证码登录返回 SERVICE_UNAVAILABLE */
  mailer: MailSender | null;
  /** null = 没配 Google OAuth，/auth/google 跳回前端并带 SERVICE_UNAVAILABLE */
  google: GoogleOAuth | null;
  /** Set-Cookie 是否带 Secure（本地 http 开发环境要关掉） */
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

  const publicRateLimit = rateLimit({ name: "public", limit: 60, windowMs: 60_000, key: clientIp, now });
  app.use("/auth/*", publicRateLimit);
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
  app.route(
    "/market",
    createMarketRoutes(
      { db: deps.db, host: deps.host, symbols: deps.symbols, feed: deps.feed, marketState: deps.marketState, rest: deps.binanceRest },
      { rateLimit: publicRateLimit },
    ),
  );
  app.route("/leaderboard", createLeaderboardRoutes({ db: deps.db, jwtSecret: deps.jwtSecret }, { rateLimit: publicRateLimit }));
  app.route("/system", createSystemRoutes({ now }, { rateLimit: publicRateLimit }));

  return app;
}
