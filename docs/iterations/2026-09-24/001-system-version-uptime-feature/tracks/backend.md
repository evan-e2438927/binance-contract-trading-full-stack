# Track 汇报：backend

- 状态: done
- 执行者: sdlc-backend-dev
- 完成时间: 2026-09-24T19:55:00+08:00

## 完成的任务与 AC
- T-001: AC-001 ✅, AC-002 ✅, AC-003 ✅, AC-004 ✅

## 修改的文件
- apps/server/src/api/system.ts（新建）：`createSystemRoutes` 实现 `GET /system/version`，模块级缓存 `package.json` 的 `version`（`readFileSync` + `JSON.parse`，避免 JSON import assertion），启动时用可注入的 `now`/`startedAt` 记录进程启动时间戳，响应用 `ok(c, { version, uptime })` 走统一包络，`uptime = Math.floor((now() - startedAt) / 1000)`
- apps/server/src/app.ts（修改）：引入 `createSystemRoutes`，在 `app.route("/leaderboard", ...)` 之后新增 `app.route("/system", createSystemRoutes({ now }, { rateLimit: publicRateLimit }))`，归入与 `/market`、`/leaderboard` 相同的公共限流分组（按 IP 60 次/分钟）

## 新增的测试
- apps/server/src/api/system.test.ts（覆盖 AC-001、AC-002、AC-003、AC-004；用可控 `now`/`startedAt` 直接挂载 `createSystemRoutes` 到独立 Hono 实例，不依赖数据库，参照 `apps/server/src/http/rate-limit.test.ts` 的写法）

测试结果：`pnpm exec vitest run src/api/system.test.ts` 4/4 通过；`pnpm exec tsc --noEmit -p .`（apps/server）无报错。

## 公共文件修改请求
- 无（`apps/server/package.json` 的 `version` 字段改动已由主 agent 提前完成，本次未再触碰该文件）

## 与设计的偏差
- 无。接口契约（路径、方法、200 响应结构、404 由 Hono 默认行为产生、无需鉴权、限流分组）均按 design.md「## 3. 接口契约」原样实现。`createSystemRoutes` 额外支持注入 `now`/`startedAt`/`middleware`（可选参数，默认值等价于生产行为），仅为满足单元测试对 uptime 的确定性断言，不改变对外契约。
