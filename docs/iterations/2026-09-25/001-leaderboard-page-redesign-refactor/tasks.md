# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-25/001-leaderboard-page-redesign-refactor/
- **生成时间**: 2026-09-25 18:40:00
- **基于设计**: design.md

## 任务总览

| Phase | 任务数 | 总工时 |
|-------|--------|--------|
| Phase 1: 基础重构 | 1 | 1h |
| Phase 2: 核心组件 | 4 | 13h |
| Phase 3: 完善 | 2 | 7h |
| **合计** | **7** | **21h** |

## 任务 Track 汇总（按角色视图）

| Track      | 任务数 | 总工时 | 任务 ID                          |
|------------|--------|--------|-----------------------------------|
| frontend   | 5      | 14h    | T-001, T-002, T-003, T-004, T-005 |
| backend    | 0      | 0h     | —                                  |
| shared     | 0      | 0h     | —                                  |
| infra      | 0      | 0h     | —                                  |
| unit-test  | 1      | 4h     | T-006                              |
| qa         | 1      | 3h     | T-007                              |
| **合计**   | **7**  | **21h**|                                    |

> 项目遵循 `.claude/CLAUDE.md`「测试文件与源码同目录共存（`<name>.test.ts`）」的既有约定（非独立 `tests/unit/` 镜像目录），见 `.claude/EXISTING_STRUCTURE.md`「与 Better-T-Stack 默认约定的偏离」。T-006 的目标文件因此仍落在 `apps/web/src/app/leaderboard/` 下，而非 `tests/unit/web/`。

## Phase 1: 基础重构

### [x] T-001: 精简 leaderboard 的 URL query 状态（去掉曲线天数）

**描述**: 移除 `_lib/period.ts` 中和权益曲线天数切换相关的导出（`CURVE_DAYS`、`CurveDays`、`DEFAULT_DAYS`），`LeaderboardQuery` 只保留 `period` 字段；`parseLeaderboardQuery`/`leaderboardHref` 同步简化，不再读写 `days` query 参数。

**目标文件**:
- apps/web/src/app/leaderboard/_lib/period.ts

**Track**: frontend

**适用规范**: 无（无命中的项目自定义 skill）

**Requirement IDs**:
- R-003
- R-004

**验收标准**:
- [x] **AC-007** (boundary): Given 页面渲染完成，When 检查 URL query 处理逻辑，Then `parseLeaderboardQuery` 不再解析 `days` 参数，`leaderboardHref` 不再写入 `days` 参数（`period.ts` 已移除 `days` 相关代码，`period.test.ts` 验证通过）
- [x] 旧链接兼容性（design.md 风险评估）: Given URL 带有历史遗留的 `?days=90`，When `parseLeaderboardQuery` 解析，Then 该参数被静默忽略，不报错、不影响 `period` 解析（`period.test.ts`「历史遗留的 days 参数被静默忽略」用例通过）

**依赖关系**: 无

**复杂度**: S

**预估工时**: 1h

---

## Phase 2: 核心组件

### [x] T-002: 新增 sparkline 展示组件

**描述**: 新增 `sparkline.tsx`，基于 `_lib/curve.ts` 的 `buildCurve()` 输出画一条精简版权益曲线（无坐标轴、无 tooltip、无交互、不可切换天数），线条样式（2px 圆角描边、10% 透明度面积填充、缺口断开分段）沿用 `equity-chart.tsx` 现有画法但去除所有交互层（`onPointerMove`/`onPointerLeave`/十字线/悬浮框/可访问性数据表格）。`<svg>` 标注 `role="img"` + 简要 `aria-label`（如「近 30 天权益曲线，最低 X，最高 Y USDT」）。

**目标文件**:
- apps/web/src/app/leaderboard/_ui-components/sparkline.tsx

**Track**: frontend

**适用规范**: `dataviz` 通用原则（复用于 `equity-chart.tsx` 现有注释：线条视觉语言与站内其他图表保持一致；本组件为纯装饰图，不做 tooltip）

**Requirement IDs**:
- R-001
- R-003

