# 09 · 线上监控方案（第三方服务）

> 2026-10-16 · 状态：方案待定稿；**2026-10-24 起拆成三个迭代分步实施**，各迭代进度见下表
> 适用部署：web 在 Cloudflare Workers（`trade.coinbasis.org`），server 在家里 mac-mini 的 Docker 里、经 Cloudflare Tunnel 对外（`trade-api.coinbasis.org`），Postgres 也在同一台 mac-mini 上（`host.docker.internal:54322`）。


### 迭代拆分

| 迭代 | 内容 | 对应本文 | 状态 |
| --- | --- | --- | --- |
| 001 · `docs/iterations/2026-10-24/001-sentry-error-monitoring-feature` | Sentry 报错收集（server + web） | 第四节「第 3 层」 | 开发完成，待验收 |
| 002 · `…/002-telegram-alert-notify-feature` | 告警推送到 Telegram | 第五节末尾、第九节待决 1 | 仅范围草稿 |
| 003 · `…/003-health-probe-heartbeat-feature` | `/health`、外部探测、心跳、对账任务、宿主机脚本、Cloudflare 自带三项 | 第四节「第 1、2 层」、附加 | 仅范围草稿 |

---

## 一、先说结论

用三家免费档就够，不自建 Prometheus/Grafana：

| 角色 | 打个比方 | 选型 | 费用 |
| --- | --- | --- | --- |
| 外部探测 + 定时打卡 + 状态页 | 门口的摄像头 + 员工打卡机 | **Better Stack Uptime** | 免费档（监控 + 心跳合计 10 个、1 个状态页、邮件/Slack 告警） |
| 程序报错收集 | 烟雾报警器 | **Sentry**（web 和 server 各一个项目） | 免费档 Developer |
| 隧道、边缘、访问统计 | 物业自带的门禁记录 | **Cloudflare 自带**：Tunnel Health Alert、Workers Logs、Web Analytics | 免费 |

一句话分工：**Better Stack 回答"还活着吗、该干的活干了没"，Sentry 回答"哪里坏了、坏在哪一行"，Cloudflare 回答"隧道通不通、谁在访问"。**

> 免费档额度以各家官网当下为准，上线前看一眼；本方案的用量（7 个监控/心跳、低频报错）离上限都有余量。

---

## 二、这套部署最可能在哪儿出事

监控不是越多越好，要盯的是"真会坏、坏了用户能感觉到"的地方。按这次的实际部署排：

| # | 风险 | 用户看到什么 | 现在能发现吗 |
| --- | --- | --- | --- |
| R1 | mac-mini 断电 / 断网 / 休眠 / Docker Desktop 自动更新重启 | 整站行情不动、下单失败 | ❌ |
| R2 | Cloudflare Tunnel 掉线（cloudflared 挂了或连不上 CF） | 同上，web 能打开但接口全挂 | ❌ |
| R3 | 币安行情断线，行情源变成 `degraded`，**撮合暂停** | 页面有降级横幅，但你本人不知道 | ❌（只在页面上提示） |
| R4 | 被币安封 IP（418，S02 那次事故） | 行情、K 线、分层表同步全停 | ❌ |
| R5 | 本机 Postgres 挂了 / 磁盘满 | 下单落库失败、引擎回滚 | ❌ |
| R6 | 定时活没干：资金费（UTC 0/8/16）、权益快照（00:00）、分层表同步（00:05） | 资金费漏结、排行榜缺一天 | ❌（资金费因标记价过期跳过时只打一行日志） |
| R7 | 账目不平（钱包余额 ≠ 流水之和，贯穿原则 4） | 用户资产错 | ❌（对账脚本存在，但线上没人定时跑） |
| R8 | 前端 JS 报错、某个浏览器白屏 | 用户看到"页面出错了" | ❌（`global-error.tsx` 只 `console.error`） |
| R9 | 域名 / 证书过期 | 全站打不开 | ❌ |

现在唯一的健康检查是 Docker 的 `GET /` → `OK`，它只能证明"进程活着"，R2～R7 都看不到。

---

## 三、整体结构

