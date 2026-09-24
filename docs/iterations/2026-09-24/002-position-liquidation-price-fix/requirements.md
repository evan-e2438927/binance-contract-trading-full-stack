# 需求文档

## 基本信息

- **采集时间**: 2026-09-24
- **迭代序号**: 002
- **输入类型**: text + 截图
- **变更类型**: fix
- **Slug**: position-liquidation-price-fix
- **业务优先级**: P2(中)
- **技术风险**: 低
- **Change Size**: Micro

## 原始需求

用户在 `/trade/BTCUSDT` 页面反馈：持仓列表里"强平价"列显示 `--`，标记价（84,720.8）和保证金比率（0.08%）都正常显示。用户怀疑是 bug。

## 排查结论

只读排查（未改代码前）定位到：

1. 前端 `positions-table.tsx` 的判断逻辑（`position.liquidationPrice ? ... : PLACEHOLDER`）没有问题——字段是字符串，不存在 bigint 0 被当 falsy 的情况。
2. 强平价来自后端只读视图 `packages/engine/src/views.ts` → `liquidationPriceOf()` → `packages/engine/src/liquidation.ts` 的 `liquidationPrice()`。
3. `liquidationPrice()` 的实现和注释（`liquidation.ts:83-85`）明确写着：**算出的价格 ≤ 0（钱包余额相对仓位过于充足，任何正价格都不会触发强平）时返回 `null`，不编一个数**——这和"币安这两种情况显示 0 / `--`"的行为对齐，也是根 `CLAUDE.md` 「宁可说做不到，不要编数字」这条硬约束的直接体现。
4. 结合截图里保证金比率只有 0.08%（极安全），这次的 `--` 大概率就是命中了这个"保证金相对仓位过于充足，理论强平价不在合法区间内"的正常分支，**不是代码 bug**。
5. 该分支还有第二条触发路径：全仓模式下，只要账户里任意一个其他全仓币对还没收到标记价，当前币对的强平价也会一起返回 `null`（`views.ts:156-157`）——这条路径是"行情没到齐就不编数字"的同一原则，同样合法。

## 影响范围

- 不改动任何计算逻辑（`packages/engine` 不动，不产生资金/风控行为变化）。
- 仅在展现层补充说明，避免用户把"正确的 `--`"误当成故障：
  - `apps/web/src/app/trade/_ui-components/records/positions-table.tsx`：强平价表头加 `?` 规则链接；`--` 状态补 `title` 提示。
  - `apps/web/src/app/rules/page.tsx`：「强平」小节补一段说明 `--` 出现的场景。

## 验收标准

### AC-001: 强平价表头有规则说明入口
- **Given**: 用户在持仓列表中看到"强平价"列
- **When**: 鼠标悬停/点击表头旁的 `?`
- **Then**: 跳转到 `/rules#liquidation`，能看到说明

### AC-002: `--` 状态有 title 提示，不误导用户
- **Given**: 某持仓的 `liquidationPrice` 为 `null`（`--`）
- **When**: 鼠标悬停该单元格
- **Then**: 出现 `title` 提示，说明这是保证金充足/行情未到齐时的正常状态，不是故障
- **Given**: 某持仓 `liquidationPrice` 有值
- **When**: 鼠标悬停
- **Then**: 不出现该提示（不覆盖真实数值本身的可读性）

### AC-003: 规则页补充说明
- **Given**: 用户打开 `/rules#liquidation`
- **When**: 阅读"强平"小节
- **Then**: 能看到"强平价显示 `--` 是什么情况"的说明，且措辞不编造具体数字、不承诺"很快会有值"
