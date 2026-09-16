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
import { startBracketSyncJob } from "./jobs/bracket-sync";
import { booksRoute } from "./routers/books";
import { getDb } from "./services";

app.route("/books", booksRoute); // 👈 新增

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
  onChanged: () => {
    // TODO(第 11 讲 引擎宿主)：在这里把新分层表热加载进引擎。
    // 在那之前，分层表变更要重启 server 才会进入引擎（02-architecture.md 已知失真点 #9）。
    console.log(
      "[bracket-sync] 分层表已更新；引擎热加载尚未接入，需重启 server 生效",
    );
  },
});