**验收标准**:
- [ ] **AC-001** (happy-path，部分): Given `equity-curve` 数据已返回且至少一个快照点，When 渲染 `Sparkline`，Then 画出对应折线，最右端为当前实时权益点（已实现，无组件渲染测试基础设施验证，等 qa 浏览器验收确认，见 T-006 实现记录）
- [x] **AC-008** (boundary): Given 30 天数据中某天缺失快照，When 渲染 `Sparkline`，Then 折线在该处断开为独立线段（直接复用 `buildCurve()` 的 `segments`，`curve.test.ts` 既有用例已覆盖分段逻辑本身，`Sparkline` 组件只是消费该输出，未新写分段计算）
- [x] **NFR-004** (可访问性): Given `Sparkline` 渲染完成，When 检查其 `<svg>`，Then 存在 `role="img"` 与非空 `aria-label`；不存在原 `EquityChart` 的 `<table className="sr-only">` 可访问性数据表格、不存在 `onPointerMove`/悬浮框相关代码（源码直接确认：`sparkline.tsx` 无 `onPointerMove`/tooltip/`<table>`，`<svg>` 带 `role="img"` + 动态 `aria-label`）

**依赖关系**: 无（`curve.ts` 已存在且不改动）

**复杂度**: M

**预估工时**: 3h

---

### [x] T-003: 新增 hero-panel 组件（排名统计 + sparkline，三态）

**描述**: 新增 `hero-panel.tsx`，取代 `my-rank.tsx` + `equity-curve-panel.tsx` 的组合职责。渲染三种状态：
1. 未登录：沿用 `my-rank.tsx` 现有「登录后看自己的名次和权益曲线」文案 + 登录按钮（`useUiStore.setLoginOpen(true)`），套进新的渐变金边框 hero 卡片外观（`border-brand/30` + `linear-gradient` 背景，参照 Figma `4:6114` 节点样式），此状态不渲染统计区/sparkline（无数据可展示）
2. 已登录但未上榜（`myRank === null`）：沿用现有「这一期还没上榜。可能是：」+ 三条原因列表，同样套进新 hero 卡片外观，不渲染统计区/sparkline
3. 已登录且已上榜：hero 卡片内左侧展示「我的排名 #N」（32px 等宽字体、品牌色），中间四列统计（总收益率/账户权益/胜率/交易次数，胜率为 `null` 时显示 `PLACEHOLDER`），右侧挂载 `Sparkline`（固定调用 `equityCurveQuery(30)`），sparkline 请求中/失败时分别显示「加载中…」/错误文案（复用现有 `EquityCurvePanel` 的加载态、错误态判断分支）

**目标文件**:
- apps/web/src/app/leaderboard/_ui-components/hero-panel.tsx

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002

**验收标准**（可视/交互态未接组件渲染测试，等 qa 浏览器验收确认，见 T-006 实现记录；标 [x] 的项有直接代码级依据）:
- [ ] **AC-001** (happy-path): Given 已登录用户已上榜 `myRank = { rank: 9, roi: "0.3145", equity: "13145", winRate: "0.521", tradeCount: 56 }`，When 渲染 `HeroPanel`，Then 展示 `#9`、`+31.45%`（涨跌色）、`$13,145`、`52.1%`、`56`，右侧展示 `Sparkline`
- [x] **AC-002** (boundary): Given `myRank.winRate` 为 `null`，When 渲染，Then 胜率列显示 `--`（`PLACEHOLDER`），不显示 `0%`（沿用已测试的 `formatRatioAsPercent(null)` → `PLACEHOLDER` 行为，`number.test.ts:62`）
- [ ] **AC-003** (ui-state): Given `equityCurveQuery(30)` 请求中，When 渲染，Then sparkline 区域显示「加载中…」，排名统计区不受影响
- [ ] **AC-004** (error): Given `equityCurveQuery(30)` 请求失败，When 渲染，Then sparkline 区域显示错误文案（`error.message`），不抛出未捕获异常
- [ ] **AC-005** (ui-state): Given 未登录，When 渲染，Then 显示登录提示文案 + 按钮，点击后 `useUiStore.setLoginOpen(true)` 被调用
- [ ] **AC-006** (ui-state): Given 已登录且 `myRank === null`，When 渲染，Then 显示「这一期还没上榜。可能是：」+ 三条原因，文案与现有 `my-rank.tsx` 逐字一致（文案已逐字复制，未跑浏览器验证）

**依赖关系**:
- 前置任务: T-002（`Sparkline` 组件）

**复杂度**: L

**预估工时**: 4h

---

### [x] T-004: 改版榜单表格视觉

