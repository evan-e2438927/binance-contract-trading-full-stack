# Existing Structure

> 由 `/sdlc-workflow:sdlc-init` existing-project intake 生成（2026-09-24），`/sdlc-workflow:update` 阶段二于
> 2026-09-24 增量刷新一次。派生事实文档，随代码漂移由 `/sdlc-workflow:update` 阶段二自动重生成。

## 目录树概览

```
apps/
  web/      Next.js 16 + React 19 + Tailwind 4 + shadcn/ui   → Cloudflare Workers
    src/app/               Next.js App Router 页面
    src/components/        页面级/共享组件（非 packages/ui 的跨端组件）
    src/hooks/              前端 hooks
    src/lib/                前端工具函数
    src/providers/          React context / provider（如 ws-bridge）
    src/server-api-module/  与 apps/server 对接的类型化 API 客户端层
    src/stores/             zustand 状态
    src/env.ts              varlock 生成，禁止手改
  server/   Hono + @hono/node-server（常驻 Node 进程）        → VPS
    src/api/            对外 API handler
    src/auth/           三种登录方式（钱包/邮箱/Google）+ JWT 签发校验
    src/engine-host/    把 packages/engine 的纯逻辑内核接上真实时间/行情/持久化
    src/http/           HTTP 路由装配
    src/jobs/           定时任务（资金费结算、杠杆分层同步等）
    src/market/         币安行情 WebSocket 订阅与转发
    src/persistence/    引擎状态落库/恢复
    src/routers/         路由分层
    src/testing/         测试用 harness
    src/ws/              WebSocket hub，向前端转发行情/账户事件
    src/env.ts / env.server.ts   varlock 生成，禁止手改
  native/   Expo（第一版不动，禁止改动）

packages/
  shared/   类型、枚举、错误码、定标换算（零依赖，纯函数）
  engine/   撮合/风控/清算纯逻辑内核（只依赖 shared；进度见 docs/tutorial/README.md）
  db/       Drizzle schema + migrations                       → Supabase Postgres
    src/brackets/    杠杆分层表（服务端用只读 Key 同步）
    src/schema/      Drizzle schema 定义
    src/migrations/  迁移文件
    src/scripts/     sync-brackets / verify-brackets / seed-symbols / reconcile-ledger
  ui/       共享 shadcn 组件（components/hooks/lib/styles）
  config/   共享 tsconfig（tsconfig.base.json），无业务源码
  infra/    Alchemy 部署（只管 apps/web）

docs/
  design/          ★ 权威设计文档，动手前必读 README.md + 02-architecture.md
  vendor/binance/  币安官方文档本地副本，不进 git，`pnpm run docs:binance` 拉取
  iterations/      SDLC 迭代记录（intake 时新建，此前为空；2026-09-24 已有首个迭代 `2026-09-24/001-system-version-uptime-feature/` 走完 apply，见下方「2026-09-24 增量刷新记录」）
  books-tutorial.md / db-notes.md / tutorial/   早前练手记录，与本项目业务无关
  frontend/        前端相关补充文档
  requiremnts/     （原文件夹名如此，未改名）
  superpowers/     与本仓库业务无关的第三方技能文档
```

## 各 Workspace 职责

| Workspace | 职责 | 依赖方向约束 |
| --- | --- | --- |
| `apps/web` | 页面、UI、前端状态、通过 `server-api-module` 调用 server | 只能依赖 `packages/shared`（含 `packages/ui`） |
| `apps/server` | 行情订阅、撮合引擎宿主、鉴权、REST/WS API、持久化落库 | 依赖 `packages/engine`、`packages/db`（均经 `packages/shared`） |
| `apps/native` | 移动端，第一版不动 | 不在本轮改动范围 |
| `packages/shared` | 跨端共享类型/枚举/错误码/定标换算 | 零依赖，被所有其他包依赖 |
| `packages/engine` | 撮合/风控/清算纯逻辑内核 | **只能**依赖 `packages/shared`；禁止 db/网络/文件系统/`Date.now()`/`Math.random()`/`console.*`/`setTimeout` |
| `packages/db` | Drizzle schema、迁移、杠杆分层同步脚本 | 依赖 `packages/shared`；被 `apps/server` 依赖 |
| `packages/ui` | 共享 shadcn 组件 | 被 `apps/web` 依赖 |
| `packages/config` | 共享 tsconfig，无运行时逻辑 | 被所有包依赖（devDependency） |
| `packages/infra` | Alchemy 部署脚本，只管 `apps/web` 部署到 Cloudflare | 不参与运行时依赖图 |

