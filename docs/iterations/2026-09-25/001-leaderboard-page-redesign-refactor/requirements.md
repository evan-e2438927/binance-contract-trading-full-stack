# 需求文档

## 基本信息

- **采集时间**: 2026-09-25 18:17:26
- **迭代序号**: 001
- **输入类型**: text（用户口述）+ Figma 设计稿（补充材料）
- **变更类型**: refactor（既有 /leaderboard 页面的布局与视觉重构，不涉及新增后端能力）
- **Slug**: leaderboard-page-redesign
- **业务优先级**: P2（中）
- **技术风险**: 低（纯前端视觉/布局改动，不涉及 API、数据模型、权限）

## 原始需求

用户最初提供的 `docs/requiremnts/leaderboard-开发.md` 文件仅含标题「# 设计稿」，无正文。经澄清确认：

> 就是参考设计稿进行还原，字段什么的都在设计稿中。

随后用户提供 Figma 设计稿链接（node-id=4-6072，「排行榜」frame）：
`https://www.figma.com/design/tEjxTvnW0drLCL1w4ygMgo/模拟合约交易?node-id=4-6072`

核对代码库发现：排行榜功能（M11，`apps/web/src/app/leaderboard/`、`apps/server/src/api/leaderboard.ts`）已完整实现并提交（commit `4f794b7`），字段与 `docs/design/08-frontend-pages.md` 第 6 节「排行榜（B）」的文字规格基本一致。通过 `get_design_context` 读取 Figma 节点后确认：**设计稿是一次页面布局重排（把「我的排名」+「权益曲线」合并成顶部通栏 hero 卡片、去掉右侧边栏、表格改双栏为单栏），不是新增字段**——所有展示字段在现有 `GET /leaderboard`、`GET /account/equity-curve` 响应里已经都有，无需改动接口。

## 需求摘要

按 Figma 设计稿重排 /leaderboard 页面布局：「我的排名」与权益曲线合并为顶部通栏 hero 卡片，去掉右侧边栏改单栏，表格视觉改版（奖牌 emoji、头像、新列头文案），「榜单怎么算」说明块下沉到表格下方。纯前端改动，无接口变更。

## 需求详情

为需求详情中的每条核心能力分配 Requirement ID：

- R-001: 顶部 hero 卡片（已登录且已上榜）——整合排名、总收益率、账户权益、胜率、交易次数五项统计 + 30 天迷你权益曲线（sparkline）
- R-002: 顶部 hero 卡片的「未登录」「已登录未上榜」两种状态——沿用现有文案与判断逻辑，套进新 hero 卡片外观
- R-003: 移除独立的权益曲线面板（`EquityCurvePanel`/`EquityChart`：7/30/90 天切换、悬停 tooltip、键盘可访问表格），权益曲线功能收敛为仅 hero 卡片内固定 30 天的迷你 sparkline
- R-004: 页面整体布局从「左表格 + 右侧边栏」两栏改为单栏（最大宽度 ~1000px 居中）；周期切换（日榜/周榜/总榜）从表格卡片内移出，独立成一行，置于 hero 卡片下方、表格上方
- R-005: 榜单表格视觉改版——列头文案改为「排名/昵称/总收益率/账户权益/胜率/交易次数」；前三名用奖牌 emoji（🥇🥈🥉）替代圆形色块数字；每行昵称前新增头像圆点（昵称首字符）；「我」那一行继续高亮并带「我」标签
- R-006:「榜单怎么算」说明区块（`RulesNote`：收益率公式、快照规则、胜率口径、重置影响 + 链接到 `/rules#reset`）保留现有全部内容，位置从右侧边栏改为表格下方（单栏布局最底部）
- R-007: 数据更新说明文案保持现有准确口径（「数据截至 {asOf}（每日 UTC 00:00 快照）」/「每日 UTC 00:00 拍一次权益快照」），**不采用设计稿字面的「每 30 分钟更新一次」**（该说法此前已被团队核实为错误，见 `leaderboard-view.tsx` 现有代码注释），继续展示在周期切换行内

