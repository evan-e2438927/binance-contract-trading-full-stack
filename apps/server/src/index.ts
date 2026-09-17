import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.server";

const app = new Hono();

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
import { startTradingCore } from "./engine-host/start";
import { startBracketSyncJob } from "./jobs/bracket-sync";
import { booksRoute } from "./routers/books";
import { getDb } from "./services";

app.route("/books", booksRoute); // 👈 新增

// 交易内核：从数据库恢复引擎状态、连币安行情、等就绪（30 秒没就绪就退出，04-backend-design.md 第 1 节）。
// 先于 HTTP 服务启动：盘口和标记价没就位就不对外接受请求
const trading = await startTradingCore({ db: getDb() });

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