```
                    ┌──────────────── Better Stack ────────────────┐
                    │  ① 外部探测（每隔几分钟从海外节点访问）           │
   用户浏览器 ──┐    │  ② 心跳（等着 server 定时来"打卡"，超时没来就报警）│
                │    │  ③ 状态页 status.coinbasis.org（可选）         │
                │    └────────▲──────────────────────▲───────────────┘
                │             │探测                   │打卡
                ▼             │                       │
   Cloudflare Workers ── web ─┘      Cloudflare Tunnel│
   (trade.coinbasis.org)              │              │
        │  Sentry(前端报错)           ▼              │
        │                     mac-mini · Docker      │
        │                     ┌────────────────────┐ │
        └──── REST / WS ────► │ server  /health    │─┘
                              │  Sentry(后端报错)   │
                              │ cloudflared        │
                              │ Postgres(宿主机)    │
                              └────────────────────┘
                                   ▲ 宿主机 cron：磁盘、容器状态 → 心跳
   Cloudflare 自带：Tunnel Health Alert（隧道状态变化发邮件）、Workers Logs
```

---

## 四、分三层落地

### 第 1 层 · 外部探测：从外面看"还活着吗"（Better Stack）

**先给 server 加一个真正的体检接口 `GET /health`**（现在的 `/` 只说"我还在"，不说"我能干活"）：

```json
// 200 = 能干活；503 = 有关键项不行
{
  "status": "ok",                       // ok | degraded | down
  "checks": {
    "db":     { "ok": true, "latencyMs": 3 },        // SELECT 1，1 秒超时
    "feed":   { "status": "ready", "readySymbols": 19, "totalSymbols": 19, "sinceMs": 812345 },
    "engine": { "queueLength": 0, "lastCommitAgoMs": 1200 },
    "binance":{ "bannedUntil": null }                // 418 封禁期间给出解封时间
  },
  "version": "0.1.0",
  "uptimeSec": 86400
}
```

判定规则：

- `db` 不通 → 503
- `feed` 不是 `ready` 且持续超过 **60 秒** → 503（短暂抖动、自动重连成功的不算）
- `binance.bannedUntil` 有值 → 503
- 其余只展示不判定
- 这个接口**不走限流**、不需要登录、不暴露账户数据

> ⚠️ Docker 的 healthcheck **继续用 `/`，不要改成 `/health`**。原因：行情断了时如果容器被判不健康而反复重启，每次重启都会重新拉币安快照，正好重演 S02 的封 IP。外部探测只负责"告诉你"，不负责"自动处理"。

**Better Stack 配这几个探测：**

| 监控 | 地址 | 判定 | 盯住的风险 |
| --- | --- | --- | --- |
| M1 API 体检 | `https://trade-api.coinbasis.org/health` | 状态码 200 | R1 R2 R3 R4 R5 |
| M2 前端首页 | `https://trade.coinbasis.org/` | 状态码 200 + 页面含固定关键字 | Workers 部署坏了 |

两个 HTTP 监控都顺带开 **SSL 证书到期提醒**（R9）。确认失败设为"连续 2 次才报警"，避免偶发抖动吵你。

### 第 2 层 · 心跳：定时活"该干的干了没"（Better Stack Heartbeat）

打个比方：探测是你去敲门问"在吗"，心跳是让它每次干完活自己来打卡；**到点没来打卡就报警**。这正好盯"定时任务悄悄没跑"这种最难发现的问题。

| 心跳 | 谁来打卡 | 周期 / 宽限 | 盯住的风险 |
| --- | --- | --- | --- |
| H1 资金费结算 | 每次 UTC 0/8/16 结算**全部币对成功**后 | 8 小时 / 20 分钟 | R6（含"标记价过期跳过结算"） |
| H2 权益快照 | 每日 00:00 快照成功后 | 24 小时 / 30 分钟 | R6 |
| H3 分层表同步 | 每日 00:05 同步成功后 | 24 小时 / 1 小时 | R6、R4 |
| H4 账目对账 | **新加**的每小时对账任务，**对平了才打卡** | 1 小时 / 15 分钟 | R7 |
| H5 宿主机 | mac-mini 上的 cron 脚本，每 5 分钟：磁盘 < 85%、server/cloudflared 两个容器都在跑、Postgres 能连 → 才打卡 | 5 分钟 / 5 分钟 | R1 R5 |

