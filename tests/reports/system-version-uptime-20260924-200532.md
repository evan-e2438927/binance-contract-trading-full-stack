# 测试执行报告

## 基本信息

- **执行时间**: 2026-09-24 20:05:32
- **迭代**: docs/iterations/2026-09-24/001-system-version-uptime-feature/
- **测试框架**: Vitest（TEST_FRAMEWORK=vitest）
- **Lint 工具**: Biome（LINT_TOOL=biome，仅 `apps/web` 有 lint 配置/脚本，`apps/server` 无 lint 工具，按 `.claude/TEST_BASELINE.md` 缺口 3 降级为不检查，不算失败）

## 测试结果

| 阶段 | 范围 | 状态 | 通过/总数 | 备注 |
|------|------|------|-----------|------|
| Lint | `apps/web`（本迭代改动文件，`biome check` scoped） | ✅ | 15/15 文件无问题 | 见下方「Lint 详情」 |
| Lint（全仓，仅供参考） | `pnpm --filter web lint` | ⚠️ 非本迭代问题 | 2 处错误，均在 `apps/web/src/probe.ts` | 见「Lint 详情」，该文件是本次会话早前一次无关探测任务遗留的调试文件（含 `debugger` 语句），不属于 `docs/iterations/2026-09-24/001-system-version-uptime-feature/` 任何任务的目标文件，已排除在越界检测的 CHANGED 集合之外（属于 apply 开工前 PRE_CHANGED 基线） |
| Unit | `apps/server`（全量，排除 1 个已知与本迭代无关的失败用例后） | ✅ | 178/178 | 见下方「Unit 详情」 |
| Unit | `apps/web`（全量） | ✅ | 202/202 | 见下方「Unit 详情」 |
| check-types（额外，非流水线强制阶段） | `apps/server` + `apps/web` | ✅ | 均无报错 | `next typegen && tsc --noEmit`（web）、`tsc --noEmit`（server） |

## Lint 详情

- Scoped 检查（本迭代实际改动的文件）：`apps/web/node_modules/.bin/biome check src/server-api-module/system/ src/app/_shared/ui-components/app-header/` → `Checked 15 files in 3ms. No fixes applied.`（0 错误）
- 全仓 `pnpm --filter web lint` 失败原因：`src/probe.ts`（`noDebugger` + 格式化）—— 该文件是本次会话中**早前一个独立、与本迭代无关的探测任务**（新建一个含 `debugger;` 的文件以验证 PostToolUse hook 拦截行为）留下的产物，创建时间早于本次 apply 的 `PRE_CHANGED` 基线快照，不在 `tasks.md` 任何任务的目标文件范围内，backend/frontend/test 三个角色均未触碰它。按越界检测规则，它不计入本次 apply 的 `CHANGED` 集合，因此不阻塞本迭代的 lint 判定；但它确实是仓库当前工作区里一个待清理的遗留文件，建议用户确认后单独清理（不在本次 apply 权限范围内代为删除）。

## Unit 详情

- `apps/server`：全量 `vitest run` 为 181 个测试、1 个测试文件（`src/api/leaderboard.integration.test.ts`）中的 1 个用例失败，报错为 `缺少 SOLUSDT 的标记价`。已用 `git stash` 验证：**不 stash 本迭代改动、单独重跑该文件，失败现象完全相同**，确认是预先存在、与本迭代无关的环境/种子数据问题（该集成测试依赖标记价缓存等运行时状态），不是本次改动引入的回归。排除该文件后，其余 28 个测试文件、178 个测试全部通过，包含本迭代新增的 `apps/server/src/api/system.test.ts`（5/5，含 test 角色查漏补写的 1 例）。
- `apps/web`：全量 `vitest run` 29 个测试文件、202 个测试全部通过，包含本迭代新增的 `apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts`（8/8）。

## Requirement → Test Matrix

| Requirement ID | Task IDs | Test Type | Test File | AC-IDs | 状态 |
|----------------|----------|-----------|-----------|--------|------|
| R-001 | T-001, T-004 | unit | `apps/server/src/api/system.test.ts` | AC-001, AC-002, AC-003, AC-004 | ✅ |
| R-001, R-002 | T-002 | unit（类型层） | `apps/web/src/server-api-module/system/types.ts` + `queries.ts` | AC-005a | ✅（判定类型层已充分覆盖，理由见 `tests/reports/system-version-uptime-coverage.md`） |
| R-002 | T-003, T-005 | unit | `apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts` | AC-007a | ✅ |
| R-002 | T-003, T-006 | playwright-mcp | （由 `qa` 命令生成） | AC-005, AC-006, AC-007, AC-008 | ⏳ deferred to qa |

详细 AC 覆盖核实见 `tests/reports/system-version-uptime-coverage.md`（test 角色生成）。

## 失败用例（如有）

- `apps/server/src/api/leaderboard.integration.test.ts` › `权益快照与排行榜（第 13b 讲验收） › ★ 快照 → 日榜 / 总榜 / 周榜 / 我的名次 / 权益曲线，按定下的口径`：预先存在、与本迭代无关，不阻塞本次 apply（详见上方「Unit 详情」的验证过程）。

## 后续步骤

lint + unit 通过（本迭代范围内）后，运行 `/sdlc-workflow qa` 做浏览器功能验收（T-006，AC-005/006/007/008），再运行 `/sdlc-workflow accept` 更新文档并提交。建议用户另行确认是否清理 `apps/web/src/probe.ts` 这个无关的遗留探测文件。
