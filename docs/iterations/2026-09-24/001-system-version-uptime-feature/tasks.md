# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-24/001-system-version-uptime-feature/
- **生成时间**: 2026-09-24 00:00:00
- **基于设计**: design.md

## 任务总览

| Phase | 任务数 | 总工时 |
|-------|--------|--------|
| Phase 1: 后端实现 | 1 | 1h |
| Phase 2: 前端实现 | 2 | 2.5h |
| Phase 3: 完善 | 3 | 3h |
| **合计** | **6** | **6.5h** |

## 任务 Track 汇总（按角色视图）

| Track      | 任务数 | 总工时 | 任务 ID           |
|------------|--------|--------|--------------------|
| frontend   | 2      | 2.5h   | T-002, T-003       |
| backend    | 1      | 1h     | T-001              |
| shared     | 0      | 0h     | —                   |
| infra      | 0      | 0h     | —                   |
| unit-test  | 2      | 2h     | T-004, T-005        |
| qa         | 1      | 1h     | T-006               |
| **合计**   | **6**  | **6.5h**|                    |

## Phase 1: 后端实现

### [x] T-001: GET /system/version 接口

**描述**: 给 `apps/server/package.json` 补充 `version` 字段；新增 `apps/server/src/api/system.ts`，启动时读取该字段并记录进程启动时间，实现只读接口 `GET /system/version`，返回 `{version, uptime}`（`uptime` = 当前时间与启动时间的差，取整秒）；在 `apps/server/src/app.ts` 挂载 `/system` 路由，归入现有"公共接口"限流分组（按 IP 60 次/分钟，同 `/auth`、`/market`、`/leaderboard`）。

**目标文件**:
- apps/server/package.json
- apps/server/src/api/system.ts
- apps/server/src/app.ts

**Track**: backend

**适用规范**: 无项目自定义 skill 命中；遵循根 `CLAUDE.md` 依赖方向约束（新路由放在 `apps/server`，不下沉到 `packages/engine`）和 `.claude/CODING_GUIDELINES.md` 的响应包络（复用 `http/respond.ts` 的 `ok()`）

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): Given server 进程已启动 30 秒以上，`package.json` 的 `version` 为 `"0.1.0"`，When `GET /system/version`，Then 返回 `200` + `{"ok": true, "data": {"version": "0.1.0", "uptime": 30}}`（`uptime` 允许 ±1s 误差）
- [x] **AC-002** (error): Given 路由只注册 `GET`，When `POST /system/version`，Then 返回 `404`
- [x] **AC-003** (boundary): Given 进程刚启动完成，When 立即 `GET /system/version`，Then `uptime` 为 `0`（非负整数）
- [x] **AC-004** (security): Given 请求不带 `Authorization` 头，When `GET /system/version`，Then 响应 `data` 只含 `version`、`uptime` 两个字段

**依赖关系**: 无

**复杂度**: S

**预估工时**: 1h

---

## Phase 2: 前端实现

### [x] T-002: system API 客户端模块

**描述**: 新增 `apps/web/src/server-api-module/system/types.ts`（按 design.md §3.1 接口表镜像 `System` DTO：`{version: string, uptime: number}`）和 `queries.ts`（`fetchSystemVersion()` 用 `request.get<System>("/system/version")`；`systemVersionQuery()` 用 `queryOptions` 包装，`refetchInterval` 设为 60s 以保持运行时长不过度陈旧，见 design.md「设计假设」ASM-004）。

**目标文件**:
- apps/web/src/server-api-module/system/types.ts
- apps/web/src/server-api-module/system/queries.ts

**Track**: frontend

**适用规范**: 无项目自定义 skill 命中；遵循 `apps/web/src/server-api-module` 现有模块惯例（参照 `leaderboard/` 目录结构：`types.ts` + `queries.ts`，用 `request.get` + `queryOptions`）

**Requirement IDs**:
- R-001
- R-002

**验收标准**:
- [x] **AC-005a** (happy-path，接口形状): Given design.md 接口表定义的响应结构，When 调用 `fetchSystemVersion()`，Then 返回值类型为 `{version: string, uptime: number}`，与后端契约一致

**依赖关系**:
- 依赖 design.md §3.1 接口契约表（非阻塞依赖 T-001，可并行开发，本任务不依赖 T-001 的实现完成）

**复杂度**: S

**预估工时**: 0.5h

---

### [x] T-003: 顶栏版本/运行时长展示组件

**描述**: 在 `apps/web/src/app/_shared/ui-components/app-header/` 新增展示组件（如 `version-info.tsx`），用 `useQuery(systemVersionQuery())` 拉取数据；新增纯函数 `formatUptime(uptimeSeconds: number): string`（"X天X小时X分钟"量级，0 显示"0分钟"，导出以便单测），组件渲染 `v{version} · 运行 {formatUptime(uptime)}`；加载中或请求失败（`isError`）时显示 `"—"`；接入 `app-header.tsx`，放在 `ConnectionIndicator` 与 `AccountEntry` 之间或紧邻位置，用带 `aria-label` 的文本节点保证可访问性。

**目标文件**:
- apps/web/src/app/_shared/ui-components/app-header/version-info.tsx
- apps/web/src/app/_shared/ui-components/app-header/app-header.tsx

**Track**: frontend

**适用规范**: 无项目自定义 skill 命中；遵循现有 header 子组件模式（参照 `connection-indicator.tsx` 的 `role`/`aria-label`/`title` 用法）

**Requirement IDs**:
- R-002

