# 测试覆盖度分析报告

## 基本信息

- **生成时间**: 2026-09-25 19:30:00
- **迭代**: docs/iterations/2026-09-25/001-leaderboard-page-redesign-refactor/
- **测试框架**: vitest
- **E2E 框架**: Playwright

## 查漏说明（重要）

本次迭代未新增独立的组件渲染测试。原因（详见 `tracks/frontend.md`「与设计的偏差」第 1 条）：`apps/web/vitest.config.ts` 的 `include` 只匹配 `src/**/*.test.ts`，仓库无 `@testing-library/react`，`packages/ui` 组件测试数为 0（`.claude/TEST_BASELINE.md`）——这是项目既有测试基线。查漏时确认：本次改动涉及的边界行为（胜率 null、空昵称占位符、缺快照断开、URL 参数忽略）全部复用了**已存在且仍通过**的纯函数单测，不属于遗漏；剩余的可视化/交互类 AC 按项目惯例走 `qa` 浏览器验收。

## 单元测试覆盖

| 模块 | 覆盖方式 | 覆盖的验收标准 |
|------|----------|----------------|
| `_lib/period.ts` | 直接新增/更新用例（`period.test.ts`） | AC-007（本任务自定义补充：历史 `days` 参数被静默忽略，非 requirements.md 正式 AC，见下方说明） |
| `_lib/curve.ts`（`buildCurve`，未改动） | 复用既有用例（`curve.test.ts`） | AC-008（`Sparkline` 依赖的分段断开逻辑） |
| `lib/format/number.ts`（`formatRatioAsPercent`，未改动） | 复用既有用例（`number.test.ts:62`） | AC-002（胜率 `null` → `PLACEHOLDER`） |
| `app-header/account-display.ts`（`avatarInitial`，未改动） | 复用既有用例（`account-display.test.ts:40`） | AC-013（空昵称头像占位符 `?`） |
| `_lib/my-row.ts`（`isMyRow`，未改动） | 复用既有用例（`my-row.test.ts`） | AC-014（"我"行判定逻辑部分） |

> 说明：T-001 的任务级 AC 沿用了 `AC-007` 这个 ID 描述"历史 `days` 参数被忽略"，与 requirements.md 正式的 `AC-007`（独立曲线面板已移除，verified via playwright-mcp）并非同一件事——这是任务拆分时的标注疏漏（应另编号，如 `AC-007a`），已记录于此，不影响 requirements.md 正式 AC-007 的覆盖判定（仍按 deferred to qa 处理，见下表）。

## E2E / 浏览器验收覆盖（apply 阶段 deferred）

> apply 阶段不生成 E2E 脚本，下表只登记"留给 qa 命令"的场景，状态恒为 `⏳ deferred to qa`。

| Scenario ID | Requirement IDs | AC-IDs | 场景维度 | 用户场景 | 状态 |
|-------------|-----------------|--------|----------|----------|------|
| E2E-001 | R-001, R-002 | AC-001, AC-003, AC-004, AC-005, AC-006 | happy+ui-state+error | hero 卡片三态（已上榜/未上榜/未登录）+ sparkline 加载/错误态 | ⏳ deferred to qa |
| E2E-002 | R-004 | AC-009, AC-010 | happy+ui-state | 单栏布局响应式（宽/窄视口） | ⏳ deferred to qa |
| E2E-003 | R-005 | AC-011, AC-012, AC-015 | happy+security | 榜单表格奖牌/排名/头像/XSS 文本渲染 | ⏳ deferred to qa |
| E2E-004 | R-003 | AC-007 | boundary | 确认旧曲线面板交互（7/30/90 天切换、tooltip）已彻底移除 | ⏳ deferred to qa |
| E2E-005 | R-006, R-007 | AC-016, AC-017, AC-018 | happy+boundary | 榜单规则说明位置 + 数据更新文案口径 | ⏳ deferred to qa |

## AC 覆盖率汇总（apply 阶段）

> apply 只统计单元测试已覆盖的 AC；E2E / MCP 验证方式的 AC 计入 `deferred to qa`，不计为"未覆盖"。

| 总 AC 数 | 单元测试覆盖 | deferred to qa（E2E/MCP） | 未覆盖（应覆盖但缺测试） |
|----------|-------------|--------------------------|--------------------------|
| 18 | 4（AC-002, AC-008, AC-013, AC-014） | 14（AC-001, AC-003~AC-007, AC-009~AC-012, AC-015~AC-018） | 0 |

### 按场景维度覆盖（仅统计单元测试可覆盖的维度）

| 维度 | 总数 | 单元已覆盖 | deferred to qa | 未覆盖 |
|------|------|-----------|----------------|--------|
| happy-path | 8 | 0 | 8 | 0 |
| error | 1 | 0 | 1 | 0 |
| boundary | 6 | 3（AC-002, AC-008, AC-013） | 3 | 0 |
| ui-state | 4 | 0 | 4 | 0 |
| security | 1 | 0 | 1 | 0 |

> AC-014（happy-path，"我"行判定）实际是"unit + playwright-mcp"复合验证方式，单元部分（`isMyRow` 判定逻辑）已覆盖，计入上表的 boundary 行会低估——为避免重复计数误导，本表按 AC 的主场景维度归类，AC-014 计入 happy-path 总数但因其单元覆盖只是判定逻辑的一部分，不计入"单元已覆盖"列，避免虚报为完全覆盖。

## 待补充测试

无新增边界缺口。以下留给 `qa` 命令做浏览器验收（详见上方 E2E 场景表），不在 apply 阶段处理：

- [ ] hero 卡片三态渲染（未登录 / 未上榜 / 已上榜）
- [ ] sparkline 加载中 / 错误态展示
- [ ] 单栏布局在宽/窄视口下的实际渲染
- [ ] 榜单表格奖牌 emoji / 纯文本排名 / 头像的实际渲染
- [ ] XSS payload 昵称的浏览器端渲染验证（AC-015）
- [ ] 旧权益曲线交互（7/30/90 天切换按钮、tooltip）确实从页面上消失
