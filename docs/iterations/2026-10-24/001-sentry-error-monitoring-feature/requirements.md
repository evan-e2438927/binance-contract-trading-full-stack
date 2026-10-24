# 需求文档

## 基本信息

- **采集时间**: 2026-10-24
- **迭代序号**: 001
- **输入类型**: text（对话）+ 设计文档 `docs/design/09-monitoring.md`
- **变更类型**: feature
- **Slug**: sentry-error-monitoring
- **业务优先级**: P1(高)
- **技术风险**: 中（引入第三方 SDK；隐私脱敏必须做对）
- **Change Size**: Medium

## 原始需求

> 我看了一下 09-monitoring.md 我感觉这个需求太大啦，我想拆成多个需求来开发，先接入 sentry 再接入 tg，然后再接入探测之类的。

即把 `09-monitoring.md` 拆成三个迭代，按顺序做：

| 迭代 | 内容 | 对应 09 的章节 |
| --- | --- | --- |
| **本迭代（001）** | 接入 Sentry 报错收集（server + web） | 第四节「第 3 层」 |
| 后续 002 | 告警通知接入 Telegram（Better Stack / Sentry / Cloudflare 的 Webhook 转发） | 第五节末尾 + 第九节待决 1 |
| 后续 003+ | 外部探测（`/health` + Better Stack 探测）、心跳（H1～H5）、对账任务、Cloudflare 自带三项 | 第四节「第 1、2 层」+ 附加 |

本文件只覆盖 001。

## 需求摘要

让线上程序报错自动汇总到 Sentry：服务端未预期的异常、浏览器端页面崩溃，都能看到「哪里坏了、坏在哪一类」，且不带出用户隐私。

## 澄清结论（已向用户提问，provenance=asked）

| ID | 问题 | 用户选择 | 状态 |
| --- | --- | --- | --- |
| ASM-001 | 接入范围 | server + web 都接 | [✅ 已确认（用户选择）] |
| ASM-002 | web 的 Worker 端（SSR 报错）是否一起接 | **只接浏览器端 + error 边界**；不改 `compatibility_date`、不自写 worker 入口 | [✅ 已确认（用户选择）] |
| ASM-003 | source map 上传 | **本次不做**，先看压缩后的栈 | [✅ 已确认（用户选择）] |
| ASM-004 | server 业务事件（418/429、落库失败、资金费跳过、degraded、开户失败） | **本次只做通用报错**：未捕获异常 + 意外 5xx；业务事件留到后续迭代 | [✅ 已确认（用户选择）] |
| ASM-005 | 已知 503（`MARKET_NOT_READY`、`SERVICE_UNAVAILABLE`）是否上报 | **不报**，只报意外错误（非 `AppError`，即返回 `INTERNAL_ERROR` 500） | [✅ 已确认（用户选择）] |

## 需求详情

- **R-001**: server 把「意外错误」上报到 Sentry —— 未捕获异常、未处理的 Promise 拒绝、HTTP 请求处理中抛出的非 `AppError` 异常。业务可预期的错误（4xx、已知 503）不报。 [✅ 已确认]
- **R-002**: web 浏览器端把页面崩溃上报到 Sentry —— `error.tsx`、`global-error.tsx` 捕获的渲染错误，以及浏览器全局的未捕获异常/未处理拒绝；并过滤已知噪声（钱包插件、`ResizeObserver loop`、非本站脚本）。 [✅ 已确认]
- **R-003**: 上报前统一脱敏 —— 去掉认证头、Cookie、请求体、敏感查询参数、用户信息；邮箱打码；钱包地址只留前 6 后 4。脱敏逻辑 server 与 web 共用同一份（放 `packages/shared`）。 [✅ 已确认]
- **R-004**: 可选接入、不影响开发与现有部署 —— 没配 DSN 就完全不启用（不初始化、不发网络请求）；DSN 走环境变量；不开性能追踪和 Session Replay；配置与运维说明（含 Sentry 控制台告警规则的手动配置步骤）落到文档。 [✅ 已确认]

## 验收标准

### R-001 · server 报错收集

### AC-001: 意外异常被上报（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 配置了 `SENTRY_DSN`，某路由 handler 抛出普通 `Error("boom")`（非 `AppError`）
- **When**: 客户端请求该路由
- **Then**: 响应仍是 500 + `{ ok:false, error:{ code:"INTERNAL_ERROR", message:"服务器内部错误，请稍后重试" } }`（与现状逐字一致）；上报函数被调用 1 次，参数带该 `Error` 对象和 `method`、`path`（不含查询串）
- **验证方式**: unit

