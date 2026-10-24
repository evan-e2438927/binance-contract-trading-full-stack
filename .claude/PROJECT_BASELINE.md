# Project Baseline

> 由 `/sdlc-workflow:sdlc-init` existing-project intake 生成（2026-09-24），`/sdlc-workflow:update` 阶段二于
> 2026-09-24 增量刷新一次（结论：无漂移，内容未改动，见文末「2026-09-24 update 增量刷新记录」）。派生事实文档，
> 后续由 `/sdlc-workflow:update` 阶段二按真实代码漂移自动重生成，不手工维护。

## 项目根路径

`/Users/panda/Documents/work-spaces/binance-contract-trading/binance-contract-trading-full-stack`

## 包管理器 / Workspace / 构建系统

- 包管理器：pnpm `11.8.0`（`package.json#packageManager`），依赖 catalog 统一在 `pnpm-workspace.yaml`
- Workspace：`apps/*` + `packages/*`（`pnpm-workspace.yaml`）
- 构建编排：Turborepo `^2.10.12`（`turbo.json`），任务：`build` / `lint` / `check-types` / `dev` / `dev:bare` / `db:*` / `deploy` / `destroy` / `test`
- 环境变量：`varlock`（每个 app/db 包各自 `env:generate`，产出 `src/env.ts`，**自动生成、禁止手改**）
- TypeScript 版本：`^6.0.3`（根 devDependency）

## 核心技术栈（版本以 package.json 为准，2026-09-24 核对）

| Workspace | 定位 | 关键依赖 |
| --- | --- | --- |
| `apps/web` | Next.js 前端，部署 Cloudflare Workers | `next@^16.3.4`、`react@^19.2.8`、`@tanstack/react-query@^5.103.1`、`zustand@^5.0.15`、`@opennextjs/cloudflare@^1.20.6`、Tailwind 4（catalog）、shadcn/ui、biome（lint/format） |
| `apps/server` | Hono 常驻 Node 进程，部署 VPS | `hono@^4.13.7`、`@hono/node-server@^2.1.1`、`arctic@^3.7.0`（OAuth）、`tweetnacl` + `bs58`（Solana 验签）、`viem@^2.56.5`（EVM 验签）、`ws@^8.21.3` |
| `apps/native` | Expo，第一版不动 | — |
| `packages/shared` | 类型/枚举/错误码/定标换算，零依赖 | 无外部运行时依赖 |
| `packages/engine` | 撮合/风控/清算纯逻辑内核 | 只依赖 `packages/shared`；**禁止**数据库/网络/文件系统/`Date.now()`/`Math.random()`/`console.*`/`setTimeout` |
| `packages/db` | Drizzle schema + migrations | `drizzle-orm@catalog:`（`^0.45.2`）、`drizzle-kit`、目标 Supabase Postgres |
| `packages/ui` | 共享 shadcn 组件 | React |
| `packages/config` | 共享 tsconfig（`tsconfig.base.json`），无源码 | — |
| `packages/infra` | Alchemy 部署，只管 `apps/web` | `alchemy` |

依赖方向（单向，见根 `CLAUDE.md`）：`web ──► shared`；`server ──► engine ──► shared`；`server ──► db ──► shared`。**`engine` 依赖 `db` 或 `server` 是架构错误**。

## 当前可识别的运行脚本（根 `package.json`）

```
dev / dev:server / dev:web / dev:native
build / check-types / test
db:push / db:generate / db:migrate / db:studio / db:update:dev / db:comments / db:migrate:dev / db:migrate:deploy
deploy / destroy（packages/infra，只管 web）
deploy:web（apps/web 经 OpenNext 部署 Cloudflare）
deploy:server / deploy:server:force（docker compose -f compose.server.yaml，server + cloudflared 隧道，部署 VPS）
env:generate（postinstall 自动跑）
docs:binance（拉取 docs/vendor/binance/ 本地副本，见根 CLAUDE.md）
```

各 workspace 内部脚本另见 `.claude/EXISTING_STRUCTURE.md`。

## 外部依赖

- **币安**：只读 API Key（服务端同步杠杆分层表用）+ 公开 WebSocket 行情流（`fapi.binance.com` / `depth20@100ms` / kline / markPrice）。**唯一敏感 Key 只在 `apps/server`，绝不下发到 `apps/web`**
- **Supabase Postgres**：`packages/db` 的部署目标，`DATABASE_URL` 敏感
- **Google OAuth**：`arctic` 库，登录方式之一
- **Resend**（可选）：邮箱验证码发信，未配置时开发环境验证码打日志，生产环境该登录方式返回 `SERVICE_UNAVAILABLE`
- **Cloudflare Workers**：`apps/web` 部署目标（`@opennextjs/cloudflare` + `packages/infra` 的 Alchemy）
- **Docker / Cloudflare Tunnel**：`apps/server` 以 `apps/server/Dockerfile` 打镜像，`compose.server.yaml` 编排 `server`（仅绑 127.0.0.1:3000，带 healthcheck）+ `cloudflared`（隧道出口）；环境变量走未入库的 `apps/server/.env.docker` / `.env.tunnel`

