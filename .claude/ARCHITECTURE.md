# Architecture

> 本文件由 `/sdlc-workflow:sdlc-init` existing-project intake 基于真实代码填实（2026-09-24）。
> **权威架构文档是 `docs/design/*.md`（尤其 `02-architecture.md`）和根 `CLAUDE.md`**——本文件是给 SDLC
> pipeline 用的浓缩版 + 目录约定，两者冲突时以 `docs/design/` 和根 `CLAUDE.md` 为准，并回来更新本文件。

## 系统概要

币安 U 本位合约**实时模拟交易平台**：用币安真实实时行情，跑一套自研的账户/撮合/风控/清算逻辑，**不产生任何真实下单**，USDT 由服务端模拟发放。唯一用到的币安 API 是只读 Key（服务端同步杠杆分层表）+ 公开行情 WebSocket。

项目类型：**pnpm + Turborepo monorepo**，3 个 app（web / server / native）+ 6 个 package（shared / engine / db / ui / config / infra）。不是单包项目，也不是标准 Better-T-Stack 默认布局——细节见「目录约定」和 `.claude/EXISTING_STRUCTURE.md`。

## 技术栈

| 层 | 技术 | 版本（package.json，2026-09-24 核对） |
| --- | --- | --- |
| Web 前端 | Next.js（App Router）+ React + Tailwind + shadcn/ui | `next@^16.3.4` / `react@^19.2.8` / `tailwindcss` catalog `^4.3.3` |
| Web 状态/数据 | zustand + TanStack Query | `zustand@^5.0.15` / `@tanstack/react-query@^5.103.1` |
| Web 部署 | Cloudflare Workers（OpenNext） | `@opennextjs/cloudflare@^1.20.6` |
| 后端框架 | Hono + @hono/node-server（常驻进程，非 serverless） | `hono@^4.13.7` |
| 后端部署 | VPS（需直连币安） | — |
| 鉴权 | 自研 JWT（HS256，7 天），钱包 SIWE/SIWS 自验签 + 邮箱验证码 + Google OAuth（`arctic`） | `hono/jwt`、`tweetnacl`+`bs58`、`viem@^2.56.5`、`arctic@^3.7.0` |
| ORM / 数据库 | Drizzle → Supabase Postgres | `drizzle-orm` catalog `^0.45.2` |
| 撮合/风控内核 | 自研纯函数引擎（`packages/engine`） | 零外部依赖，只依赖 `packages/shared` |
| 图表 | lightweight-charts | 见 `docs/design/00-overview.md` |
| 构建编排 | Turborepo | `^2.10.12` |
| 包管理 | pnpm workspace + catalog | `11.8.0` |
| 环境变量 | varlock（codegen 出 `src/env.ts`，禁止手改） | catalog |
| 测试 | Vitest（单测/集成，已落地）；Playwright（E2E，**设计中未落地**，见 `.claude/TEST_BASELINE.md`） | — |
| Lint | biome，**仅 `apps/web`** 配置 | — |

## 目录约定

本项目**不是**默认 Better-T-Stack 布局（`packages/env|api|auth|db|infra|ui`），实际布局如下，偏离原因见「目录偏离记录」：

```text
apps/
├── web/          Next.js 16 前端 → Cloudflare Workers
│   └── src/{app,components,hooks,lib,providers,server-api-module,stores}
├── server/       Hono 常驻进程 → VPS
│   └── src/{api,auth,engine-host,http,jobs,market,persistence,routers,testing,ws}
└── native/       Expo，第一版不动，禁止改动

packages/
├── shared/       类型/枚举/错误码/定标换算，零依赖，被所有包依赖
├── engine/       撮合/风控/清算纯逻辑内核，只依赖 shared
├── db/           Drizzle schema + migrations + brackets 同步脚本 → Supabase Postgres
├── ui/           共享 shadcn 组件，被 apps/web 依赖
├── config/       共享 tsconfig（tsconfig.base.json），无业务源码
└── infra/        Alchemy 部署脚本，只管 apps/web
```

落位规则：

- 前端页面/组件/状态 → `apps/web/src/**`；跨端共享 UI → `packages/ui`
- 后端路由/handler/任务/行情订阅 → `apps/server/src/**`；撮合/风控**数值逻辑**必须下沉到 `packages/engine`，不得直接写在 `apps/server`
- 跨端共享类型/枚举/定标换算/错误码 → `packages/shared`，不得在 `apps/web` 和 `apps/server` 各写一份
- **不存在**独立的 `packages/env`（走 varlock 各 app 自生成）、`packages/api`（在 `apps/web/src/server-api-module`）、`packages/auth`（在 `apps/server/src/auth`）——若要新建这几个包，必须先在 `design.md` 明确批准，且要说明为什么现有就地放置方式不够用
- 不新增根目录级 `web/`、`api/`、`server/`、`frontend/`、`backend/`

