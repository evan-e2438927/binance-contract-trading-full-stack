# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/
- **生成时间**: 2026-10-24
- **基于设计**: design.md

## 任务总览

| Phase | 任务数 | 总工时 |
| --- | --- | --- |
| Phase 1: 基础 | 2 | 3h |
| Phase 2: 接入 | 5 | 9h |
| Phase 3: 验证 | 2 | 4h |
| **合计** | **9** | **16h** |

## 任务 Track 汇总（按角色视图）

| Track | 任务数 | 总工时 | 任务 ID |
| --- | --- | --- | --- |
| frontend | 2 | 4h | T-005, T-006 |
| backend | 2 | 4h | T-003, T-004 |
| shared | 1 | 2h | T-002 |
| infra | 2 | 3h | T-001, T-007 |
| unit-test | 1 | 1h | T-008 |
| qa | 1 | 2h | T-009 |
| **合计** | **9** | **16h** | |

## 并行开发计划

推荐运行：`/sdlc-workflow:sdlc-apply docs/iterations/2026-10-24/001-sentry-error-monitoring-feature --agents multi`（`AGENT_MODE=auto` 下本迭代同时有 frontend 与 backend 任务，也会自动走 multi）。

```
阶段 A（主 agent，串行，⑥.1 基础）   T-001 装依赖 ─┐
                                    T-002 共享脱敏 ─┴─► 完成后才分叉
阶段 B（并行，两个角色子 agent）
  backend 角色：T-003 → T-004        目录：apps/server/src/**
  frontend 角色：T-005 → T-006       目录：apps/web/src/**
阶段 C（主 agent，B 全部完成后）     T-007 文档/部署清单（需要 T-003、T-005 的最终变量名）
阶段 D（test 角色）                  T-008 server 集成测试
阶段 E（qa 命令，apply 之外）         T-009
```

为什么可以并行、不会互相踩：
- **接口依赖全部落在阶段 A**：两条线共同依赖的只有 `scrubSentryEvent`（T-002）和 npm 依赖（T-001）。T-002 是真实代码，B 阶段两个角色直接 import，不需要 mock 或等对方。
- **没有跨端运行时依赖**：无 HTTP/WS 接口变化（design 契约形态 `none`），web 与 server 互不调用对方的新代码。
- **写入文件不相交**：backend 只写 `apps/server/**`，frontend 只写 `apps/web/**`；`package.json`、`pnpm-lock.yaml`、`packages/shared/**` 只在阶段 A 由主 agent 写，B 阶段两个角色都不碰（避免 lockfile 冲突与越界守卫拦截）。
- **各自生成的 `env.ts` 互相独立**：server 与 web 各自跑 `varlock codegen`，生成物在各自 app 内。
- **构建验证互不影响**：T-005 的 `build:cloudflare` 只动 `apps/web/.next`、`.open-next`；T-004 的测试只在 server 内跑。

并行约束（实现时必须遵守）：
- backend/frontend 角色**不得修改** `package.json`、lockfile、`packages/shared/**`；需要新依赖或脱敏规则变更，写进汇报让主 agent 处理
- 阶段 B 里 `T-003`/`T-005` 声明的环境变量名（`SENTRY_DSN`、`SENTRY_RELEASE`、`NEXT_PUBLIC_SENTRY_DSN`）已在 design 4.4 固定，不得改名；改名需先回写 design.md
- T-007 必须等 B 阶段结束再做，避免文档里的变量名与最终代码不一致

> 路径说明：`packages/shared` 不在 `track-paths.md` 默认列表里，按 `.claude/EXISTING_STRUCTURE.md` 的实际布局归 shared Track；`docs/` 与根 `package.json`/lockfile 归 infra。单测按 workspace 镜像放在 `tests/unit/{web,server,packages/shared}/`（用户 2026-10-24 决定，覆盖 `.claude/CODING_GUIDELINES.md` 的「同目录共存」，仅限本迭代新增测试），随各实现任务交付；各 workspace 的 vitest 已同时收 `src/**` 与对应的 `tests/unit/` 目录。

