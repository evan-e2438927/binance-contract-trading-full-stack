# 需求文档

## 基本信息

- **采集时间**: 2026-09-25 22:40:00
- **迭代序号**: 003
- **输入类型**: text（对话）
- **变更类型**: fix
- **Slug**: liquidation-price-null-reason-fix
- **业务优先级**: P2(中)
- **技术风险**: 低
- **Change Size**: Small

## 原始需求

用户贴了 `/rules` 页面「强平」小节的现有文案（触发条件、执行顺序、"不做部分强平/无保险基金"、以及"强平价显示 `--` 的两种情况"），
并反馈：在交易页面确实没有看到强平价格，想知道为什么、能不能修复。

## 排查过程（主会话内已完成，未改代码）

1. 读了 `apps/web/src/app/trade/_ui-components/records/positions-table.tsx`：持仓表"强平价"列已经在
   2026-09-24 的 002 号迭代里加过 `title` 提示（`position.liquidationPrice ? undefined : "保证金相对仓位充足，或全仓行情还没到齐时算不出强平价，不是故障"`），
   该迭代已 accepted。
2. 用 `AskUserQuestion` 两轮澄清，定位到用户说的具体场景：**持仓列表里已经有仓位，强平价列还是 `--`**；
   进一步确认：鼠标悬停时**能看到**现有的提示文字，但用户明确表示——不满足于"这是正常的 `--`"这句笼统的话，
   **想知道自己这笔仓位具体是因为哪一种原因算不出来**。
3. 追到 `packages/engine/src/liquidation.ts` 的 `liquidationPrice()`：
   - 返回 `null` 实际有两条独立路径：
     a. 分母为 0（双向持仓模式下，同一币对的多空仓位数量接近对冲，价格怎么走权益都不会跌破维持保证金）——`liquidation.ts:113`
     b. 算出来的价格 ≤ 0（保证金相对仓位过于充足，价格跌到 0 也不会触发强平）——`liquidation.ts:101`
4. 追到 `packages/engine/src/views.ts` 的 `liquidationPriceOf()`：全仓模式下还有第三条路径——
   c. 账户里其它全仓币对还没收到标记价，算不出全仓强平价（`views.ts:157`，账户级已有 `missingMarkPrices` 可以点名具体币对）。
5. 现状：**前端只有一句合并文案覆盖 (b)+(c)，完全没提 (a)**；`/rules#liquidation` 页面的文案同样只写了两种情况。
   用户看到的"强平价 --"如果恰好命中 (a)（双向对冲），会看到一句跟自己情况对不上号的提示，这就是"看不到强平价格、也不知道为什么"的真实原因。
6. 这不是计算逻辑的 bug——`liquidationPrice()` 的数学结果是对的（第 13 讲已经用币安 FAQ 算例核对过），
   缺的是"把已经算出来的、具体是哪一种原因，如实说给用户看"，这恰好是根 `CLAUDE.md`「宁可说做不到，不要编数字」原则的延伸：
   不但不编数字，「说不出来」的时候也要说清楚具体说不出来的原因，而不是用一句话糊弄三种不同情况。

## 需求详情

### 需求项 1（R-001）
- **描述**: 持仓表"强平价"列显示 `--` 时，`title` 提示要能区分具体是哪一种原因（对冲 / 保证金过于充足 / 全仓行情未到齐），而不是合并成一句话；全仓行情未到齐时要点名缺失标记价的具体币对。
- **置信度**: 高（已通过 AskUserQuestion 两轮交互确认）
- **标注**: [✅ 已确认（用户选择 + 自由描述）]

### 需求项 2（R-002）
- **描述**: `packages/engine` 侧要能区分并对外暴露上述几种 null 原因，且不能改变 `liquidationPrice()` 这个纯函数已有调用方（包括其它测试文件）的行为——即新增能力，不做破坏性变更。
- **置信度**: 高
- **标注**: [✅ 已确认]

### 需求项 3（R-003）
- **描述**: `/rules#liquidation` 页面「强平价显示 `--`」这段说明文字要同步改成三种具体原因，遣词依旧不编数字、不承诺"很快会有值"。
- **置信度**: 高
- **标注**: [✅ 已确认]

## 验收标准

