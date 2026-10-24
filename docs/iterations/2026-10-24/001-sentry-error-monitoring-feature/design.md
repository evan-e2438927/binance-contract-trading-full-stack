# 技术设计文档

## 基本信息

- **迭代目录**: docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/
- **生成时间**: 2026-10-24
- **基于需求**: requirements.md
- **依据**: `docs/design/09-monitoring.md` 第四节「第 3 层 · 报错收集」；历史迭代 `2026-09-26/001`（钱包登录）、`2026-09-25/003`（强平价原因）已读，与本需求无交集

## 前置说明：澄清 Gate 复核

`requirements.md` 的 ASM-001～005 全部 `confirmedBy: interactive`、`provenance: asked`，没有 `never-asked` 的设计决策，Gate 通过。ASM-006 是纯技术实现细节（正则识别 Solana 地址），登记在下面的设计假设里。

## 设计假设

| 决策点 | 关联 | 所做假设 | 理由 | 若假设错误的影响 |
| --- | --- | --- | --- | --- |
| web 不用 `withSentryConfig` 包 `next.config.ts`，只在 `instrumentation-client.ts` 里 `Sentry.init` | ASM-002 / ASM-003 | 不要 source map 上传、不要 Worker 端，`withSentryConfig` 的主要价值（上传 source map、tunnel、构建期注入）都用不上，反而会改动 OpenNext 构建链路 | 对现有 `next.config.ts` / `initOpenNextCloudflareForDev()` 零改动，风险最小 | 若 `@sentry/nextjs` 不经 `withSentryConfig` 在 Next 16 + Turbopack 下 client 端初始化失败，则 T-005 的 `build:cloudflare` 验证会暴露；退路是加最小的 `withSentryConfig(config, { sourcemaps:{disable:true}, telemetry:false })` |
| server 不用 `node --import ./instrument` 方式，改为在 `index.ts` 首条语句 `initSentry()` | ASM-004 | 只收未捕获异常/拒绝/手动 `captureException`，不需要 OpenTelemetry 自动插桩（`tracesSampleRate:0`），所以不依赖 ESM loader 提前注入 | 不改 `Dockerfile` 的 `CMD`，不改 tsdown 产物结构 | 若后续迭代要开性能追踪或自动插桩，需要改成 `--import` 方式，届时单独改 Dockerfile |
| 脱敏函数放 `packages/shared`，参数用最小结构类型，不 import `@sentry/*` | R-003 | `packages/shared` 要求零依赖；用结构类型 `SentryEventLike` 即可让 server 与 web 各自把 `ErrorEvent` 传进来 | 满足「跨端共享逻辑进 packages、不复制」+「shared 零依赖」两条规则 | 类型不完全匹配 Sentry 的 `ErrorEvent` 时在调用处做一次断言，不影响运行 |
| `SENTRY_RELEASE` 用可选环境变量，不从 `package.json` 读版本 | R-004 | Docker 内 `node dist/index.mjs` 启动，`npm_package_version` 不存在；构建期注入 git sha 属于后续迭代 | 本次先不引入构建期变量 | 没有 release 时 Sentry 无法按版本归类，不影响收集 |
| 已知 503 的判定写成「非 `AppError` 才上报」 | ASM-005 | 用户已选择「只报真正的意外错误」；`AppError` 全部视为可预期（含 500 档的 `INTERNAL_ERROR` 如被显式抛出）| 与用户选择一致；显式 `throw new AppError("INTERNAL_ERROR")` 视为开发者主动表达，已有日志 | 若有代码路径用 `AppError("INTERNAL_ERROR")` 包装了真正的意外错误，则这类不会上报；T-004 实施时 grep 一遍确认没有此类用法 |

## 遵循的项目规范

| 命中的规范 | 依据要点 |
| --- | --- |
| 根 `CLAUDE.md` 五条硬约束 | 本次不碰金额/engine/ledger；`packages/engine` 不 import Sentry（依赖方向 `web→shared`、`server→shared` 不变）；脱敏函数是纯函数，无 `number` 金额运算 |
| `.claude/skills/frontend-code-standards-ts` | web 侧新增/改动的 `.ts/.tsx`：判断里不写字符串/数字字面量（用常量，如 `SENTRY_FILTERED_PLACEHOLDER`、`ERROR_DIGEST_TAG`）；导出函数写 TSDoc；`useEffect`/关键 JSX 区块写业务含义注释；通用逻辑抽成函数放 `lib/sentry/` |
| `.claude/CODING_GUIDELINES.md` | 本迭代新增测试按 workspace 镜像放在 `tests/unit/{web,server,packages/shared}/`（用户 2026-10-24 决定，符合 workflow-rules；与 CODING_GUIDELINES 的「同目录共存」不同，仓库内老测试不迁移）；kebab-case 文件名；不新建根目录级 workspace |
| `.claude/SECURITY.md` | 币安 Key 不下发前端——web 新增的只有 `NEXT_PUBLIC_SENTRY_DSN`（DSN 本身设计上就是公开的）；日志/事件不得带密钥、Token |

