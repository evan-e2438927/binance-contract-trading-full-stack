# 技术设计文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-25/003-liquidation-price-null-reason-fix/
- **生成时间**: 2026-09-25 22:55:00
- **基于需求**: requirements.md

## 前置说明：澄清 Gate 复核

`requirements.md`「假设记录」中的三条假设（ASM-001~003）全部 `status: confirmed`、`confirmedBy: interactive`、`provenance: asked`——
在主会话内通过两轮 `AskUserQuestion` 真正发起过提问并拿到用户作答，不存在 `never-asked` 的设计决策。澄清 Gate 通过，可以进入设计。

本次没有新增被假设驱动、且未经提问的设计决策；下面「设计假设」小节仍按规范登记两条**纯技术实现层面**（不影响需求语义，用户不需要为此决策）的选型假设。

## 设计假设

| 决策点 | 关联 | 所做假设 | 理由 | 若假设错误的影响 |
|--------|------|----------|------|------------------|
| `liquidationPrice()` 不改签名，新增 `liquidationPriceDetailed()` 作为内部实现，`liquidationPrice()` 变成它的薄包装 | R-002 / AC-004 | 现有调用方（`preview.ts`、多个 `.test.ts`）不需要 reason，只改内部实现风险最小 | 避免把"要不要拿到 reason"这个决定强加给不关心 reason 的调用方，符合 CLAUDE.md「engine 必须是纯的」但不要求"每次都要多返回一份没人用的数据" | 如果后续要求所有调用方都要 reason，再单独提需求把 `liquidationPrice()` 废弃、统一改调 `liquidationPriceDetailed()`，是一次独立的、有明确验收标准的重构，不在本次 Micro 改动里做 |
| `NO_LEGS`（legs 为空）这个理论上不可达分支，对外 reason 类型里保留但不单独设计文案，前端和 `MARGIN_SUFFICIENT` 共用一句兜底 | R-002 / AC-005 | 这个分支目前在 `views.ts`/`preview.ts` 的调用路径下不会触发（调用方都先过滤了 `qty > 0` 才传 legs 进来），没必要为一个不可达分支单独设计一句用户看得懂的文案 | 避免为不可达状态过度设计；同时不静默吞掉这个分支——仍然返回一个明确的 reason 值，只是文案上和另一个分支共用 | 如果将来出现新调用方在没有仓位时也调用这个函数，兜底文案至少不会崩溃或误导成别的原因，只是不够精确——那时再补一句专门文案 |

## 遵循的项目规范

未命中任何 `.claude/skills/` 下的项目专属 skill（本次是纯粹的只读派生字段扩展，不涉及资金流水、定标换算之外的新规则）。仍需遵守根 `CLAUDE.md` 五条硬约束：

1. **bigint 定标**：`liquidationUnavailableReason` 是字符串枚举，不是金额/价格/数量，不受这条约束支配；`liquidationPrice` 本身的计算逻辑本次不改动，继续走 `packages/shared` 的 `divRound`。
2. **`packages/engine` 必须是纯的**：新增的 `liquidationPriceDetailed()` 和现有 `liquidationPrice()` 一样不引入 db/网络/`Date.now()`/`console.*`。
3. **舍入走 shared**：本次不新增任何舍入运算。
4. **bigint 不进 JSON**：新字段是 string 枚举，天然可 JSON 序列化，不涉及 `format()`/`parse()`。
5. **资金变动必写 ledger**：本次不产生任何资金变动，不触碰 `ledger_entries`。

## 0. 目录影响声明

### 0.1 目标目录
- `packages/engine/src`: 修改 `liquidation.ts`（新增函数+ 类型，不改现有导出行为）、`views.ts`（`liquidationPriceOf` 计算 reason 并回传）、`types.ts`（`PositionView` 新增字段）
- `apps/server/src`: 修改 `api/serialize.ts`（`positionJson()` 透传新字段）、`ws/serialize.ts`（`closedPositionPayload` 补上新字段为 `null`）
- `apps/web/src`: 修改 `server-api-module/position/types.ts`（DTO 镜像新增字段）、`app/trade/_ui-components/records/positions-table.tsx`（tooltip 分文案）、`app/rules/page.tsx`（文案同步）；新增 `app/trade/_lib/liquidation-reason.ts`（纯函数：reason → 文案，含 `.test.ts`）

### 0.2 新增目录
无新增目录，全部落在既有目录结构内。