**验收标准**:
- [ ] **AC-005b** (happy-path，渲染): Given 接口返回 `{version:"0.1.0", uptime:5400}`，When 顶栏渲染完成，Then 右上角可见 `v0.1.0` 与格式化后的运行时长文本 —— 代码实现已完成（`isLoading || isError || !data` 才显示 `"—"`，否则渲染 `v{version} · 运行 {formatUptime(uptime)}`），验证方式为 playwright-mcp，待 T-006/qa 阶段实际跑通浏览器验收后勾选
- [ ] **AC-006** (error): Given `GET /system/version` 请求失败，When 顶栏渲染，Then 该区域显示 `"—"`，不抛出未捕获异常 —— 代码实现已完成，待 T-006/qa 勾选
- [ ] **AC-007b** (boundary，渲染): Given 接口返回 `uptime: 0`，When 顶栏渲染，Then 显示"0分钟"，不是 `"—"` —— 代码实现已完成（`formatUptime(0)` 单测已验证返回 `"0分钟"`），组件渲染层面待 T-006/qa 勾选
- [ ] **AC-008** (ui-state): Given 请求尚未返回（`isLoading`），When 顶栏首次渲染，Then 显示 `"—"` 占位，不显示 `undefined`/`NaN` —— 代码实现已完成，待 T-006/qa 勾选

**依赖关系**:
- 前置任务: T-002

**复杂度**: M

**预估工时**: 2h

---

## Phase 3: 完善

### [x] T-004: 后端 system 接口单元测试

**描述**: 新增 `apps/server/src/api/system.test.ts`，覆盖 T-001 实现的全部 AC；用项目现有的 `app.request()` 测试方式（参照 `apps/server/src/api/api.integration.test.ts` 的调用模式）。

**目标文件**:
- apps/server/src/api/system.test.ts

**Track**: unit-test

**适用规范**: 无项目自定义 skill 命中；遵循 `.claude/CODING_GUIDELINES.md` 测试规范（同目录 `*.test.ts`，Vitest）

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): 同 T-001，`vitest run` 断言 `200` + `{version, uptime}` 结构与数值范围
- [x] **AC-002** (error): 同 T-001，断言 `POST /system/version` 返回 `404`；test 角色查漏补写 1 例，额外断言响应体不泄露 `version`/`uptime` 字段
- [x] **AC-003** (boundary): 同 T-001，断言 `uptime` 非负整数，服务刚启动时接近 `0`
- [x] **AC-004** (security): 同 T-001，断言响应 `data` 的键集合严格等于 `{version, uptime}`

**依赖关系**:
- 前置任务: T-001

**复杂度**: S

**预估工时**: 1h

---

### [x] T-005: 前端 uptime 格式化函数单元测试

**描述**: 新增 `apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts`，覆盖 `formatUptime()` 的边界值（0、59、60、3599、3600、86399、86400、跨天大数值如 90000 秒）。

**目标文件**:
- apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts

**Track**: unit-test

**适用规范**: 无项目自定义 skill 命中；遵循 `header-ticker.test.ts` 的既有模式：只测导出的纯函数，不做组件渲染测试（本仓库 `apps/web` 无 `@testing-library` 依赖）

**Requirement IDs**:
- R-002

**验收标准**:
- [x] **AC-007a** (boundary，格式化逻辑): Given `uptime=0`，When `formatUptime(0)`，Then 返回 `"0分钟"`；Given `uptime=90000`，When `formatUptime(90000)`，Then 返回值包含"1天"量级且不为 `NaN`/负数（实际测了 8 组边界值，超出最小要求）

**依赖关系**:
- 前置任务: T-003

**复杂度**: S

**预估工时**: 1h

---

### [ ] T-006: 浏览器验收规格 — 顶栏版本/运行时长展示

**描述**: 编写浏览器验收场景（Given-When-Then + 选择器约束），由 `qa` 命令生成 Playwright 脚本并执行；本任务只写规格，不写实现代码。

**目标文件**:
- tests/e2e/system-version-uptime/E2E-001-version-display.e2e.ts（由 `qa` 命令生成）

**Track**: qa

**适用规范**: 无项目自定义 skill 命中；遵循 `.claude/rules/workflow-rules.md`「E2E 测试写入 tests/e2e/，维护需求 ID/场景 ID/文件路径唯一映射」

**Requirement IDs**:
- R-002

**验收标准（浏览器验收规格，非实现）**:
- [ ] **AC-005** (happy-path): Given 打开任意页面且 `/system/version` 正常返回，When 页面加载完成，Then 顶栏右侧可见形如 `v{version} · 运行 {文案}` 的文本节点（选择器：`app-header` 内新增组件的 `data-testid="system-version-info"` 或等价可定位属性）
- [ ] **AC-006** (error): Given 拦截/模拟 `/system/version` 返回 5xx 或超时，When 页面加载完成，Then 该文本节点内容为 `"—"`，且页面其余顶栏元素（Logo、导航、连接状态、账户入口）正常渲染
- [ ] **AC-008** (ui-state): Given 网络延迟下 `/system/version` 请求处于 pending，When 顶栏首次渲染，Then 该区域先显示 `"—"`，请求成功后替换为实际值（可用网络节流或延迟 mock 观察过渡）

**依赖关系**:
- 前置任务: T-003（qa 阶段执行，apply 阶段跳过本任务的实现）

**复杂度**: S

**预估工时**: 1h

---

## 依赖关系图

```
T-001 ──────────────── T-004

T-002 ──── T-003 ──┬── T-005
                    └── T-006
```

## 任务执行顺序

1. T-001（后端）与 T-002（前端 API 客户端，依赖契约非 T-001）可并行
2. T-003 依赖 T-002
3. T-004 依赖 T-001；T-005 依赖 T-003（均可在各自前置任务完成后并行）
4. T-006（qa 阶段单独执行，不在 apply 阶段实现）
