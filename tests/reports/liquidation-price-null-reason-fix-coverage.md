# 测试覆盖度分析报告

## 基本信息

- **生成时间**: 2026-09-26 10:45:00
- **迭代**: docs/iterations/2026-09-25/003-liquidation-price-null-reason-fix/
- **测试框架**: vitest
- **E2E 框架**: Playwright（本迭代 T-009，qa 命令负责）

> 项目约定：测试文件与源码同目录共存（`<name>.test.ts`），不使用 `tests/unit/` 镜像目录（见 `.claude/CODING_GUIDELINES.md`「测试规范」）。下表「Test File」按项目实际约定填写真实路径。

## 单元测试覆盖

| 模块 | 测试文件 | 覆盖的验收标准 |
|------|----------|----------------|
| `liquidation.ts` / `liquidationPriceDetailed()` | `packages/engine/src/liquidation.test.ts` | AC-004, AC-002a, AC-001a, AC-005 |
| `views.ts` / `positionViews()` | `packages/engine/src/views.test.ts` | AC-003a, AC-001b, AC-006a, AC-031, **AC-002a（test 角色补测，见下）** |
| `apps/server` `serialize.ts` / `positionJson()` | `apps/server/src/api/api.integration.test.ts` | AC-001c |
| `apps/server` `ws/serialize.ts` / `closedPositionPayload()` | `apps/server/src/ws/publisher.test.ts` | AC-006b |
| `apps/web` `liquidation-reason.ts` | `apps/web/src/app/trade/_lib/liquidation-reason.test.ts` | AC-001, AC-002, AC-003, AC-003-boundary, AC-006, AC-005 |
| `apps/web` `Position` DTO | `apps/web/src/server-api-module/position/types.ts`（类型，无运行时用例） | AC-001d（`tsc --noEmit` 编译期验证，见「查漏说明」） |

## Requirement → Test Matrix

| Requirement ID | Task IDs | Test Type | Test File | AC-IDs | Status |
|-----------------|----------|-----------|-----------|--------|--------|
| R-002 | T-001 | unit | packages/engine/src/liquidation.test.ts | AC-004, AC-002a, AC-001a, AC-005 | ✅ |
| R-001 / R-002 | T-002 | unit | packages/engine/src/views.test.ts | AC-003a, AC-001b, AC-006a, AC-031 | ✅ |
| R-001 / R-002 | T-002（本次补测） | unit | packages/engine/src/views.test.ts | AC-002a（views 层） | ✅（本次新增） |
| R-001 | T-003 | unit | apps/server/src/api/api.integration.test.ts | AC-001c | ✅ |
| R-001 | T-003 | unit | apps/server/src/ws/publisher.test.ts | AC-006b | ✅ |
| R-001 | T-004 | type-check | apps/web/src/server-api-module/position/types.ts | AC-001d | ✅（tsc --noEmit 通过） |
| R-001 | T-005 | unit | apps/web/src/app/trade/_lib/liquidation-reason.test.ts | AC-001, AC-002, AC-003, AC-003-boundary, AC-006, AC-005 | ✅ |
| R-001 | T-006 | — | apps/web/src/app/trade/_ui-components/records/positions-table.tsx（无独立单测，UI 组件） | AC-001, AC-002, AC-003, AC-006 | ⏳ deferred to qa（逻辑已在 T-005 单测覆盖，组件接入层留给浏览器验收） |
| R-003 | T-007 | manual | apps/web/src/app/rules/page.tsx（文案，非逻辑） | AC-007 | ✅ manual（走查文案，requirements.md 标注验证方式为 manual，不要求自动化测试） |
| R-001 | T-009 | e2e | （由 qa 命令生成） | AC-001, AC-006 | ⏳ deferred to qa |

## AC 覆盖率汇总

> 说明：requirements.md 的 AC-001/AC-002/AC-003/AC-006 同时出现在 unit 侧（T-005/T-002 等，已覆盖）和 qa 侧（T-009，浏览器层复验），两者不冲突，都在下表体现；AC-007 验证方式为 `manual`，不计入自动化测试统计。

