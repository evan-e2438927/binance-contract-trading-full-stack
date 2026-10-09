# 技术设计文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-24/001-system-version-uptime-feature/
- **生成时间**: 2026-09-24 00:00:00
- **基于需求**: requirements.md

## 0. 目录影响声明

### 0.1 目标目录
- `apps/server/src`: 新增 `apps/server/src/api/system.ts`（新路由 handler）；修改 `apps/server/src/app.ts`（挂载 `/system` 路由）；修改 `apps/server/package.json`（新增 `version` 字段）
- `apps/web/src`: 新增 `apps/web/src/server-api-module/system/`（`types.ts` + `queries.ts`）；新增前端展示组件（落位于 `apps/web/src/app/_shared/ui-components/app-header/`）；修改 `app-header.tsx` 接入新组件
- `packages/<name>`: 无新增/修改

### 0.2 新增目录
无（新文件均落在已有目录内）

### 0.3 偏离说明
不涉及偏离。契约形态选型见「3. 接口契约」，未新增 `packages/contracts` 等共享包，理由见该节。

## 1. 技术方案概要

### 1.1 概述
后端在 `apps/server` 新增一个公开、无需鉴权的只读接口 `GET /system/version`，返回 `{version, uptime}`：`version` 读取自 `apps/server/package.json` 的 `version` 字段（启动时读一次并缓存），`uptime` 为进程自启动以来经过的秒数（`Math.floor((Date.now() - startedAt) / 1000)`）。前端在全站顶栏（`AppHeader`）右侧新增一个只读展示区域，通过 TanStack Query 调用该接口并格式化展示；请求失败或尚未返回时显示 `"—"`。

### 1.2 目标
- 后端暴露服务版本号与运行时长，供前端/运维快速确认当前部署状态
- 前端顶栏右上角常驻展示，失败态优雅降级为 `"—"`，不影响页面其余部分

### 1.3 非目标（Scope 外）
- 不做版本号/uptime 的历史记录、CI 自动注入
- 不做 uptime 的秒级本地跳动刷新（本次只要求定期 `refetch` 保持不过度陈旧）
- 不涉及 `apps/native`

## 2. 数据模型设计

无数据库变更；本需求不引入新的持久化实体。

## 3. 接口契约

- **契约形态**: table
- **契约文件**: 无

> **契约形态判定说明**：按 03-design-generator.md §1.6 判定顺序，项目结构上满足"TS monorepo"条件，理论优先级落在 `ts-types`（默认路径 `packages/contracts/src/<slug>.ts`）。但本仓库**没有**任何共享的 `packages/contracts` 或跨端契约类型包——现有全部接口（`/market`、`/leaderboard`、`/account`、`/orders`、`/positions`）的前端 DTO 类型都各自手写在 `apps/web/src/server-api-module/<module>/types.ts`，与后端 handler 的返回结构保持人工同步，`packages/shared` 只放 `Fixed`/枚举/错误码等跨端基础原语，不放逐接口的 DTO。为一个两字段的只读接口新增一个共享契约包，既不成比例，也违反 `.claude/EXISTING_STRUCTURE.md`「若要新建这几个包，必须先在 design.md 明确批准，且要说明为什么现有就地放置方式不够用」的门槛（这里明显不够用的理由不成立）。因此采用 `table` 形态，延续本仓库已有的"后端 handler + 前端本地镜像类型文件"惯例。

### 3.1 接口表

| 方法 | 路径 | 请求体 | 成功响应 | 错误响应（状态码 + 错误码） | 认证 | 关联 AC |
|------|------|--------|----------|------------------------------|------|---------|
| GET | /system/version | 无 | 200 `{"version": "0.1.0", "uptime": 5400}` | 404（方法/路径不匹配，Hono 默认行为）；500 `INTERNAL_ERROR`（极端场景，如启动时读取 package.json 失败，见风险评估） | 否 | AC-001, AC-002, AC-003, AC-004 |

> 前端 `apps/web/src/server-api-module/system/types.ts` 按本表镜像 `System` DTO；后端 `apps/server/src/api/system.ts` 按本表实现路由。实现中若必须偏离契约，先回写本表，再改代码。

## 4. 安全考量

### 4.1 认证
- 公开接口，无需 `Authorization` 头，不走 `requireAuth` 中间件

### 4.2 授权
- 不适用（无用户身份概念）

### 4.3 数据保护
- 响应字段严格限定为 `{version, uptime}`：`version` 只暴露 `package.json` 的 `version` 字段本身（不拼接 commit hash/构建时间等），`uptime` 只是运行秒数，不含进程 PID、内存占用等内部诊断信息，避免给攻击者提供额外的服务器指纹信息

## 5. 依赖关系

### 5.1 内部依赖
- `apps/server/src/app.ts` → `apps/server/src/api/system.ts`（新路由挂载）
- `apps/web` 顶栏组件 → `apps/web/src/server-api-module/system/queries.ts` → `apps/web/src/lib/axios-client/client.ts`（复用现有 `request.get`）