要点：

- **只在成功时打卡**，失败就不打——"没来打卡"本身就是报警，不需要额外写"失败上报"的逻辑。Better Stack 也支持失败时访问 `/fail` 地址立即报警，对账不平（H4）用这个，不等超时。
- H4 是把现有的 `packages/db/src/scripts/reconcile-ledger.ts` 改成 server 里每小时跑一次的任务（和 `jobs/` 下另外两个任务同一个写法）。贯穿原则 4 写了"数据库层每小时对账"，线上目前其实没在跑。
- 心跳地址是密钥性质的 URL，放环境变量（`HEARTBEAT_FUNDING_URL` 等），不进 git；没配就不打卡，开发环境不受影响。

到这里一共 2 个探测 + 5 个心跳 = 7 个，免费档 10 个还剩 3 个余量。

### 第 3 层 · 报错收集：坏在哪一行（Sentry）

**server（`@sentry/node`）**

- 进程启动最早处初始化（ESM 下用单独的 `instrument` 文件，`node --import ./dist/instrument.mjs dist/index.mjs`）。
- 自动收：未捕获异常、未处理的 Promise 拒绝。
- 接入现有的 `createErrorHandler`：**只上报 5xx**，4xx（参数错、余额不足）是正常业务，不报。
- 主动上报几个业务事件（`captureMessage`，带币对、时间等上下文）：

| 事件 | 级别 | 为什么 |
| --- | --- | --- |
| 引擎落库失败、回滚 | error | 内存和数据库可能出现分歧 |
| 收到币安 418 / 429 | error | S02 同类事故，要第一时间知道 |
| 资金费因标记价过期跳过 | warning | 现在只有一行日志 |
| 行情 `degraded` 超过 2 分钟 | warning | 和 /health 互为印证，带断线原因 |
| 开户事务失败 | error | 用户第一步就卡住 |

- 隐私：`sendDefaultPii: false`；`beforeSend` 里删掉 `Authorization`、Cookie、邮箱、验证码；钱包地址只保留前 6 后 4 位。
- 采样：性能追踪 `tracesSampleRate` 先设 0（只要报错），等真有性能问题再开。

**web（`@sentry/nextjs`）**

- 浏览器端报错是重点：`error.tsx`、`global-error.tsx` 里加 `Sentry.captureException(error)`。
- 想让 Worker 里的服务端渲染报错也能发出去，需要把 `wrangler.jsonc` 的 `compatibility_date` 从现在的 `2025-05-05` **调到 `2025-08-16` 或之后**（Sentry 官方要求，这个日期起 Workers 才有它发数据要用的 `https.request`）；`nodejs_compat` 已经开了。调日期前在预览环境跑一遍，Workers 运行时行为可能随日期变化。
- 降噪（免费额度主要靠这一条省下来）：`allowUrls` 只收自己域名的脚本；忽略钱包插件注入报错、`ResizeObserver loop`、TradingView iframe 内部报错。
- WS 断线重连**不当报错上报**，记成 breadcrumb（报错发生时附带"之前断过几次线"的上下文）。
- 不开 Session Replay：交易页刷新频繁、录像体积大，还涉及隐私，暂时用不上。
- 打包时上传 source map，报错能直接看到源码行号；上传后从产物里删掉 `.map`，不对外暴露。

**Sentry 告警规则**：新问题首次出现 → 邮件；同一问题 1 小时内超过 50 次 → 邮件（防止旧问题突然爆发）；418/429 和落库失败这两类 → 一出现就发。

### 第 3 层 · 本迭代（001）的实际做法

相对上面的方案，001 做了这些取舍（均已与需求方确认）：

