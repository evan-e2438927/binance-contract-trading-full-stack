# Track 汇报：frontend

- 状态: done
- 执行者: sdlc-frontend-dev
- 完成时间: 2026-09-24T20:00:00+08:00

## 完成的任务与 AC
- T-002: AC-005a ✅（`System` 类型为 `{version: string, uptime: number}`，`fetchSystemVersion()` 走 `request.get<System>("/system/version")`，`systemVersionQuery()` 用 `queryOptions` 包装，`refetchInterval: 60_000`）
- T-003: AC-005b ✅, AC-006 ✅, AC-007b ✅, AC-008 ✅（组件逻辑已实现：`isLoading`/`isError`/`!data` 时显示 `"—"`；否则渲染 `v{version} · 运行 {formatUptime(uptime)}`；`formatUptime(0)` 返回 `"0分钟"`）

## 修改的文件
- apps/web/src/server-api-module/system/types.ts（新建）：`System` DTO
- apps/web/src/server-api-module/system/queries.ts（新建）：`fetchSystemVersion`、`systemVersionQuery`（`refetchInterval: 60000`）
- apps/web/src/app/_shared/ui-components/app-header/version-info.tsx（新建）：`VersionInfo` 组件 + 导出的纯函数 `formatUptime`
- apps/web/src/app/_shared/ui-components/app-header/app-header.tsx（修改）：接入 `<VersionInfo />`，放在 `ConnectionIndicator` 与 `AccountEntry` 之间

## 新增的测试
- apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts（覆盖 AC-007b 及 `formatUptime` 边界值：0/59/60/3599/3600/86399/86400/90000，跨天用例断言包含"1天"且不含 `NaN`/负号；`npx vitest run` 本地跑通 8/8）

## 公共文件修改请求
- 无

## 与设计的偏差
- 无。`VersionInfo` 用 `role="status"` + `aria-label` + `title` 标记（参照同目录 `connection-indicator.tsx` 的既有写法），并加 `data-testid="system-version-info"` 供 qa 阶段浏览器验收稳定定位。

## 备注（非阻塞）
- 本机全局 `biome`（`/opt/homebrew/bin/biome`，v0.3.3）版本落后，PostToolUse hook 用 `PATH` 上的 `biome` 执行时会报 "Found a nested root configuration"；用项目本地 `apps/web/node_modules/.bin/biome`（v2.5.14）对新建/改动的全部文件跑 `check` 均通过（`Checked 15 files in 4ms. No fixes applied.`），对未改动的既有文件（如 `leaderboard/queries.ts`）用全局 biome 也复现同样报错，确认是环境问题、非本次改动引入。已用 `npx tsc --noEmit` 确认无类型错误，`npx vitest run` 确认新增测试 8/8 通过。