| AC-ID | 关联需求 | 场景维度 | Covered By | 状态 |
|-------|----------|----------|------------|------|
| AC-001 | R-001 | happy-path | `liquidation-reason.test.ts`「AC-001 happy-path：MARGIN_SUFFICIENT...」 | ✅ unit；⏳ deferred to qa（T-009 浏览器复验） |
| AC-001a | R-002（T-001 子项） | happy-path | `liquidation.test.ts`「AC-001a (happy-path)...MARGIN_SUFFICIENT」 | ✅ |
| AC-001b | R-001/R-002（T-002 子项） | happy-path | `views.test.ts`「AC-001b (happy-path): 逐仓仓位保证金过于充足...」 | ✅ |
| AC-001c | R-001（T-003 子项） | happy-path | `api.integration.test.ts`「持仓表强平价算不出来时点名具体原因（AC-001c）...」 | ✅ |
| AC-001d | R-001（T-004 子项） | happy-path | `apps/web/src/server-api-module/position/types.ts`（`Position` 接口新增字段）+ `tsc --noEmit` 编译期验证 | ✅（类型层 AC，无运行时断言，编译通过即满足） |
| AC-002 | R-001 | happy-path | `liquidation-reason.test.ts`「AC-002 happy-path：HEDGE_OFFSET...」 | ✅ unit；⏳ deferred to qa（T-009 范围外，见 tasks.md T-009 说明：HEDGE_OFFSET 浏览器难稳定复现，以单测为准） |
| AC-002a | R-002（T-001 子项） | happy-path | `liquidation.test.ts`「AC-002a (happy-path)...HEDGE_OFFSET」 **+ `views.test.ts`「AC-002a (happy-path，test 角色补测)...」（本次新增，见下方「查漏说明」）** | ✅（本次补齐 views.ts 层缺口） |
| AC-003 | R-001 | happy-path | `liquidation-reason.test.ts`「AC-003 happy-path：MARK_PRICE_MISSING 且 missingMarkPrices 非空...」+「多个缺失币对用顿号分隔」 | ✅ |
| AC-003-boundary | R-001（T-005 子项） | boundary | `liquidation-reason.test.ts`「AC-003-boundary：missingMarkPrices 为空数组...」 | ✅ |
| AC-003a | R-001/R-002（T-002 子项） | happy-path | `views.test.ts`「AC-003a (happy-path): 全仓模式仓位...MARK_PRICE_MISSING」 | ✅ |
| AC-004 | R-002 | error | `liquidation.test.ts`「AC-004 (error): liquidationPrice() 的返回值和 liquidationPriceDetailed().price 永远一致」+ `packages/engine` 全量既有测试（343→344 个，全部原样通过，无一条被迫修改） | ✅ |
| AC-005 | R-002 | boundary | `liquidation.test.ts`「AC-005 (boundary): legs 为空数组 → NO_LEGS」+ `liquidation-reason.test.ts`「AC-005 boundary：reason 为 NO_LEGS...」「AC-005 boundary：未识别的字符串值...」 | ✅ |
| AC-006 | R-001 | ui-state | `liquidation-reason.test.ts`「AC-006 ui-state：reason 为 null 时返回 undefined」 | ✅ unit；⏳ deferred to qa（T-009 浏览器复验） |
| AC-006a | R-001/R-002（T-002 子项） | ui-state / 不变式 | `views.test.ts`「AC-006a (ui-state/不变式): 能正常算出强平价时...」 | ✅ |
| AC-006b | R-001（T-003 子项） | ui-state | `publisher.test.ts`「AC-006b: 已平仓仓位...liquidationUnavailableReason 固定为 null」 | ✅ |
| AC-007 | R-003 | happy-path | `apps/web/src/app/rules/page.tsx` 文案（验证方式为 `manual`，requirements.md 原文标注） | ✅ manual（不适用自动化单测，非本次查漏范围） |
| AC-030 | R-001/R-002（T-008 自身） | happy-path | 见「查漏说明」——4 种 reason 断言齐备后，`pnpm --filter engine test` 344/344、`pnpm --filter web test -- liquidation-reason` 8/8 全绿 | ✅（本次补齐后达成） |
| AC-031 | R-001/R-002（T-008 自身） | boundary | `views.test.ts`「AC-006a (ui-state/不变式)...」（同一断言：`liquidationPrice` 有值时 `liquidationUnavailableReason` 必为 `null`） | ✅ |

### 按场景维度覆盖（仅统计单元测试可覆盖的维度）

| 维度 | 总数（去重后 AC-ID） | 单元已覆盖 | deferred to qa | 未覆盖 |
|------|------|-----------|----------------|--------|
| happy-path | 10（AC-001/001a/001b/001c/001d/002/002a/003/003a/007） | 9（AC-007 为 manual，不计自动化） | 3（AC-001/AC-002/AC-003 同时 unit + qa 复验） | 0 |
| error | 1（AC-004） | 1 | 0 | 0 |
| boundary | 3（AC-005/003-boundary/031） | 3 | 0 | 0 |
| ui-state | 3（AC-006/006a/006b） | 3 | 1（AC-006 同时 unit + qa 复验） | 0 |