| 方案里写的 | 001 实际 | 原因 |
| --- | --- | --- |
| web 含 Worker 端 SSR 报错，`compatibility_date` 升到 `2025-08-16` | **只接浏览器端 + `error.tsx` / `global-error.tsx`**，不改 `wrangler.jsonc`，不自写 worker 入口 | 降低部署风险；Worker 端留到后续并先在预览环境验证 |
| 打包上传 source map | **不做**，先看压缩后的栈 | 需要把 `SENTRY_AUTH_TOKEN` 注入 Docker 构建和 Cloudflare 构建 |
| 5 个业务事件（落库失败、418/429、资金费跳过、degraded、开户失败） | **不做**，只收未捕获异常、未处理拒绝、意外 5xx | 避免改动行情、定时任务、引擎宿主、鉴权多处代码；业务状态后续由 `/health` 与心跳覆盖 |
| 只上报 5xx | 只报**非 `AppError` 的意外错误**；已知 4xx 与已知 503（`MARKET_NOT_READY`、`SERVICE_UNAVAILABLE`）不报 | 行情断线期间每个请求一条，会把免费额度刷爆 |
| `sendDefaultPii: false` | 另加 `dataCollection` 全关 | `@sentry/*` v11 已移除 `sendDefaultPii`，新选项默认全开，必须显式关 |

已知缺口（不在 001 范围，记在这里避免误以为已覆盖）：`apps/server/src/auth/routes.ts` 里 Google 登录开户失败被 `catch` 吞掉后重定向并带 `error=INTERNAL_ERROR`，不经过全局错误处理器，因此**不会**上报到 Sentry；属于「开户失败」业务事件，留待业务事件迭代。

#### Sentry 控制台配置清单（人工操作）

1. 注册 Sentry，建**两个**项目：`trade-server`（平台选 Node.js）、`trade-web`（平台选 Next.js）。两个 DSN 不能混用。
2. server：把 `trade-server` 的 DSN 写进 `apps/server/.env.docker` 的 `SENTRY_DSN=`（`SENTRY_RELEASE=` 可不填，留空时自动用 `apps/server/package.json` 的 version，形如 `server@0.1.0`），然后 `pnpm run deploy:server` 重建容器。
3. web：把 `trade-web` 的 DSN 写进 `apps/web/.env.production`（本机构建）或 CI 构建环境的 `NEXT_PUBLIC_SENTRY_DSN`，然后 `pnpm run deploy:web`。它是构建期内联，**改后必须重新部署**。
4. 出站自检（server 所在的 mac-mini）：`curl -sI https://o0.ingest.sentry.io` 能返回 HTTP 响应即网络可达（域名以你 DSN 里的为准）。
5. 在两个项目里建告警规则（免费档支持邮件）：
   - 新问题首次出现 → 邮件
   - 同一问题 1 小时内超过 50 次 → 邮件（防止旧问题突然爆发）
   - 「418/429」「落库失败」的即时告警依赖业务事件，**001 不适用**，待业务事件迭代再建
6. 上线验证：web 在浏览器控制台执行 `Promise.reject(new Error("sentry-probe"))`；server 暂无安全的手动触发入口，可临时在预发环境让一个路由抛错确认到达。两边都应在 Sentry 项目里看到事件，且不含 `Authorization`、Cookie、完整钱包地址。

### 附加 · Cloudflare 自带（零代码、零成本）

1. **Tunnel Health Alert**：Cloudflare 控制台 → Notifications → 添加 Tunnel Health Alert，隧道状态在 Healthy / Degraded / Down / Inactive 之间变化时发邮件。它和 M1 的区别：M1 报"打不开"，它直接告诉你"是隧道的问题"，排查少走一步。
2. **Workers Logs**：`wrangler.jsonc` 加 `"observability": { "enabled": true }`，Worker 的 `console` 日志可以在控制台按时间查，出事时回看用。
3. **Web Analytics**：控制台开启，看访问量和页面加载性能（Core Web Vitals），不用 cookie。

---

## 五、告警分级：什么事半夜叫醒你

| 级别 | 触发 | 通知方式 | 期望响应 |
| --- | --- | --- | --- |
| P1 紧急 | M1 失败、Tunnel Down、H1 资金费没打卡、H4 对账不平、Sentry 418/落库失败 | Better Stack 手机 App 推送 + 邮件 | 尽快 |
| P2 当天 | M2 失败、H2/H3/H5 没打卡、Sentry 新问题 | 邮件 | 当天处理 |
| P3 每周 | Sentry 周报、Web Analytics、证书 30 天到期 | 邮件 | 周末看 |