## 验收标准

### AC-001: hero 卡片展示已登录且已上榜用户的完整统计（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 已登录用户在当前周期内已上榜（`myRank` 非 null，如 `{ rank: 9, roi: 0.3145, equity: 13145, winRate: 0.521, tradeCount: 56 }`）
- **When**: 打开 `/leaderboard`
- **Then**: hero 卡片展示：排名 `#9`（品牌色、32px 等宽字体）、总收益率 `+31.45%`（带符号、涨跌色）、账户权益 `$13,145`、胜率 `52.1%`、交易次数 `56`，右侧展示 30 天 sparkline
- **验证方式**: playwright-mcp

### AC-002: 胜率为 null 时显示占位符，不显示 0%（Boundary）
- **关联需求**: R-001
- **场景维度**: boundary
- **Given**: `myRank.winRate` 为 `null`（统计期内无平仓成交）
- **When**: 渲染 hero 卡片
- **Then**: 胜率列显示 `--`（复用 `PLACEHOLDER` 常量），不显示 `0%`
- **验证方式**: unit

### AC-003: 权益曲线加载中显示加载态（UI State）
- **关联需求**: R-001
- **场景维度**: ui-state
- **Given**: `GET /account/equity-curve?days=30` 请求仍在进行中
- **When**: hero 卡片渲染
- **Then**: sparkline 区域显示"加载中…"占位文案，排名/统计区域不受影响（若 `GET /leaderboard` 已返回）
- **验证方式**: playwright-mcp

### AC-004: 权益曲线请求失败时显示错误占位（Error）
- **关联需求**: R-001
- **场景维度**: error
- **Given**: `GET /account/equity-curve` 请求失败（网络错误或 5xx）
- **When**: hero 卡片渲染
- **Then**: sparkline 区域显示错误提示文案（复用现有 `error.message` 展示逻辑），不抛出未捕获异常，不影响排名统计区域正常展示
- **验证方式**: playwright-mcp

### AC-005: 未登录时 hero 卡片显示登录提示（UI State）
- **关联需求**: R-002
- **场景维度**: ui-state
- **Given**: 用户未登录
- **When**: 打开 `/leaderboard`
- **Then**: hero 卡片区域（新外观）显示「登录后看自己的名次和权益曲线」文案 + 「登录 / 注册」按钮；点击按钮触发 `useUiStore.setLoginOpen(true)` 打开登录弹窗
- **验证方式**: playwright-mcp

### AC-006: 已登录但未上榜时显示原因列表（UI State）
- **关联需求**: R-002
- **场景维度**: ui-state
- **Given**: 用户已登录，当前周期 `myRank` 为 `null`
- **When**: 打开 `/leaderboard`
- **Then**: hero 卡片（新外观）显示「这一期还没上榜。可能是：」+ 三条原因（无成交 / 期内重置过账户 / 权益快照还没拍到），文案与现有 `my-rank.tsx` 一致
- **验证方式**: playwright-mcp

### AC-007: 独立权益曲线面板已移除（Boundary）
- **关联需求**: R-003
- **场景维度**: boundary
- **Given**: 页面渲染完成
- **When**: 检查页面 DOM / 交互元素
- **Then**: 不存在原 7/30/90 天切换按钮，不存在悬停 tooltip 浮层，不存在权益曲线的可访问性数据表格（`role="img"` 的 svg 摘要文案代替）
- **验证方式**: playwright-mcp

### AC-008: sparkline 缺快照的日子断开不插值（Boundary）
- **关联需求**: R-003
- **场景维度**: boundary
- **Given**: 30 天权益快照数据中某天缺失（`equity-curve` 响应对应日期没有 snapshot）
- **When**: sparkline 渲染
- **Then**: 折线在缺失日期处断开为独立线段，不连一条直线过去（复用 `buildCurve()` 现有分段逻辑，无需改动 `curve.ts`）
- **验证方式**: unit（复用 `curve.test.ts` 已有用例）