### AC-002: 4xx 业务错误不上报（Error）
- **关联需求**: R-001
- **场景维度**: error
- **Given**: handler 抛出 `AppError("INVALID_PARAMS")`（HTTP 400）或 `AppError("UNAUTHORIZED")`（401）
- **When**: 客户端请求
- **Then**: 响应与现状一致；上报函数调用 0 次
- **验证方式**: unit

### AC-003: 已知 503 不上报（Boundary）
- **关联需求**: R-001
- **场景维度**: boundary
- **Given**: handler 抛出 `AppError("MARKET_NOT_READY")` 或 `AppError("SERVICE_UNAVAILABLE")`（均 503）
- **When**: 客户端请求
- **Then**: 响应状态码 503 且 body 与现状一致；上报函数调用 0 次
- **验证方式**: unit

### AC-004: 进程级异常被收集（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 初始化后的 Sentry 配置
- **When**: 检查传给 `Sentry.init` 的参数
- **Then**: 未关闭默认的 `onUncaughtException` / `onUnhandledRejection` 集成（即未用 `defaultIntegrations: false`，也未过滤掉这两项）；`tracesSampleRate` 为 0 或不设；`sendDefaultPii` 为 `false`，且 `dataCollection` 关闭用户信息、Cookie、请求头、请求体、查询串收集（@sentry v11 取代 sendDefaultPii 的选项）
- **验证方式**: unit

### AC-005: 没配 DSN 完全不启用（Boundary）
- **关联需求**: R-001, R-004
- **场景维度**: boundary
- **Given**: `SENTRY_DSN` 未设置或为空串
- **When**: server 启动并处理一个会抛意外异常的请求
- **Then**: `Sentry.init` 未被调用；`initSentry` 返回 `null`；错误处理器照常返回 500 且不抛二次异常
- **验证方式**: unit

### AC-006: 退出前冲刷队列（Boundary）
- **关联需求**: R-001
- **场景维度**: boundary
- **Given**: 已启用 Sentry，进程收到 `SIGTERM`
- **When**: 执行现有的优雅退出流程
- **Then**: 在 `process.exit(0)` 之前调用 `flush`/`close`，最长等待 2000ms；超时不阻塞退出；没启用 Sentry 时退出流程与现状一致
- **验证方式**: unit

### AC-007: 上报失败不影响请求（Error）
- **关联需求**: R-001
- **场景维度**: error
- **Given**: 上报函数自己抛异常（如 SDK 内部错误）
- **When**: 错误处理器处理一个意外异常
- **Then**: 异常被吞掉（记一行 `logger.error`），响应仍是 500 + `INTERNAL_ERROR`
- **验证方式**: unit

### R-002 · web 报错收集

### AC-008: error.tsx 上报渲染错误（Happy Path）
- **关联需求**: R-002
- **场景维度**: happy-path
- **Given**: 配置了 `NEXT_PUBLIC_SENTRY_DSN`，某页面渲染时抛错，`error.tsx` 接住
- **When**: 组件挂载
- **Then**: `Sentry.captureException(error)` 被调用 1 次；error 带 `digest` 时作为 tag `digest` 附上；页面仍显示「页面出错了」+「重试」+「返回首页」，文案不变
- **验证方式**: unit

### AC-009: global-error.tsx 上报根布局错误（Happy Path）
- **关联需求**: R-002
- **场景维度**: happy-path
- **Given**: 根布局崩溃，`global-error.tsx` 接住
- **When**: 组件挂载
- **Then**: `Sentry.captureException(error)` 被调用 1 次；兜底页「页面出错了」+「重试」按钮仍渲染
- **验证方式**: unit

### AC-010: 上报被拦截不影响兜底页（UI State）
- **关联需求**: R-002
- **场景维度**: ui-state
- **Given**: 用户装了广告拦截，或 `captureException` 自己抛异常
- **When**: 错误边界挂载
- **Then**: 兜底页正常渲染，「重试」按钮可点击，控制台最多多一行 warning，不出现第二层白屏
- **验证方式**: unit

### AC-011: 噪声过滤（Boundary）
- **关联需求**: R-002
- **场景维度**: boundary
- **Given**: 初始化参数
- **When**: 检查 `ignoreErrors` / `allowUrls` / `denyUrls`
- **Then**: `ignoreErrors` 含 `ResizeObserver loop` 两种常见文案（`ResizeObserver loop limit exceeded`、`ResizeObserver loop completed with undelivered notifications`）；`allowUrls` 只含本站 origin（取 `window.location.origin`，不写死域名）；`denyUrls` 含 `chrome-extension://`、`moz-extension://`、`safari-extension://`
- **验证方式**: unit