## Verified Facts（已读代码/配置核实）

- 五条硬约束（bigint 定标、engine 纯函数、舍入走 shared、bigint 不进 JSON、资金变动必写 ledger）在根 `CLAUDE.md` 明确写死，非本文档重复来源
- 鉴权是**自研 JWT**（`hono/jwt`，HS256，7 天有效期，payload 只有 `{ sub: accountId, iat, exp }`），三种登录方式（钱包 SIWE/SIWS、邮箱验证码、Google OAuth）共用同一套签发/校验（`apps/server/src/auth/tokens.ts`）
- `apps/web` 有 `biome.json` 且 `lint` 脚本用 biome；其余 7 个 workspace **均无 `lint` 脚本**，仅有 `check-types`（`tsc --noEmit`）
- 测试运行时是 **Vitest**（各 workspace `test: "vitest run"`），**不是** init 模板默认的 jest
- 测试文件统一在 `tests/unit/<workspace>/` 镜像目录（如 `tests/unit/server/auth/tokens.test.ts`、`tests/unit/packages/engine/*.test.ts`），2026-10-24 由同目录迁入
- 仓库当前不存在任何 `@playwright/test` 依赖或 Playwright 配置文件，尽管 `docs/design/06-testing-design.md` 与 `HANDOFF.md` 提到 E2E 计划用 Playwright ——**这是设计意图，不是已落地的能力**
- 无 `.github/` CI 配置（部署靠本地执行 `pnpm run deploy:server` / `deploy:web`，最近的 `ci:` 提交只是补生产环境变量，不是 GitHub Actions）
- 目录结构不是 Better-T-Stack 默认的 `packages/env|api|auth|db|infra|ui`：实际是 `config/db/engine/infra/shared/ui`，鉴权代码在 `apps/server/src/auth/`，环境变量走 `varlock` 生成而非独立 `packages/env`

## Claimed but Unverified（文档中提到但未在代码里逐项核实）

- `docs/design/06-testing-design.md` 称"仓库已配 Chromium"用于 Playwright——实际未找到对应依赖/配置，视为未来计划而非现状
- `docs/design/07-binance-reference.md` 中的币安规则以其标注的核对日期为准，本次 intake 未重新逐条核对
- `HANDOFF.md` 中记录的里程碑完成状态（M01–M12 已完成、M13 待做）来自文档自述，未逐条对照测试用例验证，仅作为项目当前进度的参考起点

## 真相源优先级（供后续 requirements/design 引用）

1. 根 `CLAUDE.md`（五条硬约束、依赖方向、命名防呆）—— 最高优先级，任何设计不得违反
2. `docs/design/*.md`（尤其 `02-architecture.md`）—— 架构/精度/分层/持久化的权威设计
3. `docs/design/07-binance-reference.md` → `docs/vendor/binance/`（不进 git）→ 币安网页版 —— 查币安规则的顺序，见根 `CLAUDE.md`
4. `HANDOFF.md` —— 当前里程碑进度与已知缺口（如缺口编号 #35 等）
5. 本文件 + `.claude/EXISTING_STRUCTURE.md` + `.claude/TEST_BASELINE.md` —— 代码现状快照，冲突时以更早读到的真实代码为准并更新本文件

## 2026-09-24 `/sdlc-workflow:update` 增量刷新记录

- 触发原因：首个迭代 `docs/iterations/2026-09-24/001-system-version-uptime-feature/` 完成 `apply`
- 漂移扫描范围：包管理器/workspace/构建系统、核心技术栈、运行脚本、外部依赖 —— 逐项核对后**均无漂移**：
  未新增 workspace、未新增依赖、`package.json` 脚本列表不变（`apps/server/package.json` 新增了一个
  `"version": "0.1.0"` 字段，属应用级元数据，不影响本文件登记的脚本/依赖/workspace 结构，不算漂移）
- 测试文件数量的变化记录在 `.claude/TEST_BASELINE.md`（本文件不重复维护该细节）

## 2026-10-16 `/sdlc-workflow:update` 增量刷新记录

- 触发原因：`/sdlc-workflow:update`；距上次刷新（2026-09-24）新增 6 个迭代（2026-09-24/002、2026-09-25/001–003、2026-09-26/001 等）与部署相关提交
- 漂移：新增根脚本 `db:comments` / `db:migrate:dev` / `db:migrate:deploy` / `deploy:server(:force)` / `deploy:web`；新增 `compose.server.yaml`、`apps/server/Dockerfile`、`scripts/kill-stray-dev.sh`；外部依赖新增 Docker + Cloudflare Tunnel 部署链路
- 未漂移：workspace 列表、依赖方向、包管理器与构建系统
