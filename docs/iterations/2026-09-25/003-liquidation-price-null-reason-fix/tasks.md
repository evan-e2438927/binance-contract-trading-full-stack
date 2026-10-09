# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-25/003-liquidation-price-null-reason-fix/
- **生成时间**: 2026-09-25 23:05:00
- **基于设计**: design.md

## 任务总览

| Phase | 任务数 | 总工时 |
|-------|--------|--------|
| Phase 1: 引擎与服务端 | 3 | 4h |
| Phase 2: 前端 | 4 | 3h |
| Phase 3: 完善 | 2 | 2h |
| **合计** | **9** | **9h** |

## 任务 Track 汇总（按角色视图）

| Track      | 任务数 | 总工时 | 任务 ID                          |
|------------|--------|--------|-----------------------------------|
| frontend   | 4      | 3h     | T-004, T-005, T-006, T-007        |
| backend    | 3      | 4h     | T-001, T-002, T-003               |
| shared     | 0      | 0h     | —                                  |
| infra      | 0      | 0h     | —                                  |
| unit-test  | 1      | 1h     | T-008                              |
| qa         | 1      | 1h     | T-009                              |
| **合计**   | **9**  | **9h** |                                    |

## Phase 1: 引擎与服务端

### [x] T-001: 引擎层新增强平价 null 原因判断

**描述**: 在 `packages/engine/src/liquidation.ts` 新增 `LiquidationNullReason` 类型和 `liquidationPriceDetailed()` 函数，
返回 `{ price: Fixed | null; reason: LiquidationNullReason | null }`。原有 `liquidationPrice()` 改为
`return liquidationPriceDetailed(input).price` 的薄包装，导出签名、行为完全不变。

区分两条内部原因：
- `legs.length === 0` → `NO_LEGS`
- `solve()` 里 `denominator === 0n` → `HEDGE_OFFSET`
- `price !== null && price <= 0n`（或 `solve` 返回 null 但不是分母为 0 的情况，如有）→ `MARGIN_SUFFICIENT`

**目标文件**:
- packages/engine/src/liquidation.ts
- packages/engine/src/liquidation.test.ts

**Track**: backend

> 备注：`packages/engine` 不在 `references/track-paths.md` 默认 backend 路径列表里（该文件是 Better-T-Stack 默认模板，没有 engine 这一层），
> 但 `server → engine → shared` 是本项目既有依赖方向（`.claude/EXISTING_STRUCTURE.md`），engine 只被 `apps/server` 消费，按实际归属计入 backend。

**适用规范**: 无（未命中 `.claude/skills/` 下的项目专属 skill）

**Requirement IDs**:
- R-002

**验收标准**:
- [x] **AC-004** (error): Given 现有调用 `liquidationPrice()` 的地方（`preview.ts` 及所有既有 `.test.ts`），When 本次改动落地，Then 这些调用点不用修改，`packages/engine` 全部既有测试原样通过
- [x] **AC-002a** (happy-path): Given 双向持仓下构造一组 `legs`（多空数量使分母算出 0），When 调用 `liquidationPriceDetailed()`，Then 返回 `{ price: null, reason: "HEDGE_OFFSET" }`
- [x] **AC-001a** (happy-path): Given 构造一组保证金充足、算出价格 ≤ 0 的 `legs`，When 调用 `liquidationPriceDetailed()`，Then 返回 `{ price: null, reason: "MARGIN_SUFFICIENT" }`
- [x] **AC-005** (boundary): Given `legs` 为空数组，When 调用 `liquidationPriceDetailed()`，Then 返回 `{ price: null, reason: "NO_LEGS" }`，不抛异常

**依赖关系**: 无

**复杂度**: M

**预估工时**: 2h

---

### [x] T-002: PositionView 新增字段 + views.ts 计算 reason

**描述**: `packages/engine/src/types.ts` 的 `PositionView` 新增 `liquidationUnavailableReason: LiquidationUnavailableReason | null` 字段
（`LiquidationUnavailableReason = LiquidationNullReason | "MARK_PRICE_MISSING"`，定义在 `liquidation.ts` 或 `types.ts`，二选一，
以不产生循环 import 为准）。`views.ts` 的 `liquidationPriceOf()` 改为调用 `liquidationPriceDetailed()`：