### AC-012: 浏览器全局未处理拒绝被收集（Happy Path）
- **关联需求**: R-002
- **场景维度**: happy-path
- **Given**: 浏览器里加载了带假 DSN 的构建，拦截发往 Sentry ingest 域名的请求
- **When**: 在页面里执行 `Promise.reject(new Error("e2e-sentry-probe"))`
- **Then**: 拦截到一条发往 `*.ingest.sentry.io` 的 envelope，内容含 `e2e-sentry-probe`
- **验证方式**: playwright-mcp

### AC-013: 没配 DSN 不启用（Boundary）
- **关联需求**: R-002, R-004
- **场景维度**: boundary
- **Given**: `NEXT_PUBLIC_SENTRY_DSN` 为空
- **When**: 页面加载并触发一次未处理拒绝
- **Then**: 没有任何发往 `*.ingest.sentry.io` 的请求；`Sentry.init` 未被调用
- **验证方式**: playwright-mcp

### R-003 · 脱敏

### AC-014: 认证头与 Cookie 被删除（Security）
- **关联需求**: R-003
- **场景维度**: security
- **Given**: 事件 `request.headers` 含 `Authorization`、`Cookie`、`Set-Cookie`（大小写不敏感），且有 `request.cookies`
- **When**: 经过 `scrubSentryEvent`
- **Then**: 这三个头和 `request.cookies` 被删除；其它头（如 `User-Agent`）保留
- **验证方式**: unit

### AC-015: 请求体、敏感查询参数、用户信息被清除（Security）
- **关联需求**: R-003
- **场景维度**: security
- **Given**: 事件含 `request.data`（如 `{ code:"123456", email:"a@b.com" }`）、`request.query_string` 含 `token=…&code=…&signature=…&email=…&state=…`、`event.user = { id, email, ip_address }`
- **When**: 经过 `scrubSentryEvent`
- **Then**: `request.data` 被删除；查询串中这些键的值替换为 `[Filtered]`，其它键保留；`event.user` 被删除
- **验证方式**: unit

### AC-016: 邮箱打码（Security）
- **关联需求**: R-003
- **场景维度**: security
- **Given**: `message`、`exception.values[].value`、`breadcrumbs[].message` 中含 `alice@example.com`
- **When**: 经过 `scrubSentryEvent`
- **Then**: 替换为 `[email]`
- **验证方式**: unit

### AC-017: 钱包地址只留前 6 后 4（Security）
- **关联需求**: R-003
- **场景维度**: security
- **Given**: 文本中含 EVM 地址 `0x1234567890abcdef1234567890abcdef12345678` 或 Solana 地址（32～44 位 base58）
- **When**: 经过 `scrubSentryEvent`
- **Then**: 替换为 `0x1234…5678` 形式（前 6 位 + `…` + 后 4 位）；Solana 地址同规则
- **验证方式**: unit

### AC-018: 脱敏自身出错时丢弃事件（Error）
- **关联需求**: R-003
- **场景维度**: error
- **Given**: 事件结构异常（字段类型不对，使脱敏逻辑抛异常）
- **When**: `beforeSend` 调用 `scrubSentryEvent`
- **Then**: 返回 `null`（丢弃该事件，宁可少报也不泄露）；不向外抛异常
- **验证方式**: unit

### AC-019: 空字段不崩（Boundary）
- **关联需求**: R-003
- **场景维度**: boundary
- **Given**: 事件没有 `request`、`user`、`breadcrumbs`、`exception` 中的任意几项
- **When**: 经过 `scrubSentryEvent`
- **Then**: 原样返回（不抛异常，不凭空添加字段）
- **验证方式**: unit

### R-004 · 配置与运维

### AC-020: 环境变量可选且被 schema 声明（Happy Path）
- **关联需求**: R-004
- **场景维度**: happy-path
- **Given**: `apps/server/.env.schema` 与 `apps/web/.env.schema`
- **When**: 运行 `pnpm run env:generate`、`pnpm run check-types`
- **Then**: server 声明 `SENTRY_DSN`、`SENTRY_RELEASE`（均 `@optional`）；web 声明 `NEXT_PUBLIC_SENTRY_DSN`（`@optional @public @type=url`）；不配这些变量时 server 与 web 照常启动、`check-types` 通过
- **验证方式**: unit

### AC-021: 文档与告警规则落地（Happy Path）
- **关联需求**: R-004
- **场景维度**: happy-path
- **Given**: 本迭代完成
- **When**: 查看 `docs/design/09-monitoring.md`
- **Then**: 顶部状态注明已拆为三个迭代及本迭代范围；第四节「第 3 层」更新为「本迭代实际做法」（含 ASM-002～005 的取舍）；新增 Sentry 控制台手动配置清单（建两个项目、DSN 填到哪、三条告警规则）
- **验证方式**: manual

## 非功能性需求