## 0. 目录影响声明

### 0.1 目标目录
- `apps/server/src`: 新增 `observability/sentry.ts`（初始化、上报、冲刷）；修改 `http/respond.ts`（`createErrorHandler` 增加可选 `reportError` 回调）、`app.ts`（`AppDeps` 新增可选字段并透传）、`index.ts`（启动时初始化、退出时冲刷）、`.env.schema`（新增两个可选变量）
- `apps/web/src`: 新增 `instrumentation-client.ts`、`lib/sentry/{constants.ts,client-options.ts,report-render-error.ts}`；修改 `lib/config/env.ts`（新增 `SENTRY_DSN` 常量，字面量读 `process.env.NEXT_PUBLIC_SENTRY_DSN`）、`app/error.tsx`、`app/global-error.tsx`、`.env.schema`
- `packages/shared/src`: 新增 `sentry-scrub.ts`（+ `index.ts` 导出）
- `docs/design/09-monitoring.md`: 更新状态与第 3 层落地说明
- 根 / 各 app 的 `package.json`、`pnpm-lock.yaml`: 新增依赖（infra 任务）

### 0.2 新增目录
- `apps/server/src/observability/` —— 现有 `api/ http/ jobs/ market/ …` 都不是「第三方观测接入」的语义位置；以后探测（`/health`）迭代的体检逻辑也可放这里，故单独建一个目录
- `apps/web/src/lib/sentry/` —— 与现有 `lib/{axios-client,query,toast,ws-client,...}` 同级同风格

### 0.3 偏离说明
无偏离。不新增 workspace，不新增根目录级目录，不改依赖方向。`packages/shared` 不属于 `track-paths.md` 默认列表，按 `.claude/EXISTING_STRUCTURE.md` 的实际布局把它视为 **shared** Track。

## 1. 技术方案概要

### 1.1 概述
server 用 `@sentry/node`，web 用 `@sentry/nextjs` 的浏览器端。两端各自一个 Sentry 项目（DSN 不同）。两端都用 `beforeSend` 调同一个 `scrubSentryEvent`，脱敏失败即丢弃事件。没配 DSN 一律不初始化。

### 1.2 目标
- 意外异常自动汇总到 Sentry；可预期的业务错误一条都不报
- 隐私零泄露（认证头、Cookie、请求体、邮箱、完整钱包地址）
- 对现有行为零影响：HTTP 响应逐字不变、错误边界 UI 不变、Dockerfile/compose/wrangler 不改

### 1.3 非目标（Scope 外）
见 requirements「不包含」。

## 2. 数据模型设计

无数据库变更。

## 3. 接口契约

- **契约形态**: none（无对外 HTTP / WS 接口变化）
- **契约文件**: 无

### 3.1 对外接口表

无。HTTP 响应体、状态码与现状逐字一致（AC-001～003）。

### 3.2 模块内部接口（实现依据，T-002～T-006 共用）

| 模块 | 导出 | 签名 | 说明 |
| --- | --- | --- | --- |
| `packages/shared/src/sentry-scrub.ts` | `scrubSentryEvent` | `<E extends SentryEventLike>(event: E) => E \| null` | 脱敏；任何异常返回 `null` |
| 同上 | `SentryEventLike` | 最小结构类型：`{ message?, user?, request?: { headers?, cookies?, data?, query_string? }, exception?: { values?: { value? }[] }, breadcrumbs?: { message? }[] }` | 不 import `@sentry/*` |
| 同上 | `SENTRY_FILTERED_PLACEHOLDER` | `"[Filtered]"` | 查询参数被替换时用 |
| `apps/server/src/observability/sentry.ts` | `initSentry` | `(opts: { dsn?: string; environment: string; release?: string }) => ErrorReporter \| null` | 无 DSN 返回 `null` 且不调 `Sentry.init` |
| 同上 | `ErrorReporter` | `{ report(error: unknown, ctx: { method: string; path: string }): void; flush(timeoutMs: number): Promise<void> }` | `report` 内部不抛异常 |
| `apps/server/src/http/respond.ts` | `createErrorHandler` | `(logger?, reportError?: (error: unknown, ctx: { method: string; path: string }) => void) => ErrorHandler` | 第二参数可选，旧调用方（测试）不受影响 |
| `apps/server/src/app.ts` | `AppDeps.reportError?` | 同上回调类型 | 可选 |
| `apps/web/src/lib/sentry/client-options.ts` | `buildSentryClientOptions` | `(input: { dsn: string; environment: string; origin: string }) => BrowserOptionsLike` | 纯函数，便于单测 |
| `apps/web/src/lib/sentry/report-render-error.ts` | `reportRenderError` | `(error: Error & { digest?: string }) => void` | 内部 try/catch，永不抛 |

