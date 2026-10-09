# Track 汇报：frontend

- 状态: done
- 执行者: main
- 完成时间: 2026-09-25T19:20:00+08:00

## 完成的任务与 AC

- T-001: AC-007 ✅, 旧链接兼容性 ✅
- T-002: AC-001 ⚠️（已实现，无组件渲染测试基础设施验证，见「与设计的偏差」；等 qa 浏览器验收）, AC-008 ✅, NFR-004 ✅
- T-003: AC-001 ⚠️（同上，等 qa）, AC-002 ✅, AC-003 ⚠️（等 qa）, AC-004 ⚠️（等 qa）, AC-005 ⚠️（等 qa）, AC-006 ⚠️（文案已逐字复制，等 qa 确认渲染）
- T-004: AC-011 ⚠️（等 qa）, AC-012 ⚠️（等 qa）, AC-013 ✅, AC-014 ✅, AC-015 ⚠️（已转 T-007 用 playwright-mcp 验证）
- T-005: AC-009 ⚠️（等 qa）, AC-010 ⚠️（等 qa）, AC-016 ✅, AC-017 ✅, AC-018 ✅, AC-007（收尾）✅

## 修改的文件

- apps/web/src/app/leaderboard/_lib/period.ts（精简，去掉 days/CurveDays）
- apps/web/src/app/leaderboard/_ui-components/sparkline.tsx（新增）
- apps/web/src/app/leaderboard/_ui-components/hero-panel.tsx（新增）
- apps/web/src/app/leaderboard/_ui-components/ranking-table.tsx（改版：列头、排名列、头像）
- apps/web/src/app/leaderboard/_ui-components/leaderboard-view.tsx（重写为单栏布局）
- apps/web/src/app/leaderboard/_ui-components/my-rank.tsx（删除，职责并入 hero-panel.tsx）
- apps/web/src/app/leaderboard/_ui-components/equity-curve-panel.tsx（删除，职责并入 hero-panel.tsx）
- apps/web/src/app/leaderboard/_ui-components/equity-chart.tsx（删除，职责由 sparkline.tsx 精简取代）

## 新增的测试

- apps/web/src/app/leaderboard/_lib/period.test.ts（更新：移除 days 相关用例，新增「历史遗留 days 参数被忽略」用例；覆盖 T-001 的 AC-007）

## 公共文件修改请求

无（未修改 package.json / lockfile / 根配置；design.md「### 5.3 新增依赖」为"无"，未安装任何新依赖）

## 与设计的偏差

1. **测试策略调整**（design.md 已同步登记设计决策）：原 tasks.md T-006 计划新增 `ranking-table.test.tsx`/`hero-panel.test.tsx` 组件渲染测试。实现时发现 `apps/web/vitest.config.ts` 的 `include` 只匹配 `src/**/*.test.ts`，且仓库无 `@testing-library/react`（`packages/ui` 组件测试数为 0，见 `.claude/TEST_BASELINE.md`）——这是项目既有测试基线。为避免违反 requirements.md 自定的 NFR-003（不引入新依赖），改为：
   - AC-002（胜率 null → PLACEHOLDER）：复用已测试的 `formatRatioAsPercent(null)` 行为
   - AC-013（空昵称头像 `?`）：复用已测试的 `avatarInitial("")` 行为
   - AC-015（XSS 安全）：验证方式从 `unit` 改为 `playwright-mcp`，转入 T-007（qa）
   - requirements.md AC-015、tasks.md T-004/T-006/T-007 均已同步更新
2. **头像/排名实现复用了现成组件**：没有新建头像组件或首字母提取逻辑，直接复用 `apps/web/src/components/letter-avatar.tsx`（`LetterAvatar`）+ `apps/web/src/app/_shared/ui-components/app-header/account-display.ts`（`avatarInitial()`）——这是设计阶段未预料到的现成实现，design.md 已补一条设计决策记录说明理由（复用优于重造，且 `avatarInitial("")` 恰好返回 `"?"`，与 ASM-006 假设吻合）
3. **sparkline 颜色**：design.md/tasks.md 未明确规定颜色，实现时按「窗口内涨跌决定颜色（up/down），和页面其它地方 `DirectionText` 同一套语义」处理，而不是固定用品牌色（原 `EquityChart` 用固定品牌色）——这是 Figma 截图本身显示绿色曲线、但设计文档未细化到这个程度时做的合理延伸，非静默凭空决定；已在代码注释中说明理由

## 阻塞说明

无