## Phase 1: 基础

### [x] T-001: 安装 Sentry 依赖

**描述**: 给 server 加 `@sentry/node`，给 web 加 `@sentry/nextjs`，更新 lockfile。由主 agent 统一执行，开发角色不改 package.json。

**目标文件**:
- apps/server/package.json
- apps/web/package.json
- pnpm-lock.yaml

**Track**: infra

**适用规范**: `pnpm-workspace.yaml` 的 `minimumReleaseAge` 冷却期；若用 `catalog:` 则按现有约定

**Requirement IDs**:
- R-001
- R-002

**验收标准**:
- [x] **AC-020a** (happy-path): Given 依赖已安装，When 运行 `pnpm install --frozen-lockfile`，Then 退出码 0，且 `apps/server/package.json` 含 `@sentry/node`、`apps/web/package.json` 含 `@sentry/nextjs`
- [x] **AC-020b** (boundary): Given 新增依赖，When 运行 `pnpm --filter server... install --frozen-lockfile --ignore-scripts`（Dockerfile 里的同款命令），Then 退出码 0（不会因为 workspace 过滤而缺包）

**依赖关系**: 无

**复杂度**: S

**预估工时**: 1h

---

### [x] T-002: 共享脱敏函数 `scrubSentryEvent`

**描述**: 在 `packages/shared` 实现纯函数脱敏，server 与 web 共用。不 import `@sentry/*`，用结构类型。任何异常返回 `null`。

**目标文件**:
- packages/shared/src/sentry-scrub.ts
- tests/unit/packages/shared/sentry-scrub.test.ts
- packages/shared/src/index.ts

**Track**: shared

**适用规范**: 根 CLAUDE.md —— shared 零依赖；无 `Date.now()`/`console.*`。`frontend-code-standards-ts` —— 判断里不写字面量，关键正则与键名抽成常量，导出函数写 TSDoc 与 `@example`

**Requirement IDs**:
- R-003

**验收标准**:
- [x] **AC-014** (security): Given `request.headers` 含 `Authorization`/`cookie`/`Set-Cookie`（混合大小写）和 `request.cookies`，When `scrubSentryEvent`，Then 三个头与 cookies 被删除，`User-Agent` 保留
- [x] **AC-015** (security): Given `request.data={code:"123456"}`、`query_string="token=a&code=1&signature=s&email=e&state=x&page=2"`、`user={id:"1",email:"a@b.com"}`，When `scrubSentryEvent`，Then `request.data` 与 `user` 不存在，`query_string` 为 `token=[Filtered]&code=[Filtered]&signature=[Filtered]&email=[Filtered]&state=[Filtered]&page=2`
- [x] **AC-016** (security): Given `message`/`exception.values[0].value`/`breadcrumbs[0].message` 均含 `alice@example.com`，When `scrubSentryEvent`，Then 三处都变为 `[email]`
- [x] **AC-017** (security): Given 文本含 `0x1234567890abcdef1234567890abcdef12345678` 和一个 44 位 base58 Solana 地址，When `scrubSentryEvent`，Then 前者变为 `0x1234…5678`，后者变为「前 6 + … + 后 4」
- [x] **AC-018** (error): Given `exception.values` 不是数组而是对象（使遍历抛错），When `scrubSentryEvent`，Then 返回 `null` 且不抛出
- [x] **AC-019** (boundary): Given `{}` 或只有 `message`，When `scrubSentryEvent`，Then 原样返回，不凭空增加字段

**依赖关系**: 无

**复杂度**: M

**预估工时**: 2h

---

## Phase 2: 接入

### [x] T-003: server 环境变量与 `initSentry`

**描述**: 在 `apps/server/.env.schema` 声明 `SENTRY_DSN`、`SENTRY_RELEASE`（均可选），重新生成 `env.ts`；新建 `observability/sentry.ts` 实现 `initSentry`、`ErrorReporter`。无 DSN 返回 `null`。

