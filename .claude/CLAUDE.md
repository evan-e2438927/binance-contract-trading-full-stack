# 币安合约模拟交易平台

## 项目概述

币安 U 本位合约**实时模拟交易平台**：用币安真实实时行情，跑一套自研的账户/撮合/风控/清算逻辑，**不产生任何真实下单**，USDT 由服务端模拟发放。唯一用到的币安 API 是只读 Key（服务端同步杠杆分层表），绝不下发到前端。

**权威上下文来源，优先级从高到低：**

1. 根 `CLAUDE.md`（五条硬约束：bigint 定标、engine 纯函数、舍入走 shared、bigint 不进 JSON、资金变动必写 ledger）
2. `docs/design/*.md`（动手前先读 `docs/design/README.md` + `docs/design/02-architecture.md`）
3. `HANDOFF.md`（当前里程碑进度、已知缺口）
4. `.claude/ARCHITECTURE.md` / `.claude/SECURITY.md` / `.claude/CODING_GUIDELINES.md`（本次 intake 基于真实代码填实的 SDLC 用浓缩版）

## 技术栈

Next.js 16 + React 19（`apps/web` → Cloudflare Workers）、Hono 常驻进程（`apps/server` → VPS）、自研撮合引擎（`packages/engine`，纯函数）、Drizzle + Supabase Postgres（`packages/db`）、pnpm + Turborepo monorepo。完整版本清单见 `.claude/PROJECT_BASELINE.md`。

## 目录结构

```
apps/web/     Next.js 前端 → Cloudflare Workers
apps/server/  Hono 常驻进程 → VPS（行情订阅、撮合宿主、鉴权、API/WS）
apps/native/  Expo，第一版不动
packages/shared/  类型/枚举/错误码/定标换算，零依赖
packages/engine/  撮合/风控/清算纯逻辑内核，只依赖 shared
packages/db/      Drizzle schema + migrations → Supabase
packages/ui/      共享 shadcn 组件
packages/config/  共享 tsconfig
packages/infra/   Alchemy 部署，只管 web
```

完整目录约定、偏离记录见 `.claude/ARCHITECTURE.md`「目录约定」「目录偏离记录」。

## 开发约定

- 参考 .claude/ARCHITECTURE.md 了解架构设计
- 参考 .claude/SECURITY.md 了解安全规范
- 参考 .claude/CODING_GUIDELINES.md 了解编码规范
- 本项目是 existing project，先参考 `.claude/PROJECT_BASELINE.md`、`.claude/EXISTING_STRUCTURE.md`、`.claude/TEST_BASELINE.md`
- 提交遵循 Conventional Commits 1.0.0：`<type>[scope][!]: <description>`（type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert；破坏性变更加 `!` 或 footer `BREAKING CHANGE:`）
- **本项目不是 Better-T-Stack 默认布局**：包布局是 `config/db/engine/infra/shared/ui`，没有独立的 `packages/env|api|auth`（环境变量走 varlock 各 app 自生成、API 客户端在 `apps/web/src/server-api-module`、鉴权在 `apps/server/src/auth`）。新建这几个包前必须先过 `design.md`，见 `.claude/EXISTING_STRUCTURE.md`「与 Better-T-Stack 默认约定的偏离」
- 单元测试统一放仓库根 `tests/unit/`，按 workspace 镜像（`apps/server/src/x/y.ts` → `tests/unit/server/x/y.test.ts`，`packages/<p>/src/x.ts` → `tests/unit/packages/<p>/x.test.ts`），**不再**与源码同目录共存，见 `.claude/CODING_GUIDELINES.md`「测试规范」
- 默认不新建根目录级 `web/`、`api/`、`server/` 等目录，除非设计文档明确批准

## 迭代历史

历史迭代记录存放在 `docs/iterations/` 目录下，按日期和需求顺序组织：

```
docs/iterations/
└── YYYY-MM-DD/
    └── <序号>-<需求名>-<变更类型>/
        ├── requirements.md    # 结构化需求
        ├── design.md          # 技术设计
        ├── tasks.md           # 任务分解
        └── status.json        # proposal/apply 状态
```

**在处理新需求时，先阅读 `docs/iterations/` 下最近 `HISTORY_ITER_DEPTH` 个迭代**（默认 2，`0`=全部；见 `.claude/.sdlc-config`）的 requirements.md 与 design.md，了解已有的设计决策、架构变更和业务上下文，避免：
- 与已有设计冲突
- 重复实现已存在的功能
- 引入与历史决策矛盾的方案

**若项目已经有既有技术架构，不得把它当 fresh project 重建目录。** 必须先尊重 baseline，再决定是否需要结构调整。

## SDLC Workflow
本项目使用 sdlc-workflow 技能进行自动化开发。主线：**proposal → apply → qa → accept → pr**
- 首次接入运行 `/sdlc-workflow init`
- 需求拆解运行 `/sdlc-workflow proposal <需求>` → 等待人工审核
- 审核通过后运行 `/sdlc-workflow apply <迭代目录>` → 开发 + 单元测试 + lint（不提交）
- 浏览器验收运行 `/sdlc-workflow qa <迭代目录>`
- 验收提交运行 `/sdlc-workflow accept <迭代目录>` → 更新文档 + 本地 commit
- 推送建 PR 运行 `/sdlc-workflow pr <迭代目录>`
- 全自动模式运行 `/sdlc-workflow doit <需求>`；小任务运行 `/sdlc-workflow mini <需求>`
- 配置见 `.claude/.sdlc-config`

## 自定义 Skills
把项目专属 skill 放到 `.claude/skills/<name>/SKILL.md`（frontmatter 需含 `name` 与 `description`）。SDLC pipeline 会自动发现它们，并在 `description` 与当前阶段相关时**优先调用**（先 skill、后自造）。
- Claude Code：harness 原生自动发现。
- Codex：由统一上下文加载入口扫描目录索引后可用。
- 想让某 skill 只在特定阶段用，在其 `description` 里点明阶段即可，无需额外配置。