| ID | 类别 | 描述 | 验收指标 |
| --- | --- | --- | --- |
| NFR-001 | 性能 | 上报不能拖慢请求 | 上报调用同步返回（SDK 内部异步发送）；`tracesSampleRate` 为 0，不开 profiling |
| NFR-002 | 安全 | DSN 不是密钥但仍走环境变量；脱敏失败宁可丢弃 | 仓库内 `grep -r "ingest.sentry.io"` 无真实 DSN；AC-018 |
| NFR-003 | 隐私 | 不收集 PII | `sendDefaultPii:false`；不开 Session Replay；AC-014～017 |
| NFR-004 | 体积 | 不显著增大首屏 JS | `build:cloudflare` 产物前后对比，client 首屏 JS 增量记录在 apply 报告中；Worker 体积不变（本次不碰 Worker 入口） |
| NFR-005 | 兼容性 | 不破坏现有部署 | Docker 镜像构建通过；Dockerfile、compose 不改；`wrangler.jsonc` 不改 |

## 需求边界

### 包含 (In Scope)
- `@sentry/node` 接入 server（未捕获异常、未处理拒绝、HTTP 意外 5xx、退出前冲刷）
- `@sentry/nextjs` 接入 web 浏览器端（`instrumentation-client.ts`、`error.tsx`、`global-error.tsx`、噪声过滤）
- 共享脱敏函数 `packages/shared`
- 环境变量声明（varlock schema）
- 更新 `09-monitoring.md`、写 Sentry 控制台配置清单

### 不包含 (Out of Scope)
- Telegram 通知（后续 002）
- `/health` 接口、Better Stack 探测与心跳、对账任务、宿主机脚本（后续 003+）
- Cloudflare 自带三项（Tunnel Health Alert、Workers Logs、Web Analytics）
- Worker/SSR 端报错、`compatibility_date` 调整、自定义 worker 入口（ASM-002）
- source map 上传、`SENTRY_AUTH_TOKEN`（ASM-003）
- 业务事件上报：418/429、引擎落库失败、资金费跳过、行情 degraded、开户失败（ASM-004）
- WS 断线重连 breadcrumb、性能追踪、Session Replay
- 在 Sentry 控制台里实际注册账号/建项目/配告警（人工操作，本迭代只产出清单）

### 未来考虑 (Future Considerations)
- 业务事件接入（需要触碰 `market/`、`jobs/`、`engine-host/`、`auth/`）
- Worker 端 SSR 报错（需先在预览环境验证 `compatibility_date` 升级）
- source map 上传（Docker 构建 + Cloudflare 构建都要注入 `SENTRY_AUTH_TOKEN`）

## UI/UX 约束

- **设计稿**: 无
- **交互规范**: 错误边界的文案、按钮、布局一律不变；上报是纯后台行为，用户无感
- **响应式要求**: 不涉及
- **动画/过渡**: 不涉及

## 变更影响评估

- **Breaking Changes**: 否
- **数据库变更**: 否
- **API 变更**: 否（HTTP 响应逐字不变）
- **配置变更**: 是 —— 新增可选环境变量：server `SENTRY_DSN`、`SENTRY_RELEASE`（容器运行时，写 `apps/server/.env.docker`）；web `NEXT_PUBLIC_SENTRY_DSN`（**构建期内联**，写 `apps/web/.env.production` 或 CI 构建环境，改后需重新部署 web）。三者均可选，不配即不启用；落点与读取方式见 design.md 4.4

## 外部依赖

- 来源: `docs/design/09-monitoring.md`；<https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs>（本次只用到其中「client 端 + instrumentation」部分）
- 内容摘要: web 端 SDK 为 `@sentry/nextjs`；Worker 端要求 `compatibility_date ≥ 2025-08-16`（本次不做）

## 假设记录

| ID | 关联 | 假设内容 | 状态 | 确认人 | provenance |
| --- | --- | --- | --- | --- | --- |
| ASM-001 | R-001/R-002 | server + web 都接 | confirmed | interactive | asked |
| ASM-002 | R-002 | 只接浏览器端 + error 边界 | confirmed | interactive | asked |
| ASM-003 | R-004 | 不做 source map 上传 | confirmed | interactive | asked |
| ASM-004 | R-001 | 只做通用报错，不做业务事件 | confirmed | interactive | asked |
| ASM-005 | R-001 | 已知 503 不上报，只报意外错误 | confirmed | interactive | asked |
| ASM-006 | R-003 | Solana 地址用「32～44 位 base58」正则识别，可能误伤同形态的哈希/ID，误伤的后果仅是日志里多打了码 | pending（技术实现细节，不影响需求语义） | auto-assumed | n/a（非设计决策） |