### 5.2 外部依赖
无新增

### 5.3 新增依赖

无（复用已有 `hono`、`axios`、`@tanstack/react-query`）

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| `apps/server/package.json` 的 `version` 字段发版时忘记 bump，长期显示旧版本号 | 中 | 低 | 本次先落地机制；是否接入自动化 bump 留作 Future Considerations，不阻塞本次实现 |
| uptime 在极端长运行（数十天）时格式化文案不直观 | 低 | 低 | 格式化函数覆盖 天/小时/分钟量级并补充边界单测（如 90000 秒 → "1天1小时"） |
| 启动时读取 `package.json` 失败（文件缺失/损坏，理论上不会发生） | 极低 | 低 | 用 `readFileSync` + `JSON.parse`，异常由 `app.onError` 统一兜底为 `INTERNAL_ERROR`，不影响服务其余功能启动 |

## 7. 实施计划

### Phase 1: 后端接口
- [ ] `apps/server/package.json` 新增 `version` 字段
- [ ] `apps/server/src/api/system.ts`：启动时读取 `version`、记录 `startedAt`，实现 `GET /system/version`
- [ ] `apps/server/src/app.ts` 挂载 `/system` 路由

### Phase 2: 前端展示
- [ ] `apps/web/src/server-api-module/system/types.ts` + `queries.ts`
- [ ] 顶栏新增展示组件，接入 `app-header.tsx`
- [ ] 失败态 / 加载态显示 `"—"`，uptime 格式化函数

### Phase 3: 完善
- [ ] 后端单测（同目录 `system.test.ts`）
- [ ] 前端格式化函数单测 + 组件测试
- [ ] 浏览器功能验收（qa 阶段）

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-09-24 | 接口路径用 `/system/version`，不用需求原文的 `/api/system/version` | 遵循仓库既有路由约定（`/market`、`/leaderboard`、`/account` 均无 `/api` 前缀），用户已通过 AskUserQuestion 确认（ASM-002） |
| 2026-09-24 | `version` 来源用 `apps/server/package.json` 的 `version` 字段，不用 git commit SHA 或环境变量注入 | 语义化版本号可读性最好，用户已确认（ASM-001）；未来若接入 CI，可在不破坏契约的前提下切换来源（见 Future Considerations） |
| 2026-09-24 | 接口契约形态选 `table`，不新建 `packages/contracts` | 项目现有惯例是前端本地镜像类型文件，没有共享契约包先例，新增一个专门共享包对单一两字段接口不成比例（见「3. 接口契约」判定说明） |
| 2026-09-24 | uptime 不做秒级本地跳动，改用 TanStack Query 定期 `refetch` | 需求只要求展示运行时长，不要求精确到秒的实时跳动；定期 refetch（复杂度可控）已能满足"不过度陈旧"，避免引入额外的 `setInterval` 状态管理复杂度 |

## 遵循的项目规范

未命中任何项目自定义 skill——`.claude/skills/` 目录当前仅有 `README.md` 占位，无实际 skill 文件。设计遵循的是根 `CLAUDE.md` 五条硬约束（本需求不涉及金额/`bigint`/`ledger_entries`，故不适用大部分约束，仅依赖方向一条相关：新路由放在 `apps/server`，不下沉到 `packages/engine`，符合约束）和 `.claude/ARCHITECTURE.md`/`.claude/CODING_GUIDELINES.md` 的目录落位、响应包络（`ok(c, data)`）、测试同目录约定。

## 设计假设

| 决策点 | 关联 | 所做假设 | 理由 | 若假设错误的影响 |
|--------|------|----------|------|-------------------|
| 接口限流分组 | ASM-003 | `/system/version` 归入现有"公共接口"限流组（按 IP 60 次/分钟，与 `/auth`、`/market`、`/leaderboard` 共享额度），不单独开新分组 | 该接口无副作用、无数据库查询，风险极低，与其他公开只读接口一视同仁是最简单一致的做法 | 若未来该接口被高频轮询打满公共限流额度、影响其他公开接口，需要拆出独立分组或提高限额 |
| 运行时长刷新策略 | ASM-004 | 不做秒级本地跳动，通过 TanStack Query `refetchInterval`（如 60s）定期重新拉取 | 需求只要求"显示"运行时长，未要求实时精确到秒；本地跳动需要额外的 `setInterval` + 组件状态管理，复杂度不成比例 | 若用户期望的是实时跳动的秒表效果，需要补充本地 tick 逻辑（不改变契约，纯前端实现调整） |
| 运行时长文案格式 | ASM-005 | 前端本地把 `uptime`（秒）格式化为"X天X小时X分钟"量级的中文文案，0 值显示"0分钟" | 沿用中文界面惯例，且需求本身未指定具体格式字符串 | 若产品对格式有具体要求（如改用英文缩写 "1d 2h"），只需调整格式化函数，不影响接口契约 |