**目标文件**:
- apps/server/.env.schema
- apps/server/src/env.ts
- apps/server/src/observability/sentry.ts
- tests/unit/server/observability/sentry.test.ts

**Track**: backend

**适用规范**: `.claude/CODING_GUIDELINES.md` —— 测试放 `tests/unit/` 镜像目录；`env.ts` 由 `pnpm run env:generate` 生成，禁止手改

**Requirement IDs**:
- R-001
- R-004

**验收标准**:
- [x] **AC-004** (happy-path): Given 传入 dsn，When `initSentry`，Then `Sentry.init` 被调用 1 次，参数 `sendDefaultPii:false`（v11 类型里已无此项，保留为兼容）且 `dataCollection` 的 userInfo/cookies/httpHeaders/urlQueryParams 为 false、httpBodies 为 `[]`，`tracesSampleRate` 为 0、未设置 `defaultIntegrations:false`、`beforeSend` 为调用 `scrubSentryEvent` 的函数
- [x] **AC-005** (boundary): Given dsn 为 `undefined` 或 `""`，When `initSentry`，Then 返回 `null` 且 `Sentry.init` 调用 0 次
- [x] **AC-007** (error): Given `Sentry.captureException` 抛出异常，When `reporter.report(err,{method:"GET",path:"/x"})`，Then 不向外抛出
- [x] **AC-001a** (happy-path): Given 已启用，When `reporter.report(err,{method:"GET",path:"/orders"})`，Then `captureException` 被调用 1 次，带 `method`、`path` 两个 tag，不含查询串或 body
- [x] **AC-020c** (happy-path): Given 不设置这两个变量，When 运行 `pnpm --filter server run check-types`，Then 通过（注：`packages/db/src/brackets/diff.ts` 有 4 条既有类型错误，非本迭代引入；本迭代文件 0 错误）

**依赖关系**: T-001, T-002

**复杂度**: M

**预估工时**: 2h

---

### [x] T-004: server 错误处理器上报与进程接线

**描述**: `createErrorHandler` 增加可选 `reportError` 回调，仅对非 `AppError` 调用；`AppDeps` 透传；`index.ts` 启动时初始化、SIGTERM 退出前 `flush(2000)`。同时 grep 确认没有用 `AppError("INTERNAL_ERROR")` 包装意外错误的代码路径（见设计假设最后一行）。

**目标文件**:
- apps/server/src/http/respond.ts
- tests/unit/server/http/respond.test.ts
- apps/server/src/app.ts
- apps/server/src/index.ts

**Track**: backend

**适用规范**: 根 CLAUDE.md —— HTTP 响应体不变；`bigint` 不进 JSON（本任务不涉及）

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): Given handler 抛 `new Error("boom")` 且传入了 `reportError`，When 请求，Then 响应 500 + `{ok:false,error:{code:"INTERNAL_ERROR",message:"服务器内部错误，请稍后重试"}}`；`reportError` 被调用 1 次，第二参数 `{method:"GET",path:"/x"}`
- [x] **AC-002** (error): Given handler 抛 `AppError("INVALID_PARAMS")` / `AppError("UNAUTHORIZED")`，When 请求，Then 状态码 400 / 401 与现状一致，`reportError` 调用 0 次
- [x] **AC-003** (boundary): Given handler 抛 `AppError("MARKET_NOT_READY")` 与 `AppError("SERVICE_UNAVAILABLE")`，When 请求，Then 状态码 503，`reportError` 调用 0 次
- [x] **AC-007a** (error): Given `reportError` 自己抛异常，When 处理意外错误，Then 响应仍为 500 + `INTERNAL_ERROR`，`logger.error` 被额外调用 1 次记录上报失败
- [x] **AC-005a** (boundary): Given 不传 `reportError`（旧调用方 `createErrorHandler(logger)`），When 意外错误，Then 行为与改动前完全一致
- [x] **AC-006** (boundary): Given Sentry 已启用并收到 SIGTERM，When 执行退出流程，Then `flush(2000)` 在 `process.exit(0)` 之前被调用；未启用时不调用 `flush`，退出流程与现状一致