**描述**: 修改 `ranking-table.tsx`：
- 列头文案改为「排名/昵称/总收益率/账户权益/胜率/交易次数」（原「收益率/权益/成交笔数」）
- 排名列：第 1/2/3 名显示奖牌 emoji（🥇🥈🥉），不再用圆形色块 `MEDAL` 背景包裹数字；第 4 名及以后显示等宽字体纯文本 `#N`，不带圆形背景（移除 `inline-flex size-5 ... rounded-full` 包裹）
- 昵称列前新增头像圆点：`nickname` 非空时取首字符（大写），`nickname` 为 `null` 时显示占位符 `?`（沿用现有「未设置昵称」文案作为昵称列展示内容）；「我」那一行的头像使用品牌色边框/背景（`bg-brand/20 border-brand text-brand`），非「我」的行用中性色（`bg-elevated border-border text-muted-foreground`）
- 高亮与「我」标签逻辑不变，继续复用 `isMyRow()`

**目标文件**:
- apps/web/src/app/leaderboard/_ui-components/ranking-table.tsx

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-005

**验收标准**:
- [ ] **AC-011** (happy-path): Given 榜单存在第 1/2/3 名，When 渲染排名列，Then 分别显示 🥇/🥈/🥉，无圆形色块背景（已实现，等 qa 浏览器验收确认）
- [ ] **AC-012** (happy-path): Given 榜单存在第 4 名及以后，When 渲染排名列，Then 显示等宽字体纯文本 `#N`，无圆形背景（已实现，等 qa 浏览器验收确认）
- [x] **AC-013** (boundary): Given 某行 `nickname` 为 `null`，When 渲染，Then 头像显示 `?`，昵称列显示「未设置昵称」（头像复用已测试的 `avatarInitial("")` → `"?"`，`account-display.test.ts:40`；昵称列文案分支未改动，沿用原逻辑）
- [x] **AC-014** (happy-path): Given 某行 `isMyRow()` 判定为真，When 渲染，Then 该行背景高亮、昵称旁显示「我」标签、头像使用品牌色样式（`isMyRow()` 本身未改动，`my-row.test.ts` 既有用例仍覆盖判定逻辑；渲染分支是该布尔值的直接消费，无新逻辑）
- [ ] **AC-015** (security，已转 T-007 用 playwright-mcp 验证，见 T-006 实现记录): Given `nickname` 包含 `<script>alert(1)</script>` 等文本，When 渲染该行昵称与头像首字符，Then 以纯文本原样展示，不执行脚本；代码静态确认：`ranking-table.tsx`/`letter-avatar.tsx` 均无 `dangerouslySetInnerHTML`

**依赖关系**: 无（`my-row.ts` 不改）

**复杂度**: M

**预估工时**: 3h

---

### [x] T-005: 重写页面布局为单栏，接入新组件并清理旧组件

**描述**: 重写 `leaderboard-view.tsx`：
- 整体从 `grid-cols-1 lg:grid-cols-[1fr_380px]` 两栏改为单栏，最大宽度 `max-w-[1000px]` 居中
- 顶部挂载 `HeroPanel`（替代原 `<aside>` 里的 `MyRank` + `EquityCurvePanel`）
- 周期切换 `PeriodTabs` 从表格卡片内的 header 行移出，独立成一行，置于 `HeroPanel` 和榜单表格之间；「数据截至 {asOf}（每日 UTC 00:00 快照）」/「每日 UTC 00:00 拍一次权益快照」文案继续展示在该行（**不采用**设计稿字面的「每 30 分钟更新一次」，见 design.md ASM-004）
- 榜单表格（`RankingTable`）置于周期切换行下方
- `RulesNote` 从 `<aside>` 移到表格下方，作为页面最后一个区块
- 删除 `my-rank.tsx`、`equity-curve-panel.tsx`、`equity-chart.tsx`（职责已被 `hero-panel.tsx`/`sparkline.tsx` 取代）

**目标文件**:
- apps/web/src/app/leaderboard/_ui-components/leaderboard-view.tsx
- apps/web/src/app/leaderboard/_ui-components/my-rank.tsx（删除）
- apps/web/src/app/leaderboard/_ui-components/equity-curve-panel.tsx（删除）
- apps/web/src/app/leaderboard/_ui-components/equity-chart.tsx（删除）

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-004
- R-006
- R-007

