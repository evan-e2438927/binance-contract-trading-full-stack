# 设计文档

## 需求摘要

见 `requirements.md`。结论：强平价显示 `--` 是 `packages/engine` 按设计返回的合法结果（保证金相对仓位过于充足，或全仓下有其他币对标记价未到齐），不是计算 bug。本次改动**不碰引擎/后端逻辑**，只在展现层补充说明，对齐仓库既有的 `RuleLink "?"` 说明模式（`account-panel.tsx` 对"保证金比率"的做法），避免用户误判为故障。

## 是否沿用既有结构

沿用。不新增目录、不新增 workspace、不改依赖方向。复用已有组件：
- `@/components/rule-link`（`RuleLink`，见 `apps/web/src/components/rule-link.tsx`）
- `/rules` 页面既有的 `RULE_ANCHORS.liquidation` 锚点（`apps/web/src/lib/config/rule-anchors.ts:19`，`apps/web/src/app/rules/_lib/sections.ts:37` 已注册，无需新增锚点/新增段落 id）

**无架构变更**。

## 影响文件

1. `apps/web/src/app/trade/_ui-components/records/positions-table.tsx`
   - 表头"强平价"旁加 `<RuleLink anchor="liquidation" label="强平价怎么算" />`（对齐 `account-panel.tsx:111` 对"保证金比率"的写法）
   - 值单元格：`liquidationPrice` 为 `null` 时，给 `<span>` 加 `title`，说明这是正常状态；有值时不加（不干扰正常读数）

2. `apps/web/src/app/rules/page.tsx`
   - 在既有 `<H3 id={RULE_ANCHORS.liquidation}>强平</H3>` 小节末尾（执行顺序 `Bullets` 之后、`两点和真实交易所不同` 段落之后）补一段 `<P>`，说明"强平价显示 `--`"对应的两种合法场景

不涉及：
- `packages/engine` / `apps/server`（计算逻辑、API 契约不变）
- 数据模型（`liquidationPrice: Fixed | null` 字段定义本就如此，见 `packages/engine/src/types.ts:425`）
- 路由、锚点表（复用现有 `liquidation` 锚点，不新增）

## 验收方式

- 单元测试：本次是纯文案/展现层改动，不涉及新增逻辑分支，参照 `micro-change-mode.md`「纯视觉样式可不强制新增 unit test」——不新增测试文件。仍跑一遍现有 `apps/web/src/app/rules/_lib/sections.test.ts`（校验锚点表完整性）确认未破坏。
- lint：`pnpm --filter web run lint`（或仓库统一 biome 命令）
- 浏览器验收（非 `--qa` 模式，手动核对即可）：
  1. 打开 `/trade/BTCUSDT`，确认强平价表头旁出现 `?`，点击跳转到 `/rules#liquidation` 且定位正确
  2. 若当前账户有 `liquidationPrice` 为 `--` 的持仓，悬停该单元格出现说明文字
  3. 打开 `/rules#liquidation`，确认新增说明段落展示正常、措辞符合仓库"不编数字"原则