**依赖关系**: T-003

**复杂度**: M

**预估工时**: 2h

---

### [x] T-005: web 环境变量与浏览器端初始化

**描述**: `apps/web/.env.schema` 声明 `NEXT_PUBLIC_SENTRY_DSN`（`@optional @public @type=url`），重新生成 `env.ts`；新增 `lib/sentry/constants.ts`、`client-options.ts`（纯函数构造选项）和 `src/instrumentation-client.ts`（有 DSN 才 `Sentry.init`）。要求本任务做完后跑一次 `build:cloudflare` 并把 client 首屏 JS 体积变化记入 apply 报告（NFR-004）。

**目标文件**:
- apps/web/.env.schema
- apps/web/src/env.ts
- apps/web/src/lib/config/env.ts
- apps/web/src/instrumentation-client.ts
- apps/web/src/lib/sentry/constants.ts
- apps/web/src/lib/sentry/client-options.ts
- tests/unit/web/lib/sentry/client-options.test.ts

**Track**: frontend

**适用规范**: `frontend-code-standards-ts` —— 常量集中到 `constants.ts`（忽略的错误文案、扩展协议前缀、`sendDefaultPii` 等）；导出函数写 TSDoc；不用字面量做判断

**Requirement IDs**:
- R-002
- R-004

**验收标准**:
- [x] **AC-011** (boundary): Given `buildSentryClientOptions({dsn,environment,origin:"https://trade.example.org"})`，When 检查返回值，Then `ignoreErrors` 含 `ResizeObserver loop limit exceeded` 与 `ResizeObserver loop completed with undelivered notifications`；`allowUrls` 恰为 `["https://trade.example.org"]`（取入参 origin，源码中不出现 `coinbasis.org`）；`denyUrls` 含 `chrome-extension://`、`moz-extension://`、`safari-extension://` 对应的正则
- [x] **AC-004a** (security): Given 同上，When 检查返回值，Then `sendDefaultPii===false` 且 `dataCollection` 全关（userInfo/cookies/httpHeaders/urlQueryParams 为 false、httpBodies 为 `[]`）、`tracesSampleRate===0`、无 `replaysSessionSampleRate`/`replaysOnErrorSampleRate` 非零值、`beforeSend` 调用 `scrubSentryEvent`
- [x] **AC-013a** (boundary): Given `NEXT_PUBLIC_SENTRY_DSN` 为空，When 加载 `instrumentation-client.ts`，Then `Sentry.init` 调用 0 次
- [x] **AC-020d** (happy-path): Given 不配置该变量，When 运行 `pnpm --filter web run check-types` 与 `pnpm --filter web run build:cloudflare`，Then 均通过
- [x] **AC-020e** (boundary): Given 构建时设置 `NEXT_PUBLIC_SENTRY_DSN=https://pub@o0.ingest.sentry.io/0`，When 构建后在 `.next/static` 产物中搜索 `o0.ingest.sentry.io`，Then 至少命中 1 个 client chunk（证明被内联，没有误用 varlock `ENV` 对象）；不设该变量构建时命中 0 个
- [x] **AC-020f** (happy-path): Given `lib/config/env.ts`，When 检查新增的 `SENTRY_DSN`，Then 以字面量 `process.env.NEXT_PUBLIC_SENTRY_DSN` 读取，未设置时为 `""`，与同文件 `REOWN_PROJECT_ID` 写法一致

**依赖关系**: T-001, T-002

**复杂度**: M

**预估工时**: 2h

---

### [x] T-006: web 错误边界上报