- ISOLATED：直接透传 `liquidationPriceDetailed()` 的 `{price, reason}`
- CROSS：仍然是"遇到其它全仓币对缺标记价就提前 return"的分支——这一分支现在要返回 `{ price: null, reason: "MARK_PRICE_MISSING" }`，
  不再提前 `return null`；正常路径透传 `liquidationPriceDetailed()` 的结果
- `positionViews()` 里把 `liquidationPriceOf` 的返回值解构进 `liquidationPrice` 和新的 `liquidationUnavailableReason` 两个字段

**目标文件**:
- packages/engine/src/types.ts
- packages/engine/src/views.ts
- packages/engine/src/views.test.ts

**Track**: backend

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002

**验收标准**:
- [x] **AC-003a** (happy-path): Given 全仓模式仓位，账户内另一个全仓币对缺标记价，When 取 `positionViews()`，Then 该仓位的 `liquidationPrice` 为 `null`、`liquidationUnavailableReason` 为 `"MARK_PRICE_MISSING"`
- [x] **AC-001b** (happy-path): Given 逐仓仓位保证金过于充足，When 取 `positionViews()`，Then `liquidationUnavailableReason` 为 `"MARGIN_SUFFICIENT"`
- [x] **AC-006a** (ui-state): Given 一个能正常算出强平价的仓位，When 取 `positionViews()`，Then `liquidationPrice` 有值且 `liquidationUnavailableReason` 为 `null`（两者不能同时非 null）

**依赖关系**: T-001

**复杂度**: M

**预估工时**: 1.5h

---

### [x] T-003: 服务端序列化透传新字段

**描述**: `apps/server/src/api/serialize.ts` 的 `positionJson()` 在现有 `liquidationPrice: toDecimalOrNull(p.liquidationPrice)` 后面
新增一行 `liquidationUnavailableReason: p.liquidationUnavailableReason`（字符串枚举或 `null`，不需要 `toDecimalOrNull`，
因为它不是 bigint/`Fixed`）。`apps/server/src/ws/serialize.ts` 的 `closedPositionPayload()` 在现有 `liquidationPrice: null` 后面
补一行 `liquidationUnavailableReason: null`，保持已平仓仓位的 payload 形状和 `positionJson()` 一致。

**目标文件**:
- apps/server/src/api/serialize.ts
- apps/server/src/ws/serialize.ts
- apps/server/src/api/api.integration.test.ts
- apps/server/src/ws/publisher.test.ts

**Track**: backend

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001c** (happy-path): Given `GET /account/positions` 返回一条 `liquidationUnavailableReason` 非 null 的仓位，When 断言响应体，Then 字段原样出现在 JSON 里（不是 bigint 序列化，不需要 `format()`）
- [x] **AC-006b** (ui-state): Given WS `position` 推送一条已平仓仓位，When 断言 payload，Then `liquidationUnavailableReason` 为 `null`，和 `liquidationPrice: null` 保持一致

**依赖关系**: T-002

**复杂度**: S

**预估工时**: 0.5h

---

## Phase 2: 前端

### [x] T-004: Position DTO 镜像新字段

**描述**: `apps/web/src/server-api-module/position/types.ts` 的 `Position` 接口在 `liquidationPrice` 字段后新增：

```ts
/** liquidationPrice 为 null 时的具体原因；有值时固定为 null */
liquidationUnavailableReason: "MARGIN_SUFFICIENT" | "HEDGE_OFFSET" | "NO_LEGS" | "MARK_PRICE_MISSING" | null;
```

**目标文件**:
- apps/web/src/server-api-module/position/types.ts

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001d** (happy-path): Given 后端返回的 JSON 带新字段，When TypeScript 编译，Then `Position` 类型能正确接住该字段，不需要 `any`/类型断言

**依赖关系**: T-003（对接口形状的依赖；本任务只依赖 design.md §3.2 接口表已经定好的字段形状，不阻塞并行开发，实现顺序可与 T-001~003 并行，仅接口对齐需要参照本表）

**复杂度**: S

**预估工时**: 0.5h

---

### [x] T-005: 新增 reason → 文案的纯函数

**描述**: 新增 `apps/web/src/app/trade/_lib/liquidation-reason.ts`，导出一个纯函数，例如：

```ts
export function liquidationReasonTitle(
  reason: Position["liquidationUnavailableReason"],
  missingMarkPrices: string[],
): string | undefined
```

