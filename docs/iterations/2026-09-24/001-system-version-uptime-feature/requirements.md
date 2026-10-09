# 需求文档

## 基本信息

- **采集时间**: 2026-09-24 00:00:00
- **迭代序号**: 001
- **输入类型**: text
- **变更类型**: feature
- **Slug**: system-version-uptime
- **业务优先级**: P2(中)
- **技术风险**: 低

## 原始需求

server 新增 GET /api/system/version 返回 {version, uptime}；web 页面右上角显示版本号和运行时长，接口失败时显示"—"

## 需求摘要

后端新增只读的版本/运行时长查询接口；前端顶栏右上角展示这两个值，接口失败时降级显示 "—"。

## 需求详情

### 需求项 1
- **描述**: R-001 后端新增只读接口 `GET /system/version`，返回当前服务版本号与自启动以来的运行时长
- **置信度**: 低 → 已澄清
- **标注**: [✅ 已确认（用户选择）] 接口挂载路径采用 `/system/version`（不带 `/api` 前缀，遵循现有路由约定 `/market`、`/leaderboard`、`/account` 等）；`version` 字段来源为 `apps/server/package.json` 的 `version` 字段

### 需求项 2
- **描述**: R-002 前端顶栏（`AppHeader`）右上角展示版本号和运行时长，接口失败时该区域显示 `"—"`
- **置信度**: 高（0.85）
- **标注**: [✅ 已确认] 展示位置 = `AppHeader` 右侧、`ConnectionIndicator`/`AccountEntry` 附近；需求原文已明确失败态展示规则

## 验收标准

### AC-001: 正常返回版本号与运行时长（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: server 进程已启动 30 秒以上，`apps/server/package.json` 的 `version` 字段为 `"0.1.0"`
- **When**: 客户端发起 `GET /system/version`
- **Then**: 返回 `200` + `{"ok": true, "data": {"version": "0.1.0", "uptime": 30}}`（`uptime` 为整数秒，允许 ±1s 误差，来自进程启动到收到请求的时间差）
- **验证方式**: unit

### AC-002: 非 GET 方法请求该路径（Error）
- **关联需求**: R-001
- **场景维度**: error
- **Given**: 路由只注册了 `GET /system/version`
- **When**: 客户端以 `POST /system/version` 发起请求
- **Then**: 返回 `404`（Hono 对未注册方法的默认行为），不返回 `{version, uptime}` 之外的信息
- **验证方式**: unit

### AC-003: 服务刚启动时的 uptime（Boundary）
- **关联需求**: R-001
- **场景维度**: boundary
- **Given**: server 进程刚完成启动（uptime 理论值为 0）
- **When**: 立即发起 `GET /system/version`
- **Then**: `uptime` 字段为 `0`（非负整数，不是 `null`/`NaN`/负数）
- **验证方式**: unit

### AC-004: 响应不泄露版本号/运行时长以外的信息（Security）
- **关联需求**: R-001
- **场景维度**: security
- **Given**: 请求不带 `Authorization` 头（该接口公开、无需鉴权）
- **When**: 发起 `GET /system/version`
- **Then**: 响应 `data` 只包含 `version`、`uptime` 两个字段，不包含 git commit hash、环境变量、内部文件路径等额外信息
- **验证方式**: unit

### AC-005: 顶栏正常显示版本号与运行时长（Happy Path）
- **关联需求**: R-002
- **场景维度**: happy-path
- **Given**: `GET /system/version` 返回 `{"version": "0.1.0", "uptime": 5400}`
- **When**: 顶栏（`AppHeader`）渲染完成
- **Then**: 右上角区域可见版本号 `0.1.0` 与格式化后的运行时长（如 "1小时30分"），文本可被 `aria-label`/可访问性工具读取
- **验证方式**: playwright-mcp

### AC-006: 接口失败时显示 "—"（Error）
- **关联需求**: R-002
- **场景维度**: error
- **Given**: `GET /system/version` 请求失败（网络错误、超时或 5xx）
- **When**: 顶栏渲染该区域
- **Then**: 版本号与运行时长展示区域显示 `"—"`，不抛出未捕获异常，不影响页面其余部分正常渲染
- **验证方式**: playwright-mcp

### AC-007: uptime 为 0 时的边界展示（Boundary）
- **关联需求**: R-002
- **场景维度**: boundary
- **Given**: 接口返回 `uptime: 0`
- **When**: 顶栏渲染
- **Then**: 运行时长展示为 "0分钟"（非负数、非 `NaN`、非空白），不显示 "—"（"—" 专用于请求失败态，不与合法的 0 值混淆）
- **验证方式**: playwright-mcp

