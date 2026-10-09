# Track 汇报：test

- 状态: done
- 执行者: sdlc-test-dev
- 完成时间: 2026-09-26T10:50:00+08:00

## 完成的任务与 AC

- T-008: AC-030 ✅, AC-031 ✅
  - 逐条核对 requirements.md 的 AC-001~AC-007 及 tasks.md 拆出的全部子项（AC-001a/b/c/d、AC-002a、AC-003a、AC-003-boundary、AC-006a/b），共 18 条，全部有对应单测或明确的 manual/qa 归属，详见 `tests/reports/liquidation-price-null-reason-fix-coverage.md`。
  - 发现并补齐 1 处遗漏：`HEDGE_OFFSET` 只在 `liquidation.test.ts`（`liquidationPriceDetailed()` 层）有断言，`views.test.ts`（`positionViews()` 层）没有对应用例，无法覆盖"views.ts 透传 reason 时出错"这类回归。已按角色规则**只新增**一条用例补齐，未修改任何已有断言。
  - `apps/web` 的 `liquidation-reason.test.ts` 复核：`NO_LEGS` 和一个完全陌生字符串（`"SOME_UNKNOWN_REASON"`）两种输入都已各有一条用例覆盖兜底文案，无需补测。
  - AC-004（旧调用方兼容）/AC-005（兜底不崩溃）复核：`packages/engine` 全量测试 344/344 通过（新增 1 条后从 343 增至 344，无一条既有断言被迫修改）；`tsc --noEmit` 在 `engine`、`server` 均无错误。

## 修改的文件

- packages/engine/src/views.test.ts（仅新增 1 条用例，未修改/删除已有断言）

## 新增的测试

- packages/engine/src/views.test.ts：新增 `it("AC-002a (happy-path，test 角色补测)：双向持仓下同一币对多空数量对冲，分母为 0 → liquidationUnavailableReason 为 HEDGE_OFFSET...")`（覆盖 AC-002a 在 `positionViews()` 层面的透传，复用 `liquidation.test.ts` 同一组 251/249 精确解算例）

## 公共文件修改请求

- 无

## 与设计的偏差

- 无源码/设计层面的偏差。仅记录一处 backend 汇报口径上的小出入，供主 agent 参考，不影响本次 AC 判定：backend 汇报写"`apps/server` 全量 `vitest run` 有 5 个既有失败（`ws/hub.test.ts` 4 个 token 过期相关、`persistence/persistence.integration.test.ts` 1 个资金费幂等相关）"；实测为 `ws/hub.test.ts` 3 个 + `persistence.integration.test.ts` 1 个 + `leaderboard.integration.test.ts` 1 个（共 5 个，总数一致，但 hub.test.ts 具体条数与未提及的 leaderboard 失败有出入）。已确认这 3 个文件均不在本迭代的 `git status` 变更列表内，属于改动前已存在的 baseline 失败，与本次改动无关，不阻塞本次验收。本次改动实际触及的服务端测试文件（`api.integration.test.ts` + `publisher.test.ts`）单独运行 2 files / 17 tests 全绿。

## 覆盖率报告

- tests/reports/liquidation-price-null-reason-fix-coverage.md