## 4. 安全考量

### 4.1 认证 / 授权
无变化。

### 4.2 数据保护（本迭代核心）
- `sendDefaultPii: false`；不开 Session Replay；`tracesSampleRate: 0`
- **实现期发现**：`@sentry/*` v11（11.8.0）的类型里已没有 `sendDefaultPii`，被 `dataCollection` 取代且默认全开。因此两端同时显式传 `dataCollection`：`userInfo/cookies/httpHeaders/urlQueryParams` 为 `false`、`httpBodies` 为 `[]`（server 另加 `stackFrameVariables:false`）。`sendDefaultPii:false` 仍保留（AC-004），但不再依赖它
- `beforeSend` → `scrubSentryEvent`：
  - 删 `request.headers` 里的 `authorization` / `cookie` / `set-cookie`（大小写不敏感）、`request.cookies`、`request.data`、`event.user`
  - `request.query_string` 里 `token / code / signature / email / state` 的值替换为 `[Filtered]`
  - `message`、`exception.values[].value`、`breadcrumbs[].message` 里：邮箱 → `[email]`；EVM 地址（`0x` + 40 hex）与 Solana 地址（32～44 位 base58）→ 前 6 + `…` + 后 4
  - 任何异常 → 返回 `null`（丢弃）
- server 上报时只带 `method` 与 `path`（不带 query、不带 body、不带头）；`path` 由 `c.req.path` 取，本身不含查询串
- web `reportRenderError` 只传 `error` 与 `digest` tag；不附加 store/路由参数

### 4.3 密钥
- `SENTRY_DSN`（server）按 varlock 默认 `@defaultSensitive=true` 处理，保持敏感；`NEXT_PUBLIC_SENTRY_DSN` 标 `@public`（浏览器必然可见，DSN 本就只允许写入）
- 不引入 `SENTRY_AUTH_TOKEN`（ASM-003）

### 4.4 环境变量一览（配置落点）

| 变量 | 端 | 读取方式 | 生效时机 | 本地开发 | 线上配置位置 |
| --- | --- | --- | --- | --- | --- |
| `SENTRY_DSN` | server | varlock 生成的 `ENV.SENTRY_DSN`（`@optional`） | 进程启动时 | 不配 → 不启用 | `apps/server/.env.docker`（被 `.gitignore` 的 `.env*` 排除，容器经 `compose.server.yaml` 的 `env_file` 读取）；改后需 `pnpm run deploy:server` 重建/重启容器 |
| `SENTRY_RELEASE` | server | 同上（`@optional`） | 进程启动时 | 不配 | 同上；本次可不填 |
| `NEXT_PUBLIC_SENTRY_DSN` | web | **`process.env.NEXT_PUBLIC_SENTRY_DSN` 字面量访问**，写在 `lib/config/env.ts`，与现有 `NEXT_PUBLIC_SERVER_URL` 同模式 | **构建期内联**，改后必须重新 `deploy:web` | 不配 → 不启用 | 本机构建：`apps/web/.env.production`（已被忽略）；CI：构建环境变量（与 `NEXT_PUBLIC_SERVER_URL` 同处） |

要点：
- web 端**不能**用 varlock 生成的 `ENV` 对象读取：Next 只会内联形如 `process.env.NEXT_PUBLIC_X` 的字面量访问，动态/对象访问在浏览器里是 `undefined`。现有 `lib/config/env.ts` 已按这个方式读 `NEXT_PUBLIC_SERVER_URL`，本次沿用。
- 所有 `.env*` 文件均被忽略，**仓库里不会出现任何真实 DSN**；schema 里只声明变量名与类型。
- server 与 web 使用**两个不同的 Sentry 项目/DSN**，不要填同一个。
- 环境名取 `NODE_ENV`（线上恒为 `production`），本次不引入 `SENTRY_ENVIRONMENT`；将来要区分预发环境再加。
- 其余部署文档要同步更新：`docs/frontend/cloudflare-deployment.md`（CI 必需变量清单、构建期变量说明）、根 `README.md` 的 env 文件表。

## 5. 依赖关系