- `reason === null` → 返回 `undefined`（不显示 title，对应 AC-006）
- `"MARGIN_SUFFICIENT"` → 固定文案："保证金相对仓位过于充足，价格跌到 0 也不会触发强平，算不出强平价"
- `"HEDGE_OFFSET"` → 固定文案："双向持仓下，这个币对的多空仓位数量接近对冲，理论上不会被强平，暂时算不出一个具体价格"
- `"MARK_PRICE_MISSING"` → 基础文案 + 若 `missingMarkPrices` 非空，点名列出（如"，还缺 ETHUSDT 的标记价"）；为空数组时只给基础文案，不拼出空列表
- `"NO_LEGS"` 及任何未识别值 → 兜底文案（和 `MARGIN_SUFFICIENT` 共用同一句，见 design.md「设计假设」）

用 TS 的 `switch` + 穷尽性检查（`default` 分支用 `reason satisfies never` 或等价写法），保证以后新增枚举值时编译期报错，不会漏映射。

**目标文件**:
- apps/web/src/app/trade/_lib/liquidation-reason.ts
- apps/web/src/app/trade/_lib/liquidation-reason.test.ts

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): Given `reason = "MARGIN_SUFFICIENT"`, When 调用函数, Then 返回值包含"保证金相对仓位过于充足"关键描述
- [x] **AC-002** (happy-path): Given `reason = "HEDGE_OFFSET"`, When 调用函数, Then 返回值包含"对冲"相关描述，且与 AC-001 返回值不同
- [x] **AC-003** (happy-path): Given `reason = "MARK_PRICE_MISSING"`、`missingMarkPrices = ["ETHUSDT"]`, When 调用函数, Then 返回值点名包含 "ETHUSDT"
- [x] **AC-003-boundary** (boundary): Given `reason = "MARK_PRICE_MISSING"`、`missingMarkPrices = []`, When 调用函数, Then 返回值不出现空列表拼接痕迹（如 "缺 [] 的标记价"这种坏文案）
- [x] **AC-006** (ui-state): Given `reason = null`, When 调用函数, Then 返回 `undefined`
- [x] **AC-005** (boundary): Given `reason = "NO_LEGS"` 或任意未识别的字符串, When 调用函数, Then 返回一句非空的兜底文案，不抛异常

**依赖关系**: T-004（复用其 `Position` 类型里的 reason 联合类型）

**复杂度**: S

**预估工时**: 1h

---

### [x] T-006: 持仓表接入分文案 tooltip

**描述**: `apps/web/src/app/trade/_ui-components/records/positions-table.tsx` 的 `PositionRow` 组件：
- 引入 `useAccountStore((s) => s.account?.missingMarkPrices) ?? []`
- 把现有那一行合并版 `title={position.liquidationPrice ? undefined : "保证金相对仓位充足，或全仓行情还没到齐时算不出强平价，不是故障"}`
  替换为 `title={liquidationReasonTitle(position.liquidationUnavailableReason, missingMarkPrices)}`

**目标文件**:
- apps/web/src/app/trade/_ui-components/records/positions-table.tsx

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): Given 持仓表某行 `liquidationUnavailableReason` 为 `"MARGIN_SUFFICIENT"`，When 悬停该单元格，Then `title` 是 T-005 定义的对应具体文案
- [x] **AC-002** (happy-path): Given 某行为 `"HEDGE_OFFSET"`，When 悬停，Then `title` 是对冲相关文案
- [x] **AC-003** (happy-path): Given 某行为 `"MARK_PRICE_MISSING"` 且账户 `missingMarkPrices` 非空，When 悬停，Then `title` 点名具体币对
- [x] **AC-006** (ui-state): Given 某行 `liquidationPrice` 有值，When 悬停，Then 没有 `title` 属性（值为 `undefined`），不遮挡数值可读性

**依赖关系**: T-005

**复杂度**: S

**预估工时**: 1h

---

### [x] T-007: 规则页文案同步

**描述**: `apps/web/src/app/rules/page.tsx` 里 `RULE_ANCHORS.liquidation` 小节最后一段（当前是"仓位表里的强平价有时候会显示 --：一种是……另一种是……"这一段），
改写为三种具体原因（保证金过于充足 / 双向持仓对冲 / 全仓行情未到齐），措辞延续现有风格（用 `<Term>` 标注关键词、不编数字、不承诺"很快会有值"）。