> 免费档没有电话/短信，P1 靠手机 App 推送。若想接飞书/Telegram：Better Stack 和 Cloudflare 都支持 Webhook，再写一个小转发（可以放在 Cloudflare Worker 里）把消息转成飞书机器人格式。第一版先用 App 推送 + 邮件，够用了再说。

---

## 六、收到告警先做什么（简版处置手册）

| 告警 | 第一步 | 第二步 |
| --- | --- | --- |
| M1 失败 + Tunnel Down | `ssh mac-mini` 能不能连上？连不上 → 机器断电/断网，去现场或等恢复 | 能连上 → `docker compose -f compose.server.yaml ps` 看 cloudflared 是否在跑，`logs cloudflared` |
| M1 失败，Tunnel 正常 | `curl -s localhost:3000/health` 看是哪一项不行 | db 不行查 Postgres；feed 不行看下一行 |
| feed degraded / 418 | **先别重启 server**（重启会重新拉快照，可能延长封禁） | 看 `/health` 里的 `bannedUntil`，等解封；查日志找是什么请求打满了限额 |
| H1 资金费没打卡 | 查 server 日志 `[funding]`，是标记价过期跳过还是任务没触发 | 唯一索引会挡重复结算，确认原因后可手动补（补结算流程另议） |
| H4 对账不平 | **停止对外下单**（维护开关，另议），保留现场 | 跑 `reconcile-ledger` 拿差异明细，按账户逐条查流水 |
| H5 宿主机 | 看是磁盘、容器还是 Postgres | 磁盘多半是 Docker 日志/镜像，`docker system df` |

---

## 七、实施顺序

| 步骤 | 内容 | 要不要写代码 | 预计 |
| --- | --- | --- | --- |
| 1 | 注册 Better Stack、Sentry；先用现有 `/` 配 M1/M2；开 Tunnel Health Alert、Workers Logs、Web Analytics | 否（只改 `wrangler.jsonc` 一行） | 半天 |
| 2 | server 加 `/health`；M1 改指 `/health` | 是 | 半天 |
| 3 | Sentry 接入 server + web（含降噪、隐私、source map、`compatibility_date`） | 是 | 1 天 |
| 4 | 心跳 H1～H3；新增每小时对账任务 H4 | 是 | 1 天 |
| 5 | mac-mini 宿主机脚本 H5（launchd 定时） | 是（一个 shell 脚本） | 半天 |
| 6（可选） | 状态页 `status.coinbasis.org`；日志集中（Better Stack Logs）；指标面板（Grafana Cloud） | — | 以后 |

第 1 步做完就已经能发现 R1、R2、R8、R9；第 2～5 步补上业务层面的 R3～R7。

---

## 八、明确不做（第一版）

- 不自建 Prometheus / Grafana / ELK：一人维护成本太高，且会和 server 抢同一台 mac-mini 的资源。
- 不做自动处置（自动重启、自动切换）：单机部署没有可切换的目标，自动重启还可能放大币安封禁。
- 不做性能追踪和用户行为分析：先把"坏了能知道"做扎实。

## 九、待你决定

1. 告警通知渠道：先用 Better Stack App 推送 + 邮件，还是第一版就接飞书/Telegram？
2. 要不要对外状态页（让用户知道"维护中/行情中断"，减少疑问）？
3. 对账不平时要不要做一个"暂停下单"的维护开关（本方案第六节提到，属于新功能）？

## 十、提醒：监控之外的一个隐患

监控只能告诉你"坏了"，不能让数据回来。现在 Postgres 和 server 在同一台家用机器上，**数据库备份**（例如每日 `pg_dump` 推到 Cloudflare R2，并用一个心跳盯住备份任务）值得排在监控之后紧接着做。

---

参考：
- [Better Stack 免费档说明（第三方整理）](https://costbench.com/software/log-management/better-stack/free-plan/)
- [Sentry · Next.js on Cloudflare Workers](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs)
- [Cloudflare Tunnel 通知](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/notifications/)
