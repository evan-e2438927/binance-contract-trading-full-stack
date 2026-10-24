# test-pipeline 报告：sentry-error-monitoring

- 迭代: docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/
- 阶段: Stage 1 Lint → Stage 2 Unit（不含浏览器，浏览器验收由 qa 命令负责）

## Stage 1 · Lint（biome）
| 范围 | 结果 |
| --- | --- |
| apps/web 变更文件 | ✅ 通过（修复 1 处：前端角色误把原有 `SERVER_URL` 一行拆成两行，已恢复原样） |
| apps/server、packages/shared 变更文件 | ⚠️ 未执行：这两个包没有 biome 依赖也没有 biome 配置（`TEST_BOOTSTRAP_POLICY=report`，只报缺口不补）。建议后续给它们补 biome，或让根目录统一配置 |

## Stage 2 · Unit（vitest）
| 包 | 命令 | 结果 |
| --- | --- | --- |
| packages/shared | `vitest run` | ✅ 4 文件 / 62 用例 |
| apps/web | `vitest run` | ✅ 37 文件 / 241 用例 |
| apps/server | `vitest run src/observability src/http` | ✅ 6 文件 / 29 用例 |
| apps/server | 全量 `vitest run` | ⚠️ 33 个失败，均与本迭代无关：`*.integration.test.ts` 需要真数据库（127.0.0.1:54322 未开）；`ws/hub.test.ts` 3 个失败所在文件本迭代未改动 |

## 类型检查
- packages/shared、apps/web：✅ 0 错误
- apps/server：4 条错误全部在 `packages/db/src/brackets/diff.ts`（`BRACKET_CHANGE_KIND`），本迭代未改动该文件；本迭代文件 0 错误

## 未覆盖/遗留
- `index.ts` 的 SIGTERM 接线（`flushBeforeExit` 在 `process.exit` 前被调用）没有自动化测试，仅 `flushBeforeExit` 本身有测试
- AC-012 / AC-013 / AC-010b 留给 qa（T-009）

## 追加：单测迁移到 tests/unit/
本迭代新增的 9 个测试文件已按用户决定迁到 `tests/unit/` 镜像目录并重跑：shared 62、web 241、server（src/http + src/observability + tests/unit/server）29 个用例全部通过；shared/web/server 类型检查无新增错误。