### AC-009: 桌面宽视口下单栏居中布局（Happy Path）
- **关联需求**: R-004
- **场景维度**: happy-path
- **Given**: 桌面宽视口（≥1280px）
- **When**: 打开 `/leaderboard`
- **Then**: 页面内容区最大宽度约 1000px 居中显示，不存在独立右侧边栏列（原 `grid-cols-[1fr_380px]` 两栏结构已移除）
- **验证方式**: playwright-mcp

### AC-010: 窄视口下 hero 卡片纵向堆叠不横向溢出（UI State）
- **关联需求**: R-004
- **场景维度**: ui-state
- **Given**: 窄视口（375px，移动端宽度）
- **When**: 打开 `/leaderboard`
- **Then**: hero 卡片内统计区与 sparkline 纵向堆叠展示，页面无横向滚动条（表格本身允许横向滚动，`overflow-x-auto` 沿用现状）
- **验证方式**: playwright-mcp

### AC-011: 前三名显示奖牌 emoji（Happy Path）
- **关联需求**: R-005
- **场景维度**: happy-path
- **Given**: 榜单存在第 1/2/3 名
- **When**: 渲染表格排名列
- **Then**: 第 1/2/3 名分别显示 🥇/🥈/🥉，不再使用圆形色块背景包裹数字
- **验证方式**: playwright-mcp

### AC-012: 第四名及以后显示纯文本排名（Happy Path）
- **关联需求**: R-005
- **场景维度**: happy-path
- **Given**: 榜单存在第 4 名及以后的行
- **When**: 渲染表格排名列
- **Then**: 排名显示为等宽字体纯文本 `#N`（如 `#4`），无圆形背景
- **验证方式**: playwright-mcp

### AC-013: 昵称为空时头像与昵称列显示占位符（Boundary）
- **关联需求**: R-005
- **场景维度**: boundary
- **Given**: 某一行 `nickname` 为 `null`
- **When**: 渲染该行
- **Then**: 头像圆点显示占位符 `?`，昵称列显示「未设置昵称」（沿用现有文案）
- **验证方式**: unit

### AC-014: 我的那一行高亮并带标签（Happy Path）
- **关联需求**: R-005
- **场景维度**: happy-path
- **Given**: 表格某一行满足 `isMyRow()` 判定为当前用户自己
- **When**: 渲染该行
- **Then**: 该行背景高亮，昵称旁显示「我」标签（复用现有 `isMyRow()` 判断逻辑，不改动 `my-row.ts`）
- **验证方式**: unit（复用 `my-row.test.ts` 已有用例）+ playwright-mcp

### AC-015: 昵称文本按用户输入原样展示，不被解释为 HTML（Security）
- **关联需求**: R-005
- **场景维度**: security
- **Given**: 昵称包含 `<script>`、`<img onerror=...>` 等潜在 XSS payload（历史遗留数据或未来放开自定义昵称时的防御性要求）
- **When**: 渲染表格该行昵称与头像首字符
- **Then**: 内容原样以纯文本渲染（React 默认转义），不执行注入脚本，不使用 `dangerouslySetInnerHTML`
- **验证方式**: playwright-mcp（apply 阶段发现本项目无组件渲染测试基础设施——vitest 只跑 `.test.ts`、无 `@testing-library/react`，见 tasks.md T-006 实现记录；改为浏览器验收覆盖）

### AC-016:「榜单怎么算」区块内容完整保留（Happy Path）
- **关联需求**: R-006
- **场景维度**: happy-path
- **Given**: 页面渲染完成
- **When**: 滚动到表格下方
- **Then**:「榜单怎么算」区块完整展示现有 5 条规则说明文案 + 「重置和账户规则 →」链接（指向 `/rules#reset`），内容与当前 `rules-note.tsx` 逐字一致，仅位置从侧边栏移到表格下方单栏
- **验证方式**: playwright-mcp