**验收标准**:
- [ ] **AC-009** (happy-path): Given 桌面宽视口（≥1280px），When 打开 `/leaderboard`，Then 内容区最大宽度约 1000px 居中，不存在独立右侧边栏列（源码已改为 `max-w-[1000px]` 单栏 flex 布局，无 `grid-cols-[1fr_380px]`，等 qa 浏览器验收确认实际渲染）
- [ ] **AC-010** (ui-state): Given 窄视口（375px），When 打开 `/leaderboard`，Then `HeroPanel` 统计区与 sparkline 纵向堆叠，页面无横向滚动条（`hero-panel.tsx` 用 `flex-wrap`，等 qa 浏览器验收确认）
- [x] **AC-016** (happy-path): Given 页面渲染完成，When 滚动到表格下方，Then `RulesNote` 完整展示，内容与现状逐字一致（`rules-note.tsx` 本次未改动一行，只是挂载位置从 `<aside>` 移到主栏末尾，见改动文件清单）
- [x] **AC-017** (happy-path): Given `asOf` 非 null，When 渲染周期切换行，Then 展示「数据截至 {asOf}（每日 UTC 00:00 快照）」（三元表达式与原实现逐字相同，只是从表格卡片内部移到周期切换行，逻辑未变）
- [x] **AC-018** (boundary): Given `asOf` 为 null，When 渲染周期切换行，Then 展示「每日 UTC 00:00 拍一次权益快照」（同上，fallback 分支未改动）
- [x] **AC-007** (boundary，验证收尾): Given 页面渲染完成，When 检查 DOM，Then 不存在原 7/30/90 天切换按钮、悬停 tooltip 浮层、`EquityChart` 相关的可访问性数据表格（源码确认：`equity-curve-panel.tsx`/`equity-chart.tsx` 已删除，`my-rank.tsx` 已删除，全仓库 grep 确认无残留 import）

**依赖关系**:
- 前置任务: T-001, T-003, T-004

**复杂度**: M

**预估工时**: 3h

---

## Phase 3: 完善

### [x] T-006: 单元测试补齐

**描述**: 按项目既有约定（测试文件与源码同目录共存），补齐/更新本次改动涉及的单元测试。

**实现时发现并调整（记录见 design.md「设计决策记录」新增一条）**：本项目 `apps/web/vitest.config.ts` 的 `include` 只匹配 `src/**/*.test.ts`（不含 `.test.tsx`），且仓库任何地方都没有 `@testing-library/react` 依赖——`packages/ui` 的组件测试数是 0（见 `.claude/TEST_BASELINE.md`）。这是项目既有的测试基线，不是遗漏。原计划的 `ranking-table.test.tsx`/`hero-panel.test.tsx`（组件渲染测试）如果真的写出来：① 不会被 vitest 捡到（`include` 过滤掉 `.tsx`）；② 引入 `@testing-library/react` 会违反 requirements.md 里我自己写的 NFR-003（不引入新依赖）。因此改为：
- `period.test.ts`：移除 `days`/`CurveDays` 相关用例，保留/更新 `period` 解析与 `leaderboardHref` 用例；新增「`?days=90` 被静默忽略」用例（已完成）
- AC-002（`winRate === null` → `PLACEHOLDER`）：`hero-panel.tsx`/`ranking-table.tsx` 复用的是已有测试覆盖的 `formatRatioAsPercent(null)` → `PLACEHOLDER`（`apps/web/src/lib/format/number.test.ts:62`），不需要新测试
- AC-013（空昵称头像占位符 `?`）：`ranking-table.tsx` 直接复用已有测试覆盖的 `avatarInitial("")` → `"?"`（`apps/web/src/app/_shared/ui-components/app-header/account-display.test.ts:40`），不需要新测试
- AC-015（XSS 文本原样渲染）：无组件渲染测试基础设施可用，该 AC 的验证方式从 `unit` 改为 `playwright-mcp`，并入 T-007（qa）
- `curve.test.ts`：`buildCurve()` 本身不改动，现有分段断开用例已覆盖 `Sparkline` 依赖场景，无需新增

**目标文件**:
- apps/web/src/app/leaderboard/_lib/period.test.ts

**Track**: unit-test

**适用规范**: 无（测试文件位置遵循 `.claude/CLAUDE.md`「测试文件与源码同目录共存」的既有偏离约定，而非 `tests/unit/` 镜像目录）

