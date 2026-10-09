# 技术设计文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-25/001-leaderboard-page-redesign-refactor/
- **生成时间**: 2026-09-25 18:30:00
- **基于需求**: requirements.md

## 设计假设

按 `03-design-generator.md` §0「设计假设显式化」要求，登记所有被假设/用户选择驱动的技术决策：

| 决策点 | 关联 | 所做假设 | 理由 | 若假设错误的影响 |
|--------|------|----------|------|------------------|
| 权益曲线交互能力 | ASM-001 / R-001, R-003 | 完全移除 `EquityCurvePanel`/`EquityChart`（7/30/90 天切换、tooltip、可访问性表格），hero 卡片内只保留固定 30 天的纯展示 sparkline | 用户在 AskUserQuestion 中明确选择"只保留 hero 内的 sparkline，删掉独立面板" | 若用户之后想找回可交互曲线，需要新迭代重新实现类似 `EquityCurvePanel` 的面板；代码已删除不可直接 revert（除非从 git 历史找回） |
| 未登录/未上榜状态视觉 | ASM-002 / R-002 | 沿用现有文案与判断分支（`useAuthStore` status 判断、`myRank === null` 判断），只重新包裹新的 hero 卡片外观（渐变金边框卡片） | 用户明确选择"保留现有文案，套进新 hero 卡片外观" | 低风险；纯样式包装，文案/逻辑零改动 |
| RulesNote 位置 | ASM-003 / R-006 | 保留组件全部内容，从 `<aside>` 侧边栏移到表格下方，作为页面最后一个区块 | 用户明确选择"保留，放到表格下方（单栏布局）" | 低风险；仅改变挂载位置，组件本身不改 |
| 数据更新文案口径 | ASM-004 / R-007 | 沿用现有「数据截至 {asOf}（每日 UTC 00:00 快照）」文案，不采用设计稿字面「每 30 分钟更新一次」 | `leaderboard-view.tsx` 现有代码注释已记录此前核实设计稿这句话是错的；根 `CLAUDE.md`「宁可说做不到，不要编数字」为硬约束，视觉还原不能凌驾于数据准确性之上 | 若按设计稿字面还原会重新引入一个已被团队修正过的错误数字声明，属于违反项目硬约束，不予采纳 |
| 表格列头文案是否随周期变化 | ASM-005 / R-005 | 列头固定显示「总收益率/账户权益/交易次数」，不随日榜/周榜/总榜切换措辞（如不做成"日收益率"/"周收益率"） | 设计稿本身在选中"日榜" tab 的截图里也写的是「总收益率」，判断为设计稿统一措辞而非刻意区分；且这只是标签文字, 不是编造数值，风险低于 ASM-004 那类数字类问题 | 若产品实际想要按周期区分列头措辞，属于纯文案改动，后续可低成本修正，不影响数据/组件结构 |
| 空昵称头像占位符 | ASM-006 / R-005 | 头像圆点在 `nickname === null` 时显示 `?` 字符 | 设计稿 12 行样例数据里没有空昵称场景，需要一个默认兜底；`?` 是最不会引起误解的占位符（不编造首字母） | 低风险；若产品有更明确偏好（如显示默认图标）可在 review 阶段直接改一行代码 |

> ASM-005、ASM-006 属于中置信度、纯文案/占位符类假设，未在 `requirements.md` 澄清阶段单独发起 `AskUserQuestion`（已在同一轮问了 3 道涉及交互/信息架构的题，判断这两项属于低风险余量，集中登记供 `pending_review` 人工复核比再打断用户更合适）。若审核者不同意，请在审核意见中标出，`apply` 阶段据此调整。

## 0. 目录影响声明

### 0.1 目标目录
- `apps/web/src`: 修改 + 新增。仅涉及 `apps/web/src/app/leaderboard/` 目录下的组件与 `_lib` 逻辑；不涉及 `apps/server/src`、`packages/db`、`packages/engine`
- `apps/server/src`: 无变更
- `packages/*`: 无变更（不新增共享模块；`packages/shared` 的 `format`/`parse` 按现状引用，不修改）

### 0.2 新增目录
- 无新增目录。新增文件全部落在已存在的 `apps/web/src/app/leaderboard/_ui-components/` 与 `_lib/` 下

### 0.3 偏离说明
- 无偏离。完全复用 Better-T-Stack 既有的 `apps/web` 结构，未新增顶层目录，未新增 `packages/*`

## 1. 技术方案概要

### 1.1 概述
本次是 `/leaderboard` 页面的纯前端布局重构：把右侧边栏（「我的排名」卡片 + 独立权益曲线面板 + 榜单规则说明）拆解重组为「顶部通栏 hero 卡片（排名统计 + 固定 30 天 sparkline）→ 周期切换 → 榜单表格（改版列头/排名/头像）→ 榜单规则说明」的单栏纵向布局，视觉对齐 Figma 设计稿 node `4:6072`。所有展示数据均来自已有的 `GET /leaderboard`、`GET /account/equity-curve` 接口，接口契约不变。

