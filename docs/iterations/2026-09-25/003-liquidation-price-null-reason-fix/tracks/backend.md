# Track 汇报：backend

- 状态: done
- 执行者: sdlc-backend-dev
- 完成时间: 2026-09-26T00:00:00+08:00

## 完成的任务与 AC
- T-001: AC-004 ✅, AC-002a ✅, AC-001a ✅, AC-005 ✅
  - `liquidation.ts` 新增 `LiquidationNullReason`（`NO_LEGS` / `HEDGE_OFFSET` / `MARGIN_SUFFICIENT`）与 `liquidationPriceDetailed()`；`liquidationPrice()` 改为对它的薄包装（`return liquidationPriceDetailed(input).price`），签名和既有行为完全不变。
  - `packages/engine` 既有测试（含 `purity.test.ts`）全部原样通过，未修改任何既有用例。
- T-002: AC-003a ✅, AC-001b ✅, AC-006a ✅
  - `types.ts` 的 `PositionView` 新增 `liquidationUnavailableReason: LiquidationUnavailableReason | null`；`LiquidationUnavailableReason = LiquidationNullReason | "MARK_PRICE_MISSING"` 定义在 `liquidation.ts`（`import type` 从 `types.ts` 引用，`verbatimModuleSyntax: true` 下类型导入会被完全擦除，不产生运行时循环依赖）。
  - `views.ts` 的 `liquidationPriceOf()` 改为返回 `{ price, reason }`：ISOLATED 分支透传 `liquidationPriceDetailed()`；CROSS 分支缺其它币对标记价时返回 `{ price: null, reason: "MARK_PRICE_MISSING" }`（原来是直接 `return null`），正常路径同样透传 `liquidationPriceDetailed()`。`positionViews()` 解构后分别赋给 `liquidationPrice` / `liquidationUnavailableReason`。
- T-003: AC-001c ✅, AC-006b ✅
  - `apps/server/src/api/serialize.ts` 的 `positionJson()` 新增 `liquidationUnavailableReason: p.liquidationUnavailableReason`（字符串枚举/`null`，未走 `toDecimalOrNull()`）。
  - `apps/server/src/ws/serialize.ts` 的 `closedPositionPayload()` 新增 `liquidationUnavailableReason: null`（已平仓固定 null，和 `liquidationPrice: null` 一致）。

## 修改的文件
- packages/engine/src/liquidation.ts
- packages/engine/src/liquidation.test.ts
- packages/engine/src/types.ts
- packages/engine/src/views.ts
- packages/engine/src/views.test.ts
- apps/server/src/api/serialize.ts
- apps/server/src/ws/serialize.ts
- apps/server/src/api/api.integration.test.ts
- apps/server/src/ws/publisher.test.ts

## 新增的测试
- packages/engine/src/liquidation.test.ts
  - `describe("liquidationPriceDetailed（第 25 讲）…")`：AC-004（`liquidationPrice()` 与 `liquidationPriceDetailed().price` 数值恒等）、AC-002a（双向对冲分母为 0 → `HEDGE_OFFSET`，用 `qty=251/qty=249, entryPrice=1` 精确解出 bigint 截断下分母恰好为 0，而不是同数量多空——同数量的两条腿因为 MMR 项同号叠加，实际不会触发 `HEDGE_OFFSET`，已用既有算例交叉验证过）、AC-001a（`MARGIN_SUFFICIENT`）、AC-005（`NO_LEGS`，空数组不抛异常）
- packages/engine/src/views.test.ts
  - AC-006a：能正常算出强平价时 `liquidationPrice` 非 null 且 `liquidationUnavailableReason` 为 null（互斥不变式）
  - AC-001b：逐仓仓位保证金过于充足 → `liquidationUnavailableReason` 为 `MARGIN_SUFFICIENT`
  - AC-003a：全仓仓位，账户内另一全仓币对缺标记价 → 本仓位 `liquidationPrice` 为 null、`liquidationUnavailableReason` 为 `MARK_PRICE_MISSING`（用 `testConfig()` 之外临时拼的双币对配置，不影响 fixtures.ts）
- apps/server/src/api/api.integration.test.ts
  - AC-001c：`GET /account/positions` 在逐仓保证金追加到远超仓位名义价值后，`liquidationPrice` 为 null、`liquidationUnavailableReason` 原样出现为 `"MARGIN_SUFFICIENT"`
- apps/server/src/ws/publisher.test.ts
  - AC-006b：`closedPositionPayload`（仓位平掉后的推送）里 `liquidationUnavailableReason` 固定为 null，和 `liquidationPrice: null` 一致
  - 同时补了 `positionView()` 测试夹具的 `liquidationUnavailableReason: null`（PositionView 新增必填字段后的类型修复，非新增断言）

## 公共文件修改请求
- 无

## 与设计的偏差
- 无。`LiquidationUnavailableReason` 类型按设计文档建议放在 `liquidation.ts`（而非 `types.ts`），`types.ts` 用 `import type` 反向引用；这是设计文档中"你自己判断放哪个文件更合适"允许的选择，且已用 `tsc --noEmit` 确认无循环依赖问题。

## 验证结果
- `packages/engine`：`vitest run` 全量 343 个测试通过（含新增 3 + 既有全部原样通过）；`tsc --noEmit` 无错误。
- `apps/server`：`vitest run src/api/api.integration.test.ts`（12 通过，含新增 AC-001c）、`src/ws/publisher.test.ts`（5 通过，含新增 AC-006b）均通过；`tsc --noEmit` 无错误。
- 全量 `apps/server` `vitest run` 有 5 个既有失败（`ws/hub.test.ts` 4 个 token 过期相关、`persistence/persistence.integration.test.ts` 1 个资金费幂等相关），已用 `git stash` 验证这些失败在本次改动之前（baseline）就已存在，与本次改动无关。
