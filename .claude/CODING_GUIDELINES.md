# Coding Guidelines

> 本文件由 `/sdlc-workflow:sdlc-init` existing-project intake 对齐真实代码（2026-09-24）。
> 五条硬约束（bigint 定标、engine 纯函数、舍入走 shared、bigint 不进 JSON、资金变动必写 ledger）以根
> `CLAUDE.md` 为唯一权威来源，本文件不重复搬运，只做落位/风格/测试层面的补充。

## Monorepo 落位规则

- Web 页面、路由、组件、前端状态逻辑放在 `apps/web/src/{app,components,hooks,lib,providers,stores}`；与 `apps/server` 对接的类型化 API 客户端放在 `apps/web/src/server-api-module/`
- 后端入口、路由、handler、任务放在 `apps/server/src/{api,http,routers,jobs,market,ws,persistence,engine-host}`；鉴权放在 `apps/server/src/auth/`
- 撮合/风控/清算**数值逻辑**必须下沉到 `packages/engine`，不得直接写在 `apps/server`（否则无法用事件序列逐字重放测试，违反根 `CLAUDE.md` 硬约束第二条）
- 跨端共享类型、枚举、定标换算、错误码放在 `packages/shared`；共享 UI 组件放在 `packages/ui`
- 不要把同一份逻辑复制到 `apps/web` 和 `apps/server`
- 默认禁止新增根目录级 `web/`、`server/`、`api/`、`frontend/`、`backend/`
- **本项目实际包布局是 `config / db / engine / infra / shared / ui`，不是 Better-T-Stack 默认模板的
  `env|api|auth|db|infra|ui`**：
  - 环境变量走 `varlock codegen`（各 app 自生成 `src/env.ts`），**没有**独立 `packages/env`
  - API 客户端类型层在 `apps/web/src/server-api-module`，**没有**独立 `packages/api`
  - 鉴权实现在 `apps/server/src/auth`，**没有**独立 `packages/auth`
  - 若确实需要把上述某一层收敛成独立共享包，必须先在 `design.md` 里说明动机并获批准，不能顺手新建

## 命名规范

- 定标数值（`bigint`）不加后缀，类型标 `Fixed`；**非定标数值必须加 `Num` 后缀**（根 `CLAUDE.md` 命名防呆）：
  ```ts
  const price: Fixed = parse('50000.25')   // bigint
  const leverageNum: number = 10           // 普通数字
  ```
- 其余命名沿用现有代码风格（TypeScript 驼峰、文件名 kebab-case，如 `execute-order.ts`、`ledger-replay.test.ts`）

## 代码风格

- `apps/web` 用 biome 格式化/检查（`pnpm --filter web lint` / `format`）；其余 workspace 目前无自动格式化工具，遵循现有代码风格手动对齐，不要引入新的格式化工具而不在设计里说明
- TypeScript 严格模式，`check-types` 必须通过（`tsc --noEmit`，`apps/web` 先跑 `next typegen`）

## 错误处理

- 统一用 `packages/shared` 的 `AppError` + 错误码（见 `packages/shared/src/errors.ts`），不要在业务代码里手写 ad-hoc `throw new Error(...)`
- Token 校验区分错误码：过期 → `TOKEN_EXPIRED`；其它任何问题 → `UNAUTHORIZED`，不泄露具体失败细节（参考 `apps/server/src/auth/tokens.ts` 的既有模式）
- 遇到"造假比拒绝更简单"的场景（如深度不够、行情断线），按根 `CLAUDE.md`「一条原则」选择拒单/暂停，不编数字

## 测试规范

> ⚠️ **本条覆盖 init 模板默认假设**：本项目实际约定是测试文件**与源码同目录共存**，不是独立镜像的
> `tests/unit/<workspace>/` 目录。intake 时仓库已有 88 个 `*.test.ts` 文件全部采用同目录约定
> （详见 `.claude/TEST_BASELINE.md`），新测试必须延续这个约定，不要为了迁就模板把新测试写进
> `tests/unit/`（那会造成新旧测试分裂成两套目录约定）：

- 单元测试与被测文件同目录，命名 `<name>.test.ts`，例如 `packages/engine/src/execute-order.ts` 对应 `packages/engine/src/execute-order.test.ts`
- 测试框架统一 **Vitest**（`vitest run`），不是 jest
- `packages/engine` 的测试是投入重点（根 `docs/design/06-testing-design.md`：引擎单测:集成:E2E:演练 ≈ 6:2:1:1），新增撮合/风控/清算逻辑必须配纯函数单测，且不能引入 IO 依赖
- `packages/engine/src/purity.test.ts` 专门校验引擎纯函数约束，任何触碰 `packages/engine` 的改动都要确保这个测试仍然通过
- init 脚本生成的 `tests/unit/`、`tests/e2e/`、`tests/reports/` 目录骨架**保留但目前不是主要测试落位**：
  - `tests/e2e/` 用于未来补齐的 Playwright E2E（当前仓库无此能力，见 `.claude/TEST_BASELINE.md` 缺口 1）
  - 每个 E2E 文件必须带唯一场景 ID（如 `E2E-001`），并注明覆盖的 Requirement IDs 和 Task IDs
  - 同一需求路径不得被重复创建多个等价 E2E 场景
  - E2E 结果报告必须包含 Playwright MCP 的验证证据

## Git 规范

- 提交遵循 Conventional Commits 1.0.0：`<type>[scope][!]: <description>`（type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert；破坏性变更加 `!` 或 footer `BREAKING CHANGE:`）
- 分支前缀见 `.claude/.sdlc-config` 的 `GIT_BRANCH_PREFIX`（默认 `feat/`）
- 现有提交历史里 scope 常用里程碑代号（如 `feat(trade): ...`、`feat(engine): ...`、`feat(leaderboard): ...`），新提交延续这个粒度，不要用文件名当 scope

## 代码审查

审查时额外检查：

- 文件是否落在正确 workspace（尤其是撮合/风控数值逻辑有没有误放进 `apps/server` 而不是 `packages/engine`）
- 是否无必要地引入新的顶层目录，或新建了本该先过 `design.md` 的 `packages/env|api|auth`
- 共享逻辑是否应该下沉到 `packages/shared`
- 测试是否放进了独立的 `tests/unit/`，而不是遵循同目录 `*.test.ts` 惯例
- 根 `CLAUDE.md` 提交前自检四问：`number` 有没有溜进金额运算 / `engine` 有没有 import 不该 import 的东西 / 改了余额有没有写流水 / 依赖方向有没有反