### AC-001: 保证金过于充足时的具体提示（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 一个逐仓或全仓仓位，强平公式算出的价格 ≤ 0（保证金相对仓位过于充足）
- **When**: 用户在持仓表把鼠标悬停在该行"强平价"单元格
- **Then**: 单元格显示 `--`，`title` 文案明确写"保证金相对仓位过于充足，价格跌到 0 也不会触发强平"这一具体版本（不是合并版）
- **验证方式**: unit（engine reason 分支）+ playwright-mcp（对能稳定复现该场景的账户）

### AC-002: 双向对冲时的具体提示（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 双向持仓模式下，同一币对的多空仓位数量接近对冲，强平公式分母为 0
- **When**: 用户悬停该行"强平价"单元格
- **Then**: `title` 文案明确写"多空仓位对冲，理论上不会被强平"相关说明，与 AC-001 的文案不同
- **验证方式**: unit（engine reason 分支）

### AC-003: 全仓行情未到齐时点名具体币对（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 全仓模式下，账户里某个其它全仓币对还没收到标记价
- **When**: 用户悬停该行"强平价"单元格
- **Then**: `title` 文案写"全仓模式下账户里还有币对没收到标记价"，并点名列出缺失标记价的具体币对（取自账户级 `missingMarkPrices`，不是重新猜一份）
- **验证方式**: unit（engine reason 分支 + 前端 tooltip 拼接逻辑）

### AC-004: 旧调用方行为不变（Error / 兼容性）
- **关联需求**: R-002
- **场景维度**: error
- **Given**: `packages/engine` 内外部现有调用 `liquidationPrice()`（旧签名 `Fixed | null`）的地方（含 `preview.ts` 的下单预估、以及各 `.test.ts`）
- **When**: 本次改动上线后，这些调用点原样不动
- **Then**: 返回值、类型、行为与改动前完全一致，相关既有测试全部照常通过，不因为本次改动被迫修改
- **验证方式**: unit（跑现有 `liquidation.test.ts` / `preview.test.ts` / `views.test.ts` 全部通过）

### AC-005: 理论上不可达的兜底分支不崩溃（Boundary）
- **关联需求**: R-002
- **场景维度**: boundary
- **Given**: `legs` 为空这种在 `views.ts`/`preview.ts` 调用路径下理论上不会出现的边界（防御性分支，仅在直接调用 `liquidation.ts` 底层函数时才可能触发）
- **When**: 引擎计算 reason
- **Then**: 不抛异常，返回一个兜底 reason；前端遇到未识别的 reason 值时显示一句通用兜底文案，而不是白屏或崩溃
- **验证方式**: unit

### AC-006: 强平价有真实数值时不出现提示（UI State）
- **关联需求**: R-001
- **场景维度**: ui-state
- **Given**: 某持仓的 `liquidationPrice` 有具体数值（不是 `null`）
- **When**: 用户悬停该单元格
- **Then**: 不出现任何 `title` 提示（不遮挡真实数值本身的可读性；这条是 002 号迭代已有行为，本次不能破坏）
- **验证方式**: unit / playwright-mcp

### AC-007: 规则页文案同步为三种具体原因（Happy Path）
- **关联需求**: R-003
- **场景维度**: happy-path
- **Given**: 用户打开 `/rules#liquidation`
- **When**: 阅读"强平"小节最后一段（强平价显示 `--` 的说明）
- **Then**: 能看到三种具体原因（对冲 / 保证金过于充足 / 全仓行情未到齐），措辞不编造具体数字、不承诺"很快会有值"，与持仓表 tooltip 的三种文案口径一致（不要求逐字相同，但含义必须对得上）
- **验证方式**: manual（走查文案）

## 非功能性需求

| ID | 类别 | 描述 | 验收指标 |
|----|------|------|----------|
| NFR-001 | 性能 | 新增的 reason 判断复用已有的强平价计算路径，不重复跑一遍完整公式 | 每次仓位视图计算只走一遍 `liquidationPriceDetailed`，不新增 O(n) 以上的额外扫描 |
| NFR-002 | 安全 | 不涉及新的用户输入或权限面 | N/A |
| NFR-003 | 兼容性 | 不改变 `liquidationPrice()` 现有导出签名和行为 | 见 AC-004 |
| NFR-004 | 可访问性 | N/A（沿用现有 `title` 原生 tooltip 机制，和 002 号迭代一致） | N/A |

## 需求边界