## 与 Better-T-Stack 默认约定的偏离（历史事实，本轮不重排）

1. **无 `packages/env`**：环境变量走 `varlock codegen`，每个 app/db 包各自生成 `src/env.ts`（含 `env.server.ts`），不是集中到共享包
2. **无独立 `packages/api`**：API 类型/客户端在 `apps/web/src/server-api-module/`，不是共享包
3. **无独立 `packages/auth`**：鉴权实现在 `apps/server/src/auth/`（服务端专属，前端不需要）
4. **多出 `packages/engine`**：Better-T-Stack 默认模板没有这一层，是本项目核心——撮合/风控/清算纯逻辑内核，必须保持零 IO 依赖
5. **`packages/config` 无源码**，只有 `tsconfig.base.json` 和空 `package.json`
6. **测试文件与源码同目录**（`*.test.ts` 紧挨被测文件），不是 `tests/unit/<workspace>/` 镜像目录（见 `.claude/TEST_BASELINE.md`）

## 历史事实目录（禁止本轮需求随意变更）

- `apps/native/`：第一版明确不动（`docs/design/00-overview.md` 第二节「不做」）
- `docs/books-tutorial.md`、`docs/db-notes.md`、`docs/tutorial/`：早前练手记录，**不代表业务设计**，不得依据它们建表或改架构
- `docs/vendor/binance/`：不进 git 的本地副本，只能通过 `pnpm run docs:binance` 重新生成，不得手写伪造内容
- `packages/db/src/brackets/`：杠杆分层表数据来源必须是服务端用只读 Key 同步的官方签名接口，不得手抄
- 依赖方向图（`web → shared`；`server → engine → shared`；`server → db → shared`）：任何让 `engine` 反向依赖 `db`/`server` 的改动都是架构错误，不是"设计允许的调整"

## 本轮需求默认边界

- 新增前端页面/组件 → `apps/web/src/app` 或 `apps/web/src/components`，共享 UI 优先进 `packages/ui`
- 新增后端能力 → 按能力落 `apps/server/src/{api,routers,jobs,market,ws,...}`，不要在 `apps/server` 里塞撮合/风控数值逻辑（应下沉到 `packages/engine`）
- 新增跨端共享逻辑（类型、枚举、定标换算）→ `packages/shared`，不要复制到 `apps/web` 和 `apps/server` 各一份
- 除非设计文档明确批准，不新建根目录级 `web/`、`api/`、`server/`，也不新建 `packages/env|api|auth`（当前约定是就地放在对应 app 内）

## 2026-09-24 `/sdlc-workflow:update` 增量刷新记录

- 触发原因：首个迭代 `docs/iterations/2026-09-24/001-system-version-uptime-feature/` 完成 `apply`
- 结构层面漂移扫描结果：**无漂移**。本次迭代新增的 `apps/server/src/api/system.ts`、`apps/web/src/server-api-module/system/`、`apps/web/src/app/_shared/ui-components/app-header/version-info.tsx` 均落在上方目录树已登记的既有落位规则内（`apps/server/src/api/` 对外 API handler、`apps/web/src/server-api-module/` 类型化 API 客户端层），未引入任何新目录、新 workspace 或新的 Better-T-Stack 偏离项
- 结论：本文件除 `docs/iterations/` 那一行的事实性措辞更新外，其余内容（目录树、Workspace 职责、偏离记录、历史事实目录、边界规则）与真实结构核对后**保持不变**