**描述**: 新增 `reportRenderError`（内部 try/catch，永不抛），在 `error.tsx` 与 `global-error.tsx` 现有 `useEffect` 里调用，保留 `console.error`。兜底 UI 文案、按钮、样式不变。

**目标文件**:
- apps/web/src/lib/sentry/report-render-error.ts
- tests/unit/web/lib/sentry/report-render-error.test.ts
- apps/web/src/app/error.tsx
- apps/web/src/app/global-error.tsx
- tests/unit/web/app/error.test.tsx

**Track**: frontend

**适用规范**: `frontend-code-standards-ts` —— `useEffect` 写业务含义注释（「把渲染崩溃报给 Sentry，便于排查线上白屏」）；digest tag 名用常量

**Requirement IDs**:
- R-002

**验收标准**:
- [x] **AC-008** (happy-path): Given 渲染 `<AppError error={Object.assign(new Error("x"),{digest:"abc"})} reset={fn}/>`，When 挂载，Then `captureException` 被调用 1 次且 tag `digest==="abc"`；页面含文字「页面出错了」「重试」「返回首页」
- [x] **AC-009** (happy-path): Given 渲染 `<GlobalError .../>`，When 挂载，Then `captureException` 被调用 1 次；含「页面出错了」与「重试」按钮
- [x] **AC-010** (ui-state): Given `captureException` 抛出异常，When 挂载错误边界，Then 组件不抛异常、兜底文案与「重试」按钮仍渲染，点击「重试」调用 `reset` 1 次
- [x] **AC-008a** (boundary): Given error 没有 `digest`，When 挂载，Then `captureException` 被调用 1 次且不带 `digest` tag

**依赖关系**: T-005

**复杂度**: M

**预估工时**: 2h

---

### [x] T-007: 文档更新与 Sentry 控制台配置清单

**描述**: 更新 `docs/design/09-monitoring.md`（顶部状态注明已拆三个迭代、本迭代范围；第 3 层补「本迭代实际做法」及 ASM-002～005 取舍）；新增 Sentry 配置清单一节：注册建两个项目（server 用 Node、web 用 Next.js）、DSN 填到哪（server 写 `apps/server/.env.docker` 的 `SENTRY_DSN`；web 写 Cloudflare 构建环境的 `NEXT_PUBLIC_SENTRY_DSN`，构建期内联需重新部署）、三条告警规则（新问题首次出现→邮件；同一问题 1 小时 >50 次→邮件）、部署后出站自检 `curl`、上线后手动触发探针错误确认到达。更新 `docs/design/README.md` 的 09 行描述为「分三个迭代」。

**目标文件**:
- docs/design/09-monitoring.md
- docs/design/README.md
- docs/frontend/cloudflare-deployment.md
- README.md

**Track**: infra

**适用规范**: 无（文档）。注意 09 里原先「418/429 和落库失败一出现就发」的规则本次不适用，需标注「待业务事件迭代」

**Requirement IDs**:
- R-004

**验收标准**:
- [x] **AC-021** (happy-path): Given 文档已更新，When `grep -n "迭代" docs/design/09-monitoring.md`，Then 顶部状态段含三个迭代的划分表；第四节「第 3 层」下含「本迭代实际做法」小节，逐条列出 ASM-002～005；存在 Sentry 配置清单小节且含 `SENTRY_DSN`、`NEXT_PUBLIC_SENTRY_DSN` 两个变量名
- [x] **AC-021b** (happy-path): Given 部署文档，When 查看 `docs/frontend/cloudflare-deployment.md`，Then 本机构建段示例含 `NEXT_PUBLIC_SENTRY_DSN`（标注可选、构建期内联、改后需重新 `deploy:web`），CI 变量清单也列出它；根 `README.md` 的 env 文件表在 `apps/server/.env.docker` 与 `apps/web/.env.production` 两行注明可选的 Sentry 变量，且注明 server 与 web 用不同 DSN
- [x] **AC-021a** (boundary): Given 文档，When 全文搜索 `ingest.sentry.io`，Then 只出现在「出站自检」说明里且不含真实 DSN（形如 `https://<key>@…` 的字符串 0 个）