### 0.3 偏离说明
无偏离。`packages/engine` 不在 `references/track-paths.md` 默认的 `tracks.backend` 路径列表里（该模板文件是 Better-T-Stack 默认布局，没有 `engine` 这一层），
但 `.claude/EXISTING_STRUCTURE.md` 和根 `CLAUDE.md` 明确写着依赖方向 `server → engine → shared`——`packages/engine` 只被 `apps/server` 消费，
本次涉及的改动也都是后端职责（引擎计算 + 服务端序列化），因此本设计把 `packages/engine/` 下的任务一并计入 **backend** Track，
task-generator 阶段会在每个相关任务里显式写明这条依据，避免 Gate 1 按默认 `track-paths.md` 误判为"路径不在 backend 范围内"。

## 1. 技术方案概要

### 1.1 概述
持仓表"强平价"列显示 `--` 时，背后其实有三种互不相同的原因（保证金过于充足 / 双向对冲 / 全仓行情未到齐），
但前端目前只有一句合并文案，且完全没提"双向对冲"这一种。本次给引擎侧的 null 判断补上一个具体原因（reason），
一路透传到前端，把 `title` 提示从"一句话糊弄三种情况"改成"按实际原因给出对应的话"。不改变强平价本身的计算公式。

### 1.2 目标
- 持仓表 tooltip 能区分三种具体原因，全仓行情未到齐时点名缺失标记价的币对
- `packages/engine` 现有的 `liquidationPrice()` 调用方（含所有既有测试）行为不变
- `/rules#liquidation` 文案同步更新，口径和 tooltip 一致

### 1.3 非目标（Scope 外）
- 不改 `liquidationPrice()` 的计算公式
- 不改下单面板"预估强平价"的展示（留作后续迭代）
- 不改 K 线强平线、强平记录 tab、开仓确认弹窗

## 2. 数据模型设计

不涉及数据库表变更（reason 是运行时派生值，不落库）。仅新增运行时类型：

### 2.1 类型定义

```ts
// packages/engine/src/liquidation.ts（新增，导出）
export type LiquidationNullReason =
  | "MARGIN_SUFFICIENT" // 算出来的价格 ≤ 0：保证金相对仓位过于充足
  | "HEDGE_OFFSET"       // 分母为 0：双向持仓下多空数量对冲
  | "NO_LEGS";           // legs 为空（防御性分支，views.ts/preview.ts 的调用路径下不可达）

// packages/engine/src/types.ts（PositionView 新增字段，追加在 liquidationPrice 之后）
export type LiquidationUnavailableReason = LiquidationNullReason | "MARK_PRICE_MISSING";
// MARK_PRICE_MISSING：全仓模式下，views.ts 在调用 liquidationPriceDetailed 之前，
// 因为"其它全仓币对缺标记价"提前返回 null，这一层是调用方（views.ts）级别的原因，不属于 liquidation.ts 内部
```

`PositionView.liquidationUnavailableReason: LiquidationUnavailableReason | null`——`liquidationPrice` 有值时必须为 `null`；`liquidationPrice` 为 `null` 时必须有值（不允许"两个都是 null"，那样前端拿不到任何信息，等于没做这次需求）。

## 3. 接口契约

- **契约形态**: table
- **契约文件**: 无

### 3.1 契约形态判定说明

项目是 TS monorepo（`packages/*` + pnpm workspace），命中 `03-design-generator.md` §1.6 的优先级 2；但项目没有 `packages/contracts` 或任何跨端共享 DTO 包——
`apps/web/src/server-api-module/position/types.ts` 文件头注释自己写明"来源：apps/server/src/api/positions.ts、api/serialize.ts"，
是后端手写 handler + 前端手动镜像同名类型文件的既有惯例（`account/types.ts`、`order/types.ts` 等全部是这个模式）。
本次沿用该惯例，改用 `table` 契约形态，不为一个新增字段新建共享包。

### 3.2 接口表

| 方法 | 路径 | 请求体 | 成功响应（新增字段） | 错误响应 | 认证 | 关联 AC |
|------|------|--------|----------------------|----------|------|---------|
| GET | /account/positions | 无 | 200，每条持仓新增 `liquidationUnavailableReason: "MARGIN_SUFFICIENT" \| "HEDGE_OFFSET" \| "NO_LEGS" \| "MARK_PRICE_MISSING" \| null` | 不变 | 是 | AC-001, AC-002, AC-003, AC-006 |
| WS | `position` 推送（含 `positionJson` 与 `closedPositionPayload` 两条路径） | 无 | 同上，新增同名字段；`closedPositionPayload`（已平仓）固定为 `null` | 不变 | 是（订阅时已鉴权） | AC-001, AC-002, AC-003, AC-006 |