### 1.2 目标
- 页面布局与视觉对齐 Figma 设计稿（在遵守 ASM-004 数据准确性硬约束的前提下）
- 复用现有的数据获取（`leaderboardQuery`、`equityCurveQuery`）、格式化（`formatUsdt`/`formatRatioAsPercent`/`PLACEHOLDER`）、状态判断（`useAuthStore`、`isMyRow`）逻辑，不重复造轮子
- 复用 `curve.ts` 的 `buildCurve()` 几何计算（分段断开逻辑已有测试覆盖），只新写一个更简单的展示层组件

### 1.3 非目标（Scope 外）
- 不改动 `GET /leaderboard`、`GET /account/equity-curve` 的请求参数或响应结构
- 不改动 `equity_snapshots` 表结构或快照任务 `jobs/equity-snapshot.ts`
- 不实现"权益曲线可交互"的替代方案（该能力按 ASM-001 直接移除，不做低配替代）
- 不改动 `/rules` 页面、顶部导航栏

## 2. 数据模型设计

无数据库/数据模型变更。本次仅复用既有前端类型：

- `apps/web/src/server-api-module/leaderboard/types.ts`：`Leaderboard`、`LeaderboardItem`、`LeaderboardPeriod`（不改）
- `apps/web/src/server-api-module/account/types.ts`：`EquityCurve`（不改，`equityCurveQuery(30)` 固定天数调用）

## 3. 接口契约

- **契约形态**: none（本次需求不涉及任何接口新增/修改）
- **契约文件**: 无

### 3.1 接口表

无变更。为便于开发对照，列出本次复用（只读，不改）的既有接口：

| 方法 | 路径 | 请求体 | 成功响应 | 错误响应 | 认证 | 关联 AC |
|------|------|--------|----------|----------|------|---------|
| GET | /leaderboard | query: `period`, `limit` | 200 `Leaderboard`（见现有 `types.ts`） | 401（token 无效时）| 可选 | AC-001, AC-002, AC-005, AC-006, AC-011~014, AC-017, AC-018 |
| GET | /account/equity-curve | query: `days`（本次固定传 `30`） | 200 `EquityCurve` | 401 / 5xx | 是 | AC-001, AC-003, AC-004, AC-008 |

## 4. 安全考量

### 4.1 认证
不变。`myRank`/权益曲线仍依赖现有 token 鉴权逻辑（`useAuthStore`），本次不修改鉴权流程。

### 4.2 授权
不变。榜单本身公开可见，「我的」相关数据仍要求登录，逻辑不改（沿用 R-002 / ASM-002）。

### 4.3 数据保护
- 昵称渲染继续走 React 默认文本转义，不使用 `dangerouslySetInnerHTML`（AC-015）
- 头像首字符从 `nickname` 截取展示，同样是纯文本渲染，不做任何 HTML 解析

## 5. 依赖关系

### 5.1 内部依赖
- `leaderboard-view.tsx` → `hero-panel.tsx`（新）→ `sparkline.tsx`（新）+ `curve.ts`（复用）+ `leaderboard/queries.ts`、`account/queries.ts`（复用）
- `leaderboard-view.tsx` → `ranking-table.tsx`（改）→ `my-row.ts`（复用，不改）
- `leaderboard-view.tsx` → `period-tabs.tsx`（不改，仅调整挂载位置）
- `leaderboard-view.tsx` → `rules-note.tsx`（不改，仅调整挂载位置）

### 5.2 外部依赖
无新增外部服务依赖。

### 5.3 新增依赖

| 包名 | 版本约束 | 用途 | 归属 Track |
|------|----------|------|------------|
| 无 | - | 本次不新增任何 npm 依赖，sparkline 用原生 SVG（复用 `curve.ts` 已有的坐标计算方式，参考 `equity-chart.tsx` 现有画法精简） | - |

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 删除 `EquityCurvePanel`/`EquityChart` 后用户发现丢失了"切天数/悬停看数值"的功能 | 中 | 中 | 已通过 AskUserQuestion 明确征得用户同意（ASM-001）；在 PR 描述中显式标注这是一次范围内的功能收敛，非疏漏 |
| `period.ts` 简化（去掉 `days`/`CurveDays`）导致遗留的旧 URL（如书签了 `?days=90` 的链接）行为变化 | 低 | 低 | `parseLeaderboardQuery` 对未知 query 参数本来就是忽略处理，`days` 参数被删除后旧链接里的 `?days=90` 会被静默忽略，不报错，只是不再生效——符合"认不出来的参数当成没传"的既有约定 |
| 表格新增头像圆点导致窄屏进一步拥挤 | 低 | 低 | 复用既有 `overflow-x-auto` 横向滚动兜底（AC-010），不额外做移动端专属断点 |
| sparkline 去掉可访问性表格后读屏用户体验略降级 | 低 | 低 | 按 NFR-004 用 `aria-hidden`/简要 `aria-label` 处理，明确这是纯装饰性图表，不是信息的唯一来源（`myRank` 的数字统计本身已可读） |