### AC-008: 首次加载中的过渡态（UI State）
- **关联需求**: R-002
- **场景维度**: ui-state
- **Given**: 页面刚加载，`GET /system/version` 请求尚未返回
- **When**: 顶栏首次渲染
- **Then**: 该区域显示 `"—"` 或等价占位（不显示 `undefined`/`NaN`/空白跳动），请求成功后替换为实际值，请求失败后保持 `"—"`
- **验证方式**: playwright-mcp

## 非功能性需求

| ID | 类别 | 描述 | 验收指标 |
|----|------|------|----------|
| NFR-001 | 性能 | `/system/version` 只读内存值，无数据库查询 | 本地 P95 响应时间 ≤ 50ms |
| NFR-002 | 安全 | 响应字段严格限定为 `{version, uptime}` | 不含 commit hash / 环境变量 / 内部路径等额外信息 |
| NFR-003 | 兼容性 | 复用现有 `axios-client` + TanStack Query 基础设施 | N/A（无新增兼容性要求） |
| NFR-004 | 可访问性 | 版本号/运行时长以文本形式渲染，非纯图标 | 可被屏幕阅读器读取，复用现有 header 文本可访问性模式 |

## 需求边界

### 包含 (In Scope)
- 后端新增只读 `GET /system/version` 接口（公开、无需鉴权）
- 前端顶栏（`AppHeader`）右上角新增版本号 + 运行时长展示
- 接口请求失败时的降级态（显示 `"—"`）

### 不包含 (Out of Scope)
- 历史版本 / 发版记录追踪
- CI/CD 自动化版本号发布流程
- `apps/native`（移动端）改动
- 版本号点击跳转到 changelog 等交互扩展
- 运行时长的秒级实时跳动刷新（本次只要求展示，刷新策略见设计假设）

### 未来考虑 (Future Considerations)
- 若未来接入 CI，可将 `version` 来源切换为 CI 注入的 release tag / commit SHA
- `/system/version` 可扩展更多运行时诊断信息（如行情连接状态、数据库连接状态），本次不做

## 用户故事

### US-001: 运营/开发人员确认当前部署版本
- **角色**: 作为项目开发者或内部使用者
- **目标**: 我想要在页面上直接看到当前服务的版本号和已运行时长
- **价值**: 以便快速确认线上部署的是哪个版本、服务是否刚重启过
- **关联需求**: R-001, R-002

## UI/UX 约束

- **设计稿**: 无（顶栏已有布局见 `apps/web/src/app/_shared/ui-components/app-header/app-header.tsx`）
- **交互规范**: 展示在顶栏右侧，`ConnectionIndicator` 与 `AccountEntry` 附近；纯展示，无点击交互
- **响应式要求**: 复用顶栏现有响应式行为，不单独适配
- **动画/过渡**: 默认，无特殊要求

## 变更影响评估

- **Breaking Changes**: 否
- **数据库变更**: 否
- **API 变更**: 是（新增只读接口 `GET /system/version`，非破坏性）
- **配置变更**: 是（需要给 `apps/server/package.json` 补充/维护 `version` 字段；不新增环境变量）

## 外部依赖

无

## 假设标注

见下方「假设记录」。

## 假设记录

| ID | 关联 | 假设内容 | 状态 | 确认人 | 确认时间 |
|----|------|----------|------|--------|----------|
| ASM-001 | R-001 | `version` 字段来源 = `apps/server/package.json` 的 `version` 字段（需补充该字段，当前仓库 package.json 均无 `version` 字段） | confirmed | interactive | 2026-09-24 |
| ASM-002 | R-001 | 接口挂载路径 = `/system/version`（不带 `/api` 前缀，遵循现有路由约定） | confirmed | interactive | 2026-09-24 |
| ASM-003 | R-001 | 接口限流分组沿用现有"公共接口"组（按 IP 60 次/分钟，与 `/auth`、`/market`、`/leaderboard` 共享额度），不单独开新分组 | pending | - | - |
| ASM-004 | R-002 | 运行时长仅在接口返回时展示一次格式化结果，不做秒级本地跳动刷新；通过 TanStack Query 定期 `refetch`（如 60s）保持不过度陈旧 | pending | - | - |
| ASM-005 | R-002 | 运行时长的人类可读格式（如 "1小时30分"）由前端本地格式化 `uptime`（秒），具体文案规则在 design.md 中给出 | pending | - | - |

> ASM-001、ASM-002 属于低置信度且有设计影响的项，已在主会话通过 AskUserQuestion 向用户发起选择询问并确认（`provenance=asked`，`confirmedBy=interactive`）。ASM-003~005 为中置信度、无直接设计选型冲突的实现细节假设，按标准流程自行假设并在 design.md 中显式登记。

## 🚦 澄清 Gate

`MUST_ASK`（低置信度 ∪ 有设计影响的中置信度项）= {ASM-001, ASM-002}，两项 `provenance` 均为 `asked` 且已 `confirmed`，`BLOCKERS` 为空。

✅ 澄清 Gate 通过，可进入步骤③ design-generator。
