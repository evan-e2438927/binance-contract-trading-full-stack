# Test Baseline

> 由 `/sdlc-workflow:sdlc-init` existing-project intake 生成（2026-09-24），`/sdlc-workflow:update` 阶段二于
> 2026-09-24 增量刷新一次（首个迭代 `001-system-version-uptime-feature` apply 落地后的漂移扫描）。
> 派生事实文档，随代码漂移由 `/sdlc-workflow:update` 阶段二自动重生成。

## 现有测试目录和测试工具

- 测试框架：**Vitest**（各 workspace `package.json` 的 `test` 脚本均为 `vitest run`），不是 `.sdlc-config` 模板默认的 jest
- 测试文件统一放仓库根 `tests/unit/<workspace>/` 镜像目录（2026-10-24 由同目录迁入），命名 `<name>.test.ts`
- 当前测试文件计数（2026-09-24 增量刷新，`find *.test.ts`）：

  | Workspace | 测试文件数 | 较上次 intake（同日更早）变化 |
  | --- | --- | --- |
  | `apps/server` | 29 | +1（`src/api/system.test.ts`，迭代 `001-system-version-uptime-feature`） |
  | `apps/web` | 33 | +4（2026-10-16 刷新；此前 29） |
  | `packages/engine` | 23（含 `purity.test.ts` 专门校验引擎纯函数约束、`ledger-replay.test.ts` 校验事件重放） | 无变化 |
  | `packages/db` | 6 | 无变化 |
  | `packages/shared` | 3 | 无变化 |
  | `packages/ui` / `packages/infra` / `packages/config` | 0 | 无变化 |

- 独立 vitest 配置存在于：`apps/web/vitest.config.mts`、`packages/{engine,db,shared}/vitest.config.ts`；`apps/server` 无独立配置（默认）
- `apps/server/src/auth/auth.integration.test.ts`、`apps/server/src/ws/ws.integration.test.ts` 表明 server 已有集成测试，覆盖真实鉴权流程和 WS

## 现有 lint / typecheck / unit / e2e / browser 验收入口

| 能力 | 现状 |
| --- | --- |
| `check-types` | 每个 workspace 都有（`tsc --noEmit`，`apps/web` 额外先跑 `next typegen`），根 `pnpm run check-types` 走 `turbo run check-types` 扇出全部 |
| `lint` | **只有 `apps/web` 有**（`biome check .`），用的是 biome 不是 eslint；其余 7 个 workspace 无 lint 脚本、无 eslint/biome 配置 |
| unit / 集成 | 根 `pnpm run test` 走 `turbo run test`，扇出到有 `test` 脚本的 workspace（`apps/server`、`apps/web`、`packages/{engine,shared,db}`），全部是 `vitest run` |
| E2E / 浏览器验收 | **不存在**。仓库无 `@playwright/test` 依赖、无 playwright 配置文件、无 `tests/e2e/` 内容。`docs/design/06-testing-design.md` 和 `HANDOFF.md` 把 Playwright E2E 列为 M13（整体验收）里未完成的计划项，**不是已落地能力** |
| CI | 无 `.github/` workflow，测试/lint 目前只能本地手动跑（部署用 `compose.server.yaml` + `deploy:*` 脚本，同样本地触发） |

## 当前是否已具备 Playwright MCP 最终交互验收能力

**不具备。** 这是本次 intake 发现的最大缺口：`sdlc-qa` 阶段依赖的浏览器功能验收（Playwright MCP 驱动）在本仓库尚无对应的脚本/依赖基础设施可以复用，需要在真正跑到 qa 阶段前补齐（或至少确认 `TEST_BOOTSTRAP_POLICY=report` 下允许先报告缺口不阻断）。

## 缺口列表

1. **无 Playwright / E2E 基础设施** —— `docs/design/06-testing-design.md` 提到"仓库已配 Chromium"，实际未找到对应文件；qa 阶段需要先补齐依赖和最小配置，或在报告中明确降级处理
2. **无 CI**（`.github/` 不存在）—— lint/typecheck/test 目前完全依赖本地/人工触发，SDLC pipeline 的 Gate 无法借助 CI 结果，需要开发者本地跑测试作为唯一证据来源
3. **lint 覆盖不全** —— 只有 `apps/web` 配置了 biome；`apps/server`、`packages/*` 无静态检查工具，PostToolUse hook 的 `LINT_TOOL` 若统一设为 `biome`，在这些 workspace 里会因找不到可执行的 linter 自动降级为不反馈（符合 `.sdlc-config` 里 EDIT_CHECK 的降级说明，但代表这些 workspace 目前缺少静态检查这道防线）
4. **`tests/e2e/` 仍无实质内容** —— `tests/unit/` 已承载全部单元测试（2026-10-24 迁入）；`tests/e2e/` 依然为空，`tests/reports/` 已有实质内容，缺口仅剩 `tests/e2e/`
5. **`packages/db` 依赖 Supabase/本地 Postgres** —— 数据库相关测试（`packages/db` 6 个测试文件、server 的集成测试）需要可用的数据库连接，intake 未验证本地是否已起 Supabase/Docker，实际跑测试前需要确认 `DATABASE_URL` 可连

## 配置修正（本次 intake 已执行）

`.claude/.sdlc-config` 模板默认 `TEST_FRAMEWORK=jest` / `LINT_TOOL=eslint`，与仓库实际不符（Vitest / biome），intake 已直接改为 `TEST_FRAMEWORK=vitest` / `LINT_TOOL=biome`（首次接入，非 update 漂移修正场景，不需要逐项确认）。

## 2026-09-24 `/sdlc-workflow:update` 增量刷新记录

- 触发原因：首个迭代 `docs/iterations/2026-09-24/001-system-version-uptime-feature/` 完成 `apply`（新增 2 个测试文件）后运行 `update`
- 配置漂移扫描：`.sdlc-config` 的 `TEST_FRAMEWORK=vitest` / `LINT_TOOL=biome` 与仓库实际一致，**无漂移**，未改动
- 基线漂移：测试文件计数表（见上）+ 缺口列表第 4 项已按真实文件树刷新；其余章节核对后与现状一致，未发现新增/移除的 workspace、脚本、依赖或测试入口
- 本轮 apply 额外验证：`apps/server` 有 1 个预先存在、与业务代码无关的失败用例（`leaderboard.integration.test.ts`，缺 `SOLUSDT` 标记价种子数据），已记录为已知环境缺口，不属于本文件缺口列表新增项（不影响 lint/typecheck/CI 现状结论，故未在缺口列表单独立项，只在此记录留痕）

## 2026-10-16 `/sdlc-workflow:update` 增量刷新记录

- 配置漂移：`TEST_FRAMEWORK=vitest` / `LINT_TOOL=biome` 与仓库一致，无漂移，未改动
- 基线漂移：`apps/web` 测试文件 29→33，其余 workspace 计数不变（server 29 / engine 23 / db 6 / shared 3）；缺口列表无新增或消除（仍无 Playwright、无 CI、lint 仅 web、`tests/e2e/` 空）
- 注：`tests/reports/` 新增 leaderboard、liquidation-price-null-reason、wallet-login 三份报告