> 前端按本表新增字段更新 `Position` DTO 镜像类型；后端按 `views.ts` 计算结果原样透传，不做二次判断。
> 实现中若必须偏离契约，先回写本表，再改代码。

## 4. 安全考量

### 4.1 认证
不变，沿用 `/account/positions` 和 WS `position` 订阅现有鉴权。

### 4.2 授权
不变，新增字段只是同一份数据里多一个只读派生值，不改变谁能看到谁的仓位。

### 4.3 数据保护
不涉及敏感字段；`liquidationUnavailableReason` 只是计算过程的元信息，不泄露除已在 `missingMarkPrices`（账户级已公开给本人）之外的任何信息。

## 5. 依赖关系

### 5.1 内部依赖
- `apps/web` positions-table.tsx → `apps/web` `_lib/liquidation-reason.ts`（新文件）→ `apps/web` account-store（读 `missingMarkPrices`）
- `apps/server` serialize.ts → `packages/engine` views.ts → `packages/engine` liquidation.ts

### 5.2 外部依赖
无变化。

### 5.3 新增依赖

无。

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 改 `liquidationPriceOf`/`previewLiquidationPrice` 时不小心改动了实际计算逻辑 | 低 | 高（强平价算错会影响用户对风险的判断，虽然不影响真实资金） | `liquidationPrice()` 保持薄包装、逐字不改内部数学，只多返回一个 reason；跑现有 `liquidation.test.ts`/`preview.test.ts`/`views.test.ts` 全绿再合入 |
| 前端 reason 映射表漏了某个枚举值，导致某种情况下 title 是 `undefined`（看起来像没有提示） | 低 | 低（回到"看不到提示"的老问题，但不会显示错误信息） | AC-005 要求有兜底文案；TS 的 union 穷尽性配合 `satisfies` 或 `never` 检查，映射表漏枚举值时编译期报错 |
| `MARK_PRICE_MISSING` 场景下，`missingMarkPrices` 还没被前端拉取到（时序问题） | 低 | 低（提示文案退化成不点名具体币对，仍然给出"全仓行情未到齐"这个大类原因） | `liquidation-reason.ts` 的映射函数对空数组场景做兜底：不点名也照常给出大类说明，不拼出"全仓模式下账户里还有 [] 没收到标记价"这种空列表的怪句子 |

## 7. 实施计划

### Phase 1: 引擎与服务端
- [ ] `packages/engine`：`liquidation.ts` 新增 `LiquidationNullReason` 类型 + `liquidationPriceDetailed()`，`liquidationPrice()` 改为薄包装
- [ ] `packages/engine`：`types.ts` 的 `PositionView` 新增 `liquidationUnavailableReason` 字段；`views.ts` 的 `liquidationPriceOf()` 计算并回传 reason（含 `MARK_PRICE_MISSING` 分支）
- [ ] `apps/server`：`api/serialize.ts` 的 `positionJson()` 透传新字段；`ws/serialize.ts` 的 `closedPositionPayload` 补 `liquidationUnavailableReason: null`

### Phase 2: 前端
- [ ] `apps/web`：`server-api-module/position/types.ts` 的 `Position` DTO 镜像新字段
- [ ] `apps/web`：新增 `app/trade/_lib/liquidation-reason.ts`（reason + missingMarkPrices → tooltip 文案的纯函数），含单测
- [ ] `apps/web`：`positions-table.tsx` 接入该函数，替换现有合并版 `title`
- [ ] `apps/web`：`/rules` 页面「强平」小节文案同步为三种具体原因

### Phase 3: 完善
- [ ] 单元测试覆盖率查漏（`liquidation.test.ts` / `views.test.ts` / `liquidation-reason.test.ts` 的分支覆盖）
- [ ] 浏览器验收：至少验证"保证金过于充足"这一最常见分支的 tooltip 文案，以及"强平价有值时不出现 title"（AC-006）不回归

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-09-25 | `liquidationPrice()` 保留原签名，新增 `liquidationPriceDetailed()` 承载 reason | 把"AC-004 不破坏现有调用方"这条硬约束落到接口设计上，而不是靠人肉检查所有调用点 |
| 2026-09-25 | `MARK_PRICE_MISSING` 的具体缺失币对复用账户级 `missingMarkPrices`，不新增单独字段 | 这份数据账户视图早就有、前端也早就在用（`account-panel.tsx`），没必要为同一份信息在仓位视图里再传一遍 |
| 2026-09-25 | 契约形态定为 `table`，不新建 `packages/contracts` | 沿用项目现有的"后端 handler + 前端镜像类型"惯例，见 §3.1 |