### 5.1 内部依赖
`apps/server → packages/shared`（脱敏）；`apps/web → packages/shared`（脱敏，`transpilePackages` 已包含 shared）。依赖方向不变。

### 5.2 外部依赖
Sentry SaaS（免费档 Developer）。网络出口：server 在 mac-mini 的 Docker 内访问 `*.ingest.sentry.io:443`，需确认出站可达（见风险 R-3）。

### 5.3 新增依赖

| 包名 | 版本约束 | 用途 | 归属 Track |
| --- | --- | --- | --- |
| `@sentry/node` | 最新稳定大版本（apply 时用 `pnpm add` 解析；需遵守 `pnpm-workspace.yaml` 的 `minimumReleaseAge`，版本不够老则选满足冷却期的最近版） | server 报错收集 | infra（主 agent 安装） |
| `@sentry/nextjs` | 同上；需兼容 Next ^16.3 / React 19 | web 浏览器端报错收集 | infra（主 agent 安装） |

> 两个包分别写进 `apps/server/package.json`、`apps/web/package.json`。若 `pnpm-workspace.yaml` 用 `catalog:` 统一管理，则按现有约定处理。

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- |
| R-1 脱敏漏项导致隐私泄露 | 中 | 高 | 默认不收 PII + 删请求体/头/Cookie；`scrubSentryEvent` 失败即丢弃；每条规则都有单测（AC-014～019）；上线后在 Sentry 里抽查几条事件 |
| R-2 `@sentry/nextjs` 不经 `withSentryConfig` 在 Next 16 / Turbopack / OpenNext 下构建或运行异常 | 中 | 中 | T-005 要求跑 `build:cloudflare`；退路见「设计假设」第一行；QA 里用假 DSN 验证 envelope 发出 |
| R-3 mac-mini Docker 出站访问 Sentry 被拦 | 低 | 中 | 部署清单里加一条 `curl -I https://o0.ingest.sentry.io`（任意 ingest 域名）自检；SDK 发送失败不影响业务 |
| R-4 免费档额度被噪声耗尽 | 中 | 低 | 已知 4xx/503 不报；web 噪声过滤；Sentry 控制台配置「同问题限速」告警规则 |
| R-5 `NEXT_PUBLIC_SENTRY_DSN` 是构建期内联，忘配构建环境变量 → 线上静默不报 | 中 | 中 | 部署清单明确写出（`cloudflare-deployment.md` 的 CI 变量清单也要加）；验收要求线上手动触发一次探针错误确认到达 |
| R-7 web 误用 varlock `ENV` 对象读 DSN → 浏览器里恒为空，静默不启用 | 中 | 中 | 设计已规定走 `lib/config/env.ts` 的字面量访问；T-005 加单测/构建产物检查：带 DSN 构建后 client chunk 中能搜到该值 |
| R-6 Sentry 初始化放 `index.ts` 首句，之前被 import 的模块里抛的异常收不到 | 低 | 低 | 可接受；启动期异常已有现有 `process.exit` 路径和日志 |

## 7. 实施计划

> 执行方式：**并行开发**（用户指定）。依赖安装与共享脱敏函数先由主 agent 完成，随后 server 与 web 两条线由 backend / frontend 角色并行；两端无运行时接口依赖（契约 `none`），写入文件不相交。具体阶段划分与并行约束见 tasks.md「并行开发计划」。

### Phase 1: 基础
- [ ] 依赖安装（infra）
- [ ] 共享脱敏函数（shared）

### Phase 2: 接入
- [ ] server：env schema + `initSentry`
- [ ] server：错误处理器 + app + index 接线
- [ ] web：env schema + 初始化 + 选项构造
- [ ] web：错误边界上报
- [ ] 文档与 Sentry 控制台清单（infra）

### Phase 3: 验证
- [ ] server 集成测试（Sentry 传输层 mock）
- [ ] 浏览器验收（假 DSN + 拦截 ingest）

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-10-24 | 把 09 拆为 Sentry → Telegram → 探测/心跳三个迭代 | 用户认为一次做完太大 |
| 2026-10-24 | 先只接通用报错，不接业务事件 | 避免触碰 `market/`、`jobs/`、`engine-host/`、`auth/`；业务状态以后由 `/health` + 心跳覆盖 |
| 2026-10-24 | 不报已知 503 | 行情降级期间会每个请求一条，直接耗尽免费额度；与 `/health` 职责重叠 |
| 2026-10-24 | 本次不动 `wrangler.jsonc` / Dockerfile / compose | 降低部署风险，Worker 端放后续 |
| 2026-10-24 | 脱敏失败丢事件而不是放行 | 与根 CLAUDE.md「宁可说做不到，不要编数字」同一取向：宁可少报，不泄露 |