### 包含 (In Scope)
- `packages/engine`：新增一个能区分具体 null 原因的函数/类型，`liquidationPrice()` 本身保持不变（内部实现可以复用，但对外签名、行为不变）。
- `packages/engine`：`PositionView` 新增 `liquidationUnavailableReason` 字段，`views.ts` 的 `liquidationPriceOf()` 计算并回传该原因。
- `apps/server`：`serialize.ts`（REST + WS 共用的 `positionJson()`）透传新字段；`ws/serialize.ts` 的 `closedPositionPayload` 同步补上该字段（值为 `null`）。
- `apps/web`：`server-api-module/position/types.ts` 的 `Position` DTO 镜像新增字段；持仓表 `positions-table.tsx` 的 tooltip 按具体原因分文案，全仓行情未到齐时点名缺失币对；`/rules#liquidation` 文案同步。

### 不包含 (Out of Scope)
- **下单面板（`order-panel.tsx`）"强平价" 预估行的 `--` 说明**：用户在第一轮澄清里确认这次要改的是持仓表，不是下单面板；下单面板的 `previewOrder` 预估目前完全没有 tooltip，留作后续迭代（见"未来考虑"）。
- 不改动 `liquidationPrice()` 的计算公式本身——第 13 讲已经用币安 FAQ 算例核对过，本次只是把已经算对的"为什么是 null"如实说出来，不涉及数值逻辑变更。
- K 线图上的强平线（`chart-lines.ts`）、"强平记录"tab（`liquidations-tab.tsx`）、开仓确认弹窗（`confirm-order-dialog.tsx`）的强平价展示——这些都是"已经有值就显示，没有就 `--`"的既有逻辑，本次不动。
- `docs/design/07-binance-reference.md` 不需要更新：本次是我们自己引擎的 null 原因分类，不是核对币安的规则数字。

### 未来考虑 (Future Considerations)
- 下单面板"预估强平价"也补上同样细分的 reason 提示（复用本次引入的 reason 类型，`preview.ts` 的 `warnings: string[]` 已经有现成的机制可以塞进去）。

## UI/UX 约束

- **设计稿**: 无（沿用 002 号迭代已经落地的 `title` 原生 tooltip 交互方式，不新增弹层/图标）
- **交互规范**: 悬停单元格出现浏览器原生 `title` 提示；不新增点击行为
- **响应式要求**: 默认（沿用持仓表现有的横向滚动布局，`min-w-[1100px]`）
- **动画/过渡**: 默认（无特殊要求）

## 变更影响评估

- **Breaking Changes**: 否（`liquidationPrice()` 导出签名不变；`PositionView`/`Position` DTO 只新增字段，不删改现有字段）
- **数据库变更**: 否（reason 是实时算出来的派生值，不落库，不影响 `ledger_entries`/`accounts.wallet_balance` 的资金守恒）
- **API 变更**: 是——`GET /account/positions` 响应体和 WS `position` 推送新增 `liquidationUnavailableReason` 字段（新增字段，向后兼容，不是破坏性变更）
- **配置变更**: 否

## 外部依赖

无。

## 假设标注

无低置信度项遗留——本次需求在采集阶段就已经通过两轮 `AskUserQuestion` 交互式选择询问完成澄清（详见下方「假设记录」），
不存在"从未提问就直接假设"的情况，满足澄清 Gate（provenance 全部为 `asked`）。

## 假设记录

| ID | 关联 | 假设内容 | 状态 | 确认人 | 确认时间 |
|----|------|----------|------|--------|----------|
| ASM-001 | R-001 | 用户说的"看不到强平价"具体位置 | confirmed | interactive（4 选项中选择"持仓列表：已经有仓位，强平价列还是 --"） | 2026-09-25 |
| ASM-002 | R-001 | 现有 002 号迭代加的 tooltip 是否生效、用户是否满足于"合理的 --" | confirmed | interactive（自由文本："我不想要显示 -- 我想知道为什么算不出强平价格。"——明确要具体原因，不是要改文案措辞或修复 UI 没生效的问题） | 2026-09-25 |
| ASM-003 | R-001（Out of Scope） | 下单面板"预估强平价"是否也要一起改 | confirmed | interactive（第一轮澄清时用户在 4 个候选位置里选了"持仓列表"，排除了"下单面板"选项） | 2026-09-25 |