**Requirement IDs**:
- R-003
- R-005

**验收标准**:
- [x] **AC-007** (boundary，部分): Given URL 带有历史遗留的 `?days=90`，When `parseLeaderboardQuery` 解析，Then `days` 被静默忽略，`period` 正常解析（`period.test.ts` 新增用例）
- [x] **AC-002** (boundary，间接覆盖): 复用 `apps/web/src/lib/format/number.test.ts` 中 `formatRatioAsPercent(null)` → `PLACEHOLDER` 的既有用例，不新增测试文件
- [x] **AC-013** (boundary，间接覆盖): 复用 `apps/web/src/app/_shared/ui-components/app-header/account-display.test.ts` 中 `avatarInitial("")` → `"?"` 的既有用例，不新增测试文件
- [x] 全量执行: Given 本次改动的所有测试文件，When 执行 `pnpm --filter web test`，Then 全部用例通过，无 skip

**依赖关系**:
- 前置任务: T-001, T-002, T-003, T-004

**复杂度**: L

**预估工时**: 4h（实际因发现可复用既有测试用例而降低）

---

### [ ] T-007: 浏览器验收（qa）

**描述**: 浏览器功能验收规格（Given-When-Then + 选择器约束）。本任务仅描述验收场景，不写实现代码；对应 Playwright 脚本由 `qa` 命令生成并执行。

**目标文件**:
- tests/e2e/leaderboard-page-redesign/E2E-hero-panel.e2e.ts（占位路径，脚本由 `qa` 命令生成）
- tests/e2e/leaderboard-page-redesign/E2E-ranking-table.e2e.ts（占位路径，脚本由 `qa` 命令生成）

**Track**: qa

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002
- R-004
- R-005
- R-006
- R-007

**验收标准**:
- [ ] **AC-001**: Given 已登录且已上榜的测试账号，When 打开 `/leaderboard`，Then hero 卡片区域可见排名/总收益率/账户权益/胜率/交易次数五项统计与 sparkline SVG
- [ ] **AC-005**: Given 未登录，When 打开 `/leaderboard`，Then hero 区域可见「登录 / 注册」按钮，点击后登录弹窗可见
- [ ] **AC-006**: Given 已登录但未上榜的测试账号，When 打开 `/leaderboard`，Then hero 区域可见「这一期还没上榜」文案
- [ ] **AC-009**: Given 桌面宽视口，When 打开 `/leaderboard`，Then 页面截图/布局检查确认无独立右侧边栏列
- [ ] **AC-010**: Given 375px 视口，When 打开 `/leaderboard`，Then 页面无横向滚动条（`document.documentElement.scrollWidth <= clientWidth`）
- [ ] **AC-011/AC-012**: Given 榜单数据完整（≥4 行），When 检查表格，Then 前三行可见奖牌 emoji，第四行起可见 `#4` 纯文本
- [ ] **AC-016**: Given 页面滚动到底部，When 检查 DOM，Then「榜单怎么算」标题与「重置和账户规则 →」链接可见
- [ ] **AC-017/AC-018**: Given 后端返回 `asOf` 非 null 的榜单数据，When 检查周期切换行文案，Then 显示「数据截至 ... 快照」而非「30 分钟」相关文案
- [ ] **AC-015**（从 T-006 转入，见其实现记录）: Given 测试账号昵称设置为包含 `<script>alert(1)</script>` 的字符串，When 打开 `/leaderboard` 且该账号在榜，Then 页面渲染该字符串为可见文本，不触发 `alert`，`list_console_messages` 无相关错误

**依赖关系**:
- 前置任务: T-005

**复杂度**: M

**预估工时**: 3h

---

## 依赖关系图

```
T-001 ──────────────┐
                     │
T-002 ── T-003 ──────┼── T-005 ── T-006 ── T-007
                     │
T-004 ───────────────┘
```

## 任务执行顺序

1. T-001（可与 T-002/T-004 并行）
2. T-002 → T-003（串行，T-003 依赖 `Sparkline`）
3. T-004（可与 T-002/T-003 并行）
4. T-005（依赖 T-001, T-003, T-004 全部完成）
5. T-006（单元测试，依赖 T-001~T-004 代码落地）
6. T-007（qa 浏览器验收，依赖 T-005 页面整体可用）