**目标文件**:
- apps/web/src/app/rules/page.tsx

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-003

**验收标准**:
- [x] **AC-007** (happy-path): Given 用户打开 `/rules#liquidation`，When 阅读该段，Then 能看到三条具体原因，且不出现"很快会有值"一类承诺性措辞，不编造具体数字

**依赖关系**: 无（文案改动，不依赖 Phase 1/2 的代码改动，可并行）

**复杂度**: S

**预估工时**: 0.5h

---

## Phase 3: 完善

### [x] T-008: 单元测试覆盖率查漏

**描述**: 确认 T-001/T-002/T-005 各自新增的分支测试（`liquidation.test.ts`、`views.test.ts`、`liquidation-reason.test.ts`）
覆盖了 design.md 列出的全部 4 种 reason + "有值时 reason 必须为 null"这条不变式；补齐遗漏分支。跑一遍
`packages/engine` 和 `apps/web` 相关的 `vitest`，确认全绿。

**目标文件**:
- packages/engine/src/liquidation.test.ts
- packages/engine/src/views.test.ts
- apps/web/src/app/trade/_lib/liquidation-reason.test.ts

**Track**: unit-test

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002

**验收标准**:
- [x] **AC-030** (happy-path): Given T-001/T-002/T-005 的实现代码已完成，When 执行 `pnpm --filter engine test` 与 `pnpm --filter web test -- liquidation-reason`，Then 全部通过，且 4 种 reason（`MARGIN_SUFFICIENT`/`HEDGE_OFFSET`/`MARK_PRICE_MISSING`/`NO_LEGS`）都至少有一条对应的断言
- [x] **AC-031** (boundary): Given `liquidationPrice` 有值的仓位, When 跑 `views.test.ts` 里的对应用例, Then 断言 `liquidationUnavailableReason` 必须为 `null`（防止两者同时非 null 的回归）

**依赖关系**: T-001, T-002, T-005

**复杂度**: S

**预估工时**: 1h

---

### [ ] T-009: 浏览器验收（Playwright MCP）

**描述**: 用 `qa` 命令生成脚本并执行。核心验证"保证金过于充足"这一最常见分支（`MARGIN_SUFFICIENT`）能在真实交易页面上看到具体文案，
以及"强平价有值时不出现 title"（AC-006）没有回归。`HEDGE_OFFSET`（需要双向模式下精确对冲的仓位）和 `MARK_PRICE_MISSING`
（需要账户在多个全仓币对同时持仓、且人为制造某币对缺标记价）这两种场景在浏览器里较难稳定复现，
以 T-008 的单元测试覆盖为准，本任务只描述验收规格，不含实现代码。

**目标文件**:
- tests/e2e/liquidation-price-null-reason-fix/E2E-liquidation-tooltip.e2e.ts（由 `qa` 命令生成）

**Track**: qa

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [ ] **AC-001** (happy-path): Given 已登录的模拟账户在某个杠杆很低（保证金充足）的币对上开了一个小仓位，When 打开 `/trade/<该币对>` 并把鼠标悬停在持仓表"强平价"单元格（selector: 持仓表强平价列内 `span[title]`），Then 出现的 `title` 文本包含"保证金相对仓位过于充足"
- [ ] **AC-006** (ui-state): Given 该账户另有一个能正常算出强平价的仓位，When 悬停对应单元格，Then 不出现 `title` 属性

**依赖关系**: T-006, T-008

**复杂度**: S

**预估工时**: 1h

---

## 依赖关系图

```
T-001 ──── T-002 ──── T-003
                        │
T-004 ──── T-005 ──── T-006 ──┐
                                ├── T-008 ──── T-009
T-007 ──────────────────────────┘
```

## 任务执行顺序

1. T-001 → T-002 → T-003（引擎 → 视图 → 服务端序列化，串行）
2. T-004 → T-005 → T-006（DTO → 纯函数 → 接入组件，串行；T-004 可与 T-001 并行开始，接口形状已在 design.md §3.2 定好）
3. T-007 可随时并行（纯文案改动，无代码依赖）
4. T-008（单测查漏）依赖 T-001/T-002/T-005 完成
5. T-009（浏览器验收）依赖 T-006 和 T-008 完成