### AC-017: 已有快照时展示准确的数据截至文案（Happy Path）
- **关联需求**: R-007
- **场景维度**: happy-path
- **Given**: `GET /leaderboard` 返回 `asOf` 非 null（如 `"2026-09-24"`）
- **When**: 渲染周期切换行
- **Then**: 展示「数据截至 2026-09-24（每日 UTC 00:00 快照）」，**不展示**设计稿字面的「每 30 分钟更新一次」
- **验证方式**: playwright-mcp

### AC-018: 尚无快照时展示 fallback 文案（Boundary）
- **关联需求**: R-007
- **场景维度**: boundary
- **Given**: `GET /leaderboard` 返回 `asOf` 为 `null`（尚未拍过任何快照）
- **When**: 渲染周期切换行
- **Then**: 展示「每日 UTC 00:00 拍一次权益快照」（沿用现有 fallback 文案，不改动）
- **验证方式**: unit / playwright-mcp

## 非功能性需求

| ID | 类别 | 描述 | 验收指标 |
|----|------|------|----------|
| NFR-001 | 性能 | 不新增网络请求数量 | 页面仍只发起 `GET /leaderboard` + `GET /account/equity-curve?days=30` 两个请求；移除 7/90 天切换后不因用户交互产生额外请求 |
| NFR-002 | 安全 | 无新增用户输入面、无新增权限暴露面 | 昵称渲染沿用 React 默认转义，不引入 `dangerouslySetInnerHTML`；见 AC-015 |
| NFR-003 | 兼容性 | 与现有前端技术栈一致 | 不引入新的 npm 依赖；沿用 Next.js 16 + React 19 + Tailwind 4 + 现有 design tokens |
| NFR-004 | 可访问性 | sparkline 为纯装饰性图表，不误导读屏用户 | sparkline 的 `<svg>` 标注 `aria-hidden="true"` 或 `role="img"` + 简要 `aria-label`（如「近 30 天权益曲线」），不保留原 `EquityChart` 的可访问性数据表格（该表格随组件一起移除，属既定取舍，非可访问性回退） |

## 需求边界

### 包含 (In Scope)
- `/leaderboard` 页面布局、组件结构、视觉样式的重构（frontend-only）
- hero 卡片新组件（整合排名统计 + 30 天 sparkline）
- 榜单表格列头文案、排名列样式（奖牌/纯文本）、头像展示的改版
- `RulesNote` 组件的页面位置调整（内容不变）
- 周期切换（日榜/周榜/总榜）UI 位置调整（逻辑不变）
- 移除权益曲线的 7/30/90 天切换交互与独立面板

### 不包含 (Out of Scope)
- `GET /leaderboard`、`GET /account/equity-curve` 等后端接口的任何改动（无新字段、无口径变更）
- 数据库 schema、迁移（`equity_snapshots` 表结构不变）
- `/rules` 页面内容改动
- 顶部导航栏改动（现状已与设计稿一致，见 `apps/web/src/app/_shared/ui-components/app-header/`）
- 昵称设置/编辑功能改动（`POST /account/nickname` 不涉及）
- 移动端专属的独立视觉规范（本次仅保证现有响应式断点不回归，不额外设计移动端专属排版）

### 未来考虑 (Future Considerations)
- 若产品后续要求恢复权益曲线的多天数切换或悬停详情，需要重新引入类似 `EquityCurvePanel` 的交互面板（当前决定是完全移除，见假设记录 ASM-001）
- 若后续要支持自定义头像图片而非首字母占位，需要新的用户资料字段和上传能力，超出本次范围

## UI/UX 约束