## 依赖方向（单向，硬约束，见根 `CLAUDE.md`）

```
web    ──► shared
server ──► engine ──► shared
server ──► db     ──► shared
```

`engine` 依赖 `db` 或 `server` 是架构错误，不是"暂时这样"。Gate 1 / Gate 2 都必须检查这一条。

## 模块结构

- **`apps/web`**：页面渲染、前端状态（zustand）、通过 `server-api-module` 调用 `apps/server` 的 REST/WS API。不直接持有任何数据库连接或币安 Key
- **`apps/server`**：唯一的行情消费方（订阅币安 WS，转发给前端，见根 CLAUDE.md「唯一用到的币安 API Key 是只读 Key」）、鉴权（三种登录方式共用 JWT）、撮合引擎宿主（`engine-host/` 把 `packages/engine` 的纯函数接上真实时间/行情/持久化）、定时任务（`jobs/`，资金费结算、杠杆分层同步）
- **`packages/engine`**：账户、撮合、风控、清算的纯逻辑内核。所有输入通过 `EngineInput` 显式传入（含时间戳），产出可重放的事件序列。**禁止**任何形式的 IO 或非确定性调用
- **`packages/shared`**：`Fixed`（bigint 定标数值）类型、舍入规则、枚举、`AppError`、`format()`/`parse()` 序列化边界
- **`packages/db`**：Drizzle schema（含 `ledger_entries` 等资金流水表）、迁移、`brackets/` 杠杆分层数据

禁止跨层直接依赖：`packages/engine` 不得 import 任何 db/网络/文件系统模块；`apps/web` 不得直接 import `packages/db` 或 `packages/engine`。

## 数据流

1. `apps/server` 订阅币安公开 WebSocket 行情（深度 `depth20@100ms`、kline、markPrice），行情事件驱动撮合（不是定时轮询）
2. 撮合/风控/清算逻辑在 `packages/engine` 内以纯函数执行，输出事件序列
3. `apps/server` 的 `persistence/` 把引擎状态和事件落 `packages/db`（Postgres），任何资金变动必须同时写 `ledger_entries`（`balanceAfter` 必填）
4. `apps/server` 的 `ws/` hub 把撮合结果、行情、账户事件转发给 `apps/web`，前端**不直连**币安
5. `apps/web` 通过 `server-api-module` 走 REST 下单/查询，通过 WS 接收实时推送

## 外部依赖

- **币安**：只读 API Key（服务端同步杠杆分层表，`packages/db/src/brackets/`）+ 公开行情 WebSocket。Key 只在 `apps/server`
- **Supabase Postgres**：`packages/db` 部署目标，`DATABASE_URL` 敏感
- **Google OAuth**（`arctic`）：登录方式之一
- **Resend**（可选）：邮箱验证码发信，未配置时开发环境打日志、生产环境该登录方式不可用
- **Cloudflare Workers**：`apps/web` 部署目标

## 部署架构

- `apps/web` → Cloudflare Workers（`@opennextjs/cloudflare` + `packages/infra` 的 Alchemy，`pnpm run deploy`）
- `apps/server` → 独立 VPS 常驻 Node 进程（**不能**部署到 Cloudflare Workers，因为需要常驻撮合引擎 + 长连接 WS + 直连币安）
- `packages/db` → Supabase Postgres，迁移用 `pnpm run db:generate` / `db:migrate`
- 引擎状态：纯内存 + 定期/事件落库，单实例，不引 Redis（重启从库恢复）

## 目录偏离记录

本项目**不采用**模板默认的 Better-T-Stack monorepo 结构（`packages/env|api|auth`），这是既有事实，本轮不重排：

- 环境变量走 `varlock codegen`，每个 app/db 包各自生成 `src/env.ts`（自动生成文件，见文件头 `@ts-nocheck` + "DO NOT EDIT DIRECTLY"），未来若要收敛为共享 `packages/env`，需要先过 `design.md`
- API 客户端类型层在 `apps/web/src/server-api-module`，未抽成共享包
- 鉴权实现在 `apps/server/src/auth`，是服务端专属能力，不需要跨端共享，未来若 `apps/native` 启用同样需要鉴权，再评估是否抽包
- 多出的 `packages/engine` 是本项目核心创新点，**不是**偏离而是主动设计（见根 `CLAUDE.md` 五条硬约束第二条），任何改动都不得破坏它的纯函数约束