## 7. 实施计划

### Phase 1: 基础重构 — 布局与数据流
- [ ] 重写 `leaderboard-view.tsx` 为单栏布局
- [ ] 精简 `_lib/period.ts`（移除 `days`/`CurveDays`/`DEFAULT_DAYS`/`CURVE_DAYS`）

### Phase 2: 核心组件
- [ ] 新增 `hero-panel.tsx`（合并排名统计 + sparkline，处理三种状态：已登录已上榜/已登录未上榜/未登录）
- [ ] 新增 `sparkline.tsx`（精简版权益曲线展示，复用 `curve.ts`）
- [ ] 改版 `ranking-table.tsx`（列头文案、奖牌/纯文本排名、头像）
- [ ] 删除 `equity-curve-panel.tsx`、`equity-chart.tsx`、`my-rank.tsx`（被 `hero-panel.tsx` 取代）

### Phase 3: 完善
- [ ] 更新/新增单元测试（`period.test.ts` 同步精简；`hero-panel`/`sparkline`/`ranking-table` 的头像与排名逻辑补测试）
- [ ] 浏览器验收（qa 命令）

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-09-25 | 用固定 `days=30` 直接调用现有 `equityCurveQuery(30)`，不新增单独的 sparkline 专用接口 | 后端接口已支持任意 `days` 参数，前端固定传值即可满足需求，避免不必要的后端改动 |
| 2026-09-25 | `sparkline.tsx` 复用 `curve.ts` 的 `buildCurve()`，而不是另写一套曲线几何计算 | `buildCurve()` 已有完整测试覆盖（缺口断开、单点兜底、x/y 归一化），重新实现是不必要的重复劳动，且容易引入新 bug |
| 2026-09-25 | `my-row.ts`（我的行判定）与 `curve.ts` 保持不变，只在展示层重组 | 两者是纯函数、已有测试，且本次需求未改变判定逻辑本身（R-005 的"我"标签展示规则不变） |
| 2026-09-25 | 头像圆点取 `nickname` 首字符，而非引入头像上传/图片字段 | 需求边界明确排除自定义头像（见 requirements.md「未来考虑」），首字符占位与 Figma 设计一致且零后端改动 |
| 2026-09-25（apply 阶段实现时发现并调整） | AC-002/AC-013 不新写组件渲染测试，直接复用已有的 `formatRatioAsPercent(null)`/`avatarInitial("")` 单测；AC-015 的验证方式从 `unit` 改为 `playwright-mcp`，并入 T-007 | `apps/web/vitest.config.ts` 的 `include` 只匹配 `src/**/*.test.ts`，仓库无 `@testing-library/react`（`.claude/TEST_BASELINE.md` 记录 `packages/ui` 组件测试数为 0）——这是既有测试基线，不是遗漏。硬写组件渲染测试既跑不起来（被 include 过滤掉），引入该依赖又会违反本文档 NFR-003「不引入新依赖」。改为复用已覆盖相同边界条件的现有纯函数测试 + qa 浏览器验收，实际测试意图不减 |
| 2026-09-25 | `ranking-table.tsx` 的排名列改用 emoji + 纯文本，`hero-panel.tsx`/`ranking-table.tsx` 的头像复用已有的 `LetterAvatar` 组件 + `avatarInitial()` 函数（原属 `app-header/account-display.ts`），未新建头像组件或首字母提取逻辑 | 项目已有完全匹配的现成实现（`account-entry.tsx` 里「用户用显示名首字母（brand）」的用法），复用优于重造，且 `avatarInitial("")` 已经返回 `"?"`，与 ASM-006 的假设完全吻合 |

## 遵循的项目规范

`.claude/skills/` 下当前无命中的项目自定义 skill（仅 `README.md` 占位）。本次设计遵循：

- 根 `CLAUDE.md`「依赖方向」：`apps/web` 只依赖 `packages/shared`，本次改动未引入反向依赖或新的跨包依赖
- 现有代码里体现的 `dataviz` 通用原则（`equity-chart.tsx` 注释：「tooltip enhances, never gates」「文字一律用文本色，不用线的颜色」）：新 `sparkline.tsx` 虽然精简掉交互，但线条样式（2px 圆角、10% 透明度面积填充）沿用同一套视觉语言，保持与站内其他图表的一致性
- 根 `CLAUDE.md`「宁可说做不到，不要编数字」：ASM-004 的判断依据