- **设计稿**: Figma `https://www.figma.com/design/tEjxTvnW0drLCL1w4ygMgo/模拟合约交易?node-id=4-6072`（「排行榜」frame，node-id `4:6072`），仅覆盖「已登录且已上榜」这一种状态的视觉
- **交互规范**: hero 卡片内 sparkline 为纯展示，无交互（不可悬停查看逐日数值、不可切换天数）；周期切换（日榜/周榜/总榜）交互逻辑不变，仍通过 URL query 保存状态
- **响应式要求**: 沿用现有断点约定（`lg:` 断点起两栏 → 现在整体单栏，不再需要该断点区分主栏/侧栏；表格窄屏下 `overflow-x-auto` 横向滚动不变）
- **动画/过渡**: 默认（不新增动画预算）

## 变更影响评估

- **Breaking Changes**: 否（纯前端组件重构，无对外接口变更）
- **数据库变更**: 否
- **API 变更**: 否（`GET /leaderboard`、`GET /account/equity-curve` 请求参数与响应结构不变）
- **配置变更**: 否

## 外部依赖

- 来源: Figma 设计稿 `https://www.figma.com/design/tEjxTvnW0drLCL1w4ygMgo/模拟合约交易?node-id=4-6072`
- 内容摘要: 通过 `mcp__figma__get_design_context` 读取 node `4:6072`（「排行榜」frame）得到的结构化代码与截图，详见本迭代 `design.md` 「视觉规格来源」一节。该 frame 只包含「已登录且已上榜」一种数据状态的静态样例（rank #9, roi +31.45%, equity $13,145, winRate 52.1%, tradeCount 56）。

## 假设标注

见下方「假设记录」；R-001/R-002/R-006 涉及的低置信度项已在本会话内通过 `AskUserQuestion` 向用户发起提问并得到确认（`provenance=asked`，`confirmedBy=interactive`）。R-007（数据口径文案）依据项目已有先例（代码内既存注释 + 根 `CLAUDE.md`「宁可说做不到，不要编数字」原则）判定为高置信度，未再发起提问。R-005 中「列头文案是否随周期变化」「空昵称头像占位符」为低风险纯文案/占位符假设，已作为中置信度假设记录并在 design.md 中显式登记，供人工审核阶段（`pending_review`）复核。

## 假设记录

| ID | 关联 | 假设内容 | 状态 | 确认人 | 确认时间 |
|----|------|----------|------|--------|----------|
| ASM-001 | R-001, R-003 | 权益曲线功能收敛为仅 hero 卡片内固定 30 天 sparkline，删除独立的 `EquityCurvePanel`/`EquityChart`（7/30/90 天切换、tooltip、可访问性数据表格全部移除） | confirmed | interactive | 2026-09-25 |
| ASM-002 | R-002 | 未登录 / 已登录未上榜两种状态沿用现有文案与逻辑，仅套进新 hero 卡片外观，不重新设计文案 | confirmed | interactive | 2026-09-25 |
| ASM-003 | R-006 | `RulesNote`（榜单怎么算）保留全部现有内容，位置从右侧边栏移到表格下方（单栏布局） | confirmed | interactive | 2026-09-25 |
| ASM-004 | R-007 | 数据更新说明文案沿用现有准确口径（每日 UTC 00:00 快照），不采用设计稿字面「每 30 分钟更新一次」；依据：`leaderboard-view.tsx` 已有代码注释记录此前已被团队核实为错误说法，且根 `CLAUDE.md` 明确「宁可说做不到，不要编数字」 | confirmed | human-review（既有代码先例） | 2026-09-25 |
| ASM-005 | R-005 | 表格列头文案「总收益率/账户权益/交易次数」采用设计稿字面文案，固定展示，不随日榜/周榜/总榜切换而变化措辞（仅是标签文字，非数值口径变更，风险判定为低） | pending | - | - |
| ASM-006 | R-005 | 昵称为 `null` 时头像占位符使用 `?` 字符（设计稿未覆盖该状态） | pending | - | - |