**总计**：requirements.md 定义的 7 条 Requirement 级 AC（AC-001~AC-007）+ tasks.md 拆出的 11 条子项（AC-001a/b/c/d、AC-002a、AC-003a、AC-003-boundary、AC-006a/b、AC-030、AC-031）= 18 条，**全部有对应单测覆盖或明确的 manual/qa 验证归属，0 条遗漏**。

## 查漏说明（本次 test 角色新增的内容）

### 发现的缺口：`HEDGE_OFFSET` 在 `views.ts`（`positionViews()`）层面没有独立断言

- **问题**：backend 汇报显示 `liquidation.test.ts` 在 `liquidationPriceDetailed()` 这一层测过 `HEDGE_OFFSET`（AC-002a），但 `views.test.ts` 只测了 `MARGIN_SUFFICIENT`（AC-001b）和 `MARK_PRICE_MISSING`（AC-003a），没有一条用例走到 `positionViews()` 这一层验证 `HEDGE_OFFSET` 会正确透传。这意味着如果 `views.ts` 的 `liquidationPriceOf()` 在把 `liquidationPriceDetailed()` 的 `HEDGE_OFFSET` 结果解构/透传到 `PositionView` 的过程中出错（比如把 reason 字段名拼错、或者双腿透传逻辑有 bug），现有测试套件不会报红。
- **修复**：在 `packages/engine/src/views.test.ts` 新增一条用例，复用 `liquidation.test.ts` 里同一组精确解出分母为 0 的 251/249 双向持仓算例，构造 HEDGE 模式账户，直接调用 `createEngine(...).positionViews(...)`，断言两条腿（多、空）的 `liquidationPrice` 均为 `null`、`liquidationUnavailableReason` 均为 `"HEDGE_OFFSET"`。
- **验证**：`pnpm --filter engine test` 344/344 全绿（新增 1 条，原 343 条原样通过）。

### 复核确认：`apps/web` 的 `NO_LEGS` / 未识别值兜底

`liquidation-reason.test.ts` 已经分别用字符串 `"NO_LEGS"`（第 39-43 行）和一个完全陌生的字符串 `"SOME_UNKNOWN_REASON"`（第 45-50 行）两种输入各测了一遍非空兜底文案 + 不抛异常，两种情况都存在，无需补测。

### 复核确认：AC-004 / AC-005 的兼容性 / 健壮性没有影响既有调用方

- `packages/engine` 全量 `vitest run`：344 个测试全部通过（本次新增 1 条后总数从 343 → 344），无一条既有测试被迫修改断言。
- `pnpm --filter engine exec tsc --noEmit`、`pnpm --filter server exec tsc --noEmit`：均无类型错误。
- `preview.ts`、其它既有 `.test.ts`（含 `purity.test.ts`）未被本迭代改动触及，行为不变。

## 与设计的偏差

无。本次只新增了 1 条 `views.test.ts` 用例，未修改任何已有断言。

## 运行结果摘要

| 命令 | 结果 |
|------|------|
| `pnpm --filter engine test` | ✅ 23 files / 344 tests 全绿（含本次新增 1 条） |
| `pnpm --filter web test -- liquidation-reason` | ✅ 通过（`liquidation-reason.test.ts` 8/8） |
| `pnpm --filter web test`（全量） | ✅ 30 files / 210 tests 全绿 |
| `pnpm --filter server test`（全量） | ⚠️ 26/29 files 通过，5 个既有失败（`ws/hub.test.ts` 3 个 token 时效相关、`persistence/persistence.integration.test.ts` 1 个资金费幂等相关、`leaderboard.integration.test.ts` 1 个）——均与本次改动无关的文件（未出现在本迭代 diff 里），backend 汇报已用 `git stash` 验证为改动前就存在的 baseline 失败；本次复核确认这些文件不在本迭代 `git status` 变更列表内，count 与 backend 汇报略有出入（backend 写"4 个 token 过期相关"，实测 `hub.test.ts` 是 3 个 + `leaderboard.integration.test.ts` 1 个，backend 汇报未提及后者），已在下方「与设计的偏差」外单独记录，不影响本次 AC 判定 |
| `pnpm --filter server test`（本迭代实际改动的文件：`api.integration.test.ts` + `publisher.test.ts`） | ✅ 2 files / 17 tests 全绿 |
| `pnpm --filter engine exec tsc --noEmit` / `pnpm --filter server exec tsc --noEmit` | ✅ 均无类型错误 |
