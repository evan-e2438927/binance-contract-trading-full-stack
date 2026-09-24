# 任务分解

## 任务总览

- [x] T-001 持仓表强平价列补充规则说明入口与 `--` 提示
- [x] T-002 规则页「强平」小节补充 `--` 场景说明
- [x] T-003 验证能力检测 + lint / 现有测试跑一遍
- [x] T-004 回写任务状态

## 任务 Track 汇总（按角色视图）

| Track | 任务 |
| --- | --- |
| frontend | T-001, T-002 |
| unit-test | T-003 |

## 任务详情

### T-001 持仓表强平价列补充规则说明入口与 `--` 提示
- Track: frontend
- 文件: `apps/web/src/app/trade/_ui-components/records/positions-table.tsx`
- 内容: 表头旁加 `RuleLink`；`--` 单元格加 `title` 提示
- 验收: AC-001, AC-002

### T-002 规则页「强平」小节补充 `--` 场景说明
- Track: frontend
- 文件: `apps/web/src/app/rules/page.tsx`
- 内容: 在 `RULE_ANCHORS.liquidation` 小节补一段说明
- 验收: AC-003

### T-003 验证能力检测 + lint / 现有测试跑一遍
- Track: unit-test
- 内容: 检测 lint / unit test / Playwright 能力；跑 `apps/web/src/app/rules/_lib/sections.test.ts` 与 web 侧 lint
- 验收: 报告 Passed / Not Available / Not Applicable / Blocked

### T-004 回写任务状态
- Track: frontend
- 内容: 完成后把本文件的任务勾选为 `[x]`
