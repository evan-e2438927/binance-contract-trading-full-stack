# Track 汇报：frontend

- 状态: partial
- 执行者: sdlc-frontend-dev
- 完成时间: 2026-09-26T00:00:00+08:00

## 完成的任务与 AC
- T-004: AC-001d ✅ `Position` DTO 新增 `liquidationUnavailableReason` 字段，类型与接口契约表完全一致，无需 `any`/类型断言即可接住。
- T-005: AC-001 ✅ / AC-002 ✅ / AC-003 ✅ / AC-003-boundary ✅ / AC-006 ✅ / AC-005 ✅ 全部通过（8 条 vitest 用例，见下方新增测试）。
- T-006: AC-001 ✅ / AC-002 ✅ / AC-003 ✅ / AC-006 ✅ 均已体现在代码里：`title` 改用 `liquidationReasonTitle(position.liquidationUnavailableReason, missingMarkPrices)`，`missingMarkPrices` 从 `useAccountStore((s) => s.account?.missingMarkPrices) ?? []` 取值（沿用 `account-panel.tsx` 的先例）；`liquidationPrice` 有值时后端契约保证 `liquidationUnavailableReason` 为 `null`，函数据此返回 `undefined`，不遮挡数值可读性，未破坏 002 号迭代已有行为。
- T-007: AC-007 ✅ `/rules#liquidation` 小节改写为三条具体原因（保证金过于充足 / 双向持仓对冲 / 全仓行情未到齐），沿用 `<Term>`/`<Bullets>` 现有写法，未出现"很快会有值"一类承诺性措辞，未编造数字。

## 修改的文件
- apps/web/src/server-api-module/position/types.ts（T-004：新增 `liquidationUnavailableReason` 字段）
- apps/web/src/app/trade/_lib/liquidation-reason.ts（T-005：新增纯函数，`Record<非 null 枚举值, string>` 做穷尽性检查）
- apps/web/src/app/trade/_ui-components/records/positions-table.tsx（T-006：接入分文案 tooltip，读取 `missingMarkPrices`）
- apps/web/src/app/rules/page.tsx（T-007：强平小节文案改写为三条具体原因；已用 `biome check --write` 做纯格式化修正，无语义改动）

## 新增的测试
- apps/web/src/app/trade/_lib/liquidation-reason.test.ts（覆盖 AC-001、AC-002、AC-003、AC-003-boundary、AC-006、AC-005；`vitest run` 8/8 通过）

## 公共文件修改请求
- `apps/web/src/stores/account-store.test.ts` 不在本 Track 允许清单内，未做修改，但 `pnpm --filter web exec tsc --noEmit` 显示该文件第 35 行附近的 `position()` mock 工厂函数因新增必填字段而编译失败（`TS2741: Property 'liquidationUnavailableReason' is missing`）。该文件第 48 行 `liquidationPrice: null,` 后需补一行 `liquidationUnavailableReason: "MARGIN_SUFFICIENT",`（该测试文件本身不关心具体 reason 值，任取一个非空枚举值即可满足类型契约“`liquidationPrice` 为 `null` 时必须有值”）。除此一处，`tsc --noEmit` 全仓再无其它因本次改动新增的类型错误。请主 agent 或对应 Track 处理此行修改，或明确授权后由我补上。

## 与设计的偏差
- 无。字段名、枚举值、文案内容、`Record` 穷尽性检查写法均按 design.md「## 2.1 类型定义」「## 3.2 接口表」与工作包任务描述实现。

## 阻塞说明
- 非本 Track 任务本身受阻，但存在一处跨 Track 编译依赖：见上方「公共文件修改请求」。T-004~T-007 四个任务在白名单范围内均已按验收标准完成并自测通过（`vitest run` 目标测试文件全绿、`biome check` 目标文件全绿），整体状态标 `partial` 是因为全仓 `tsc --noEmit` 尚有一处白名单外文件待修复，不影响本次新增功能代码本身的正确性。

## 主 agent 处理记录（⑥.3 汇总）
- 已按上方「公共文件修改请求」在 `apps/web/src/stores/account-store.test.ts:49` 补一行 `liquidationUnavailableReason: "MARGIN_SUFFICIENT",`（`position()` mock 工厂新增字段）。
- 复跑 `pnpm --filter web exec tsc --noEmit`，无任何输出（全部通过）。
- 该文件不在任何 Track 允许清单内，属于跨 Track 编译依赖的收尾修复，由主 agent 直接处理，不重派子 agent。处理后本 Track 视为 `done`。