**依赖关系**: T-003, T-005

**复杂度**: S

**预估工时**: 1h

---

## Phase 3: 验证

### [x] T-008: server 集成测试 —— 端到端脱敏与过滤

**描述**: 用 Sentry 的测试传输层（自定义 `transport`）搭一个 Hono 应用：抛意外异常，断言最终捕获到的事件已脱敏、4xx/503 不产生事件。补齐各任务单测之间没覆盖的「装配后」行为。

**目标文件**:
- tests/unit/server/observability/sentry.integration.test.ts

**Track**: unit-test

**适用规范**: 无；沿用 vitest

**Requirement IDs**:
- R-001
- R-003

**验收标准**:
- [x] **AC-001b** (happy-path): Given 真实 `initSentry`（传输层替换为内存收集器）+ `createApp` 风格路由，When 请求一个抛 `Error("boom 0x1234567890abcdef1234567890abcdef12345678")` 的路由并带 `Authorization: Bearer x` 与 `Cookie: a=b`，Then 收集器收到 1 个事件，序列化后不含 `Bearer x`、`a=b`、完整钱包地址，含 `0x1234…5678`
- [x] **AC-002a** (error): Given 同一应用，When 请求抛 `AppError("INVALID_PARAMS")` 的路由，Then 收集器事件数为 0
- [x] **AC-003a** (boundary): Given 同一应用，When 请求抛 `AppError("MARKET_NOT_READY")` 的路由，Then 收集器事件数为 0，响应 503

**依赖关系**: T-004

**复杂度**: M

**预估工时**: 1h

---

### [ ] T-009: 浏览器验收 —— 假 DSN 下探针错误到达与无 DSN 不发送

**描述**: 只写验收规格，脚本由 `qa` 命令生成。用 `NEXT_PUBLIC_SENTRY_DSN=https://pub@o0.ingest.sentry.io/0` 构建/启动 web，Playwright 拦截 `**/*.ingest.sentry.io/**` 请求；另用一次不带 DSN 的构建验证零请求。

**目标文件**:
- tests/e2e/sentry-error-monitoring/E2E-001.e2e.ts

**Track**: qa

**适用规范**: 无

**Requirement IDs**:
- R-002
- R-004

**验收标准**:
- [ ] **AC-012** (happy-path): Given 带假 DSN 的构建已启动，When 打开 `/` 后 `page.evaluate(() => Promise.reject(new Error("e2e-sentry-probe")))`，Then 拦截到 ≥1 个 POST 到 `*.ingest.sentry.io` 的 envelope 请求，请求体文本含 `e2e-sentry-probe`，且请求头/体中不含 `Authorization`
- [ ] **AC-013** (boundary): Given 不带 DSN 的构建已启动，When 同样触发未处理拒绝并等待 3 秒，Then 发往 `*.ingest.sentry.io` 的请求数为 0
- [ ] **AC-010b** (ui-state): Given 带假 DSN 的构建且 ingest 请求被 `route.abort()`，When 触发未处理拒绝，Then 页面仍可正常交互（首页主要元素可见），无白屏

**依赖关系**: T-006

**复杂度**: M

**预估工时**: 2h

---

## 依赖关系图

```
T-001 ──┬── T-003 ── T-004 ── T-008
        │      └──────┐
T-002 ──┼── T-003     │
        └── T-005 ── T-006 ── T-009
                 └────┴── T-007
```

## 任务执行顺序

1. 阶段 A：T-001、T-002（无前置，主 agent 完成）
2. 阶段 B：backend（T-003 → T-004）与 frontend（T-005 → T-006）**并行**，各自串行
3. 阶段 C：T-007，在 T-003、T-005 之后（实际等阶段 B 结束）
4. 阶段 D：T-008，在 T-004 之后
5. 阶段 E：T-009，在 T-006 之后，由 qa 命令执行
