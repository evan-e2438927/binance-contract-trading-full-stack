import { env } from "./env.server";

import { serve } from "@hono/node-server";
import {
  createBracketFetcher,
  syncLeverageBrackets,
} from "@binance-contract-trading-full-stack/db";
import { createConsoleSender, createResendSender } from "./auth/email";
import { createGoogleOAuth } from "./auth/google";
import { createApp } from "./app";
import { startTradingCore } from "./engine-host/start";
import { startBracketSyncJob } from "./jobs/bracket-sync";
import { startEquitySnapshotJob, takeEquitySnapshot } from "./jobs/equity-snapshot";
import { createWsHub } from "./ws/hub";
import { createWsPublisher, type WsPublisher } from "./ws/publisher";
import { attachWsServer } from "./ws/server";
import { booksRoute } from "./routers/books";
import { getDb } from "./services";

// 交易内核：从数据库恢复引擎状态、连币安行情、等就绪（30 秒没就绪就退出，04-backend-design.md 第 1 节）。
// 先于 HTTP 服务启动：盘口和标记价没就位就不对外接受请求
// WebSocket 推送（第 14 讲）：hub 先建好，行情和引擎事件在交易内核启动时就挂上；
// publisher 要用交易内核里的引擎视图，所以晚一步再建（启动过程中的事件没有客户端在听，丢掉没关系）
let publisher: WsPublisher | null = null;
const trading = await startTradingCore({
  db: getDb(),
  onMarketEvent: (event) => publisher?.onMarketEvent(event),
  onFeedStatus: (status) => publisher?.onFeedStatus(status),
  onCommitted: (input, events) => publisher?.onCommitted(input, events),
});
const wsHub = createWsHub({
  jwtSecret: env.JWT_SECRET,
  isOpenSymbol: (symbol) => trading.symbols.some((s) => s.symbol === symbol && s.enabled && s.status === "TRADING"),
});
publisher = createWsPublisher({
  hub: wsHub,
  engine: trading.engine,
  marketState: trading.marketState,
  positionModeOf: trading.positionModeOf,
});

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
const app = createApp({
  db: getDb(),
  host: trading.host,
  registrar: trading.accounts,
  symbols: trading.symbols,
  feed: trading.feed,
  marketState: trading.marketState,
  binanceRest: trading.binanceRest, // 和行情层共用一个：限流退避状态要全进程共享（见 start.ts）
  jwtSecret: env.JWT_SECRET,
  webOrigin: env.CORS_ORIGIN,
  mailer,
  google,
  secureCookies: isProduction,
});
app.route("/books", booksRoute); // 练手链路，和业务无关

const server = serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}（WebSocket: ws://localhost:${info.port}/ws）`);
  },
);
const wsServer = attachWsServer({ server: server as import("node:http").Server, hub: wsHub });

// 杠杆分层表每日同步：启动时跑一次，之后每天 UTC 00:05。只读 Key，只在服务端使用。
const fetchBrackets = createBracketFetcher({
  fetch: trading.rateLimit.fetch, // 和行情共用限流闸门：币安按 IP 限额，绕过去就等于没装
  apiKey: env.BINANCE_API_KEY,
  secretKey: env.BINANCE_SECRET_KEY,
});
startBracketSyncJob({
  run: () => syncLeverageBrackets({ db: getDb(), fetchBrackets }),
  // 分层表有变化：热加载进引擎并立刻扫风控（第 11 讲，02-architecture.md 失真点 #9 不再需要重启）
  onChanged: (report) => trading.reloadBrackets(report.changed.map((c) => c.symbol)),
});

// 每日 UTC 00:00 权益快照（排行榜、权益曲线）。错过 00:00 超过 60 秒就跳过当天，不补拍（第 13b 讲，用户定）
const equitySnapshotJob = startEquitySnapshotJob({
  take: (at) => takeEquitySnapshot({ db: getDb(), host: trading.host, isSymbolReady: (s) => trading.feed.symbolReady(s), at }),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[server] 收到 ${signal}，停止行情、等队列处理完再退出`);
    equitySnapshotJob.stop();
    wsServer.close();
    wsHub.stop();
    trading.stop().finally(() => process.exit(0));
  });
}
