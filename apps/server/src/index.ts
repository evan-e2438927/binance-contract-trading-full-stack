import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.server";
import { createErrorHandler } from "./http/respond";

const app = new Hono();

app.onError(createErrorHandler());

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";
import {
  createBracketFetcher,
  syncLeverageBrackets,
} from "@binance-contract-trading-full-stack/db";
import { createConsoleSender, createResendSender } from "./auth/email";
import { createGoogleOAuth } from "./auth/google";
import { createAuthRoutes } from "./auth/routes";
import { startTradingCore } from "./engine-host/start";
import { startBracketSyncJob } from "./jobs/bracket-sync";
import { booksRoute } from "./routers/books";
import { getDb } from "./services";

app.route("/books", booksRoute); // 👈 新增

// 交易内核：从数据库恢复引擎状态、连币安行情、等就绪（30 秒没就绪就退出，04-backend-design.md 第 1 节）。
// 先于 HTTP 服务启动：盘口和标记价没就位就不对外接受请求
const trading = await startTradingCore({ db: getDb() });

// 鉴权（第 12 讲）：钱包 / 邮箱 / Google 三种登录，开户交给交易内核排队（账户 + 身份 + INITIAL 流水一个事务）
const isProduction = env.NODE_ENV === "production";
const mailer =
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? createResendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : isProduction
      ? null // 生产环境发不了信就说发不了，不假装发出去
      : createConsoleSender();
const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
    ? createGoogleOAuth({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
      })
    : null;
if (!google) console.log("[auth] 未配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI，Google 登录不可用");
app.route(
  "/auth",
  createAuthRoutes({
    db: getDb(),
    registrar: trading.accounts,
    jwtSecret: env.JWT_SECRET,
    webOrigin: env.CORS_ORIGIN,
    mailer,
    google,
    secureCookies: isProduction,
  }),
);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

// 杠杆分层表每日同步：启动时跑一次，之后每天 UTC 00:05。只读 Key，只在服务端使用。
const fetchBrackets = createBracketFetcher({
  apiKey: env.BINANCE_API_KEY,
  secretKey: env.BINANCE_SECRET_KEY,
});
startBracketSyncJob({
  run: () => syncLeverageBrackets({ db: getDb(), fetchBrackets }),
  // 分层表有变化：热加载进引擎并立刻扫风控（第 11 讲，02-architecture.md 失真点 #9 不再需要重启）
  onChanged: (report) => trading.reloadBrackets(report.changed.map((c) => c.symbol)),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[server] 收到 ${signal}，停止行情、等队列处理完再退出`);
    trading.stop().finally(() => process.exit(0));
  });
}
