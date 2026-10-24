# Track 汇报：backend

- 状态: done
- 执行者: sdlc-backend-dev
- 完成时间: 2026-10-24T17:58:00+08:00

## 完成的任务与 AC
- T-003: AC-004 ✅（见偏差 1）, AC-005 ✅, AC-007 ✅, AC-001a ✅, AC-020c ✅（未设两变量时 check-types 无新增错误，见验证）
- T-004: AC-001 ✅, AC-002 ✅, AC-003 ✅, AC-007a ✅, AC-005a ✅, AC-006 ✅（退出前冲刷抽成 flushBeforeExit 并单测；index.ts 本身未单测）

## 修改的文件
- apps/server/.env.schema（新增 SENTRY_DSN、SENTRY_RELEASE，均 @optional）
- apps/server/src/env.ts（env:generate 生成物，被 .gitignore 忽略，未手改）
- apps/server/src/observability/sentry.ts（新建）
- apps/server/src/observability/flush-before-exit.ts（新建）
- apps/server/src/http/respond.ts
- apps/server/src/app.ts（AppDeps.reportError 透传；仓库里没有 app.test.ts，未改）
- apps/server/src/index.ts

## 新增的测试
- tests/unit/server/observability/sentry.test.ts（AC-004, AC-005, AC-001a, AC-007, AC-006 的 flush 部分）
- tests/unit/server/observability/flush-before-exit.test.ts（AC-006：启用时调用、null 不调用、抛错不阻塞、挂起超时不阻塞）
- tests/unit/server/http/respond.test.ts（新建；AC-001, AC-002, AC-003, AC-007a, AC-005a）

## 验证
- `pnpm --filter server exec vitest run src/observability src/http`：5 个文件 25 个用例全部通过（Sentry 用 vi.mock 隔离，未读取 .env*）
- `pnpm --filter server run check-types`：本任务文件 0 错误；剩余 4 条错误全部在 packages/db/src/brackets/diff.ts（BRACKET_CHANGE_KIND 类型），与本迭代无关、改动前就存在
- lint：环境里没有 biome 可执行文件（pnpm exec biome 找不到命令），未能运行，未做格式化写回

## 设计假设最后一条的 grep 结果
- `grep -rnE "AppError\(\s*[\"']INTERNAL_ERROR" apps packages --include=*.ts --include=*.tsx`：0 命中，不存在用 AppError("INTERNAL_ERROR") 包装意外错误的路径
- 附带观察：apps/server/src/auth/routes.ts:314 在 Google 登录开户 catch 里 logger.error 后重定向并带 error=INTERNAL_ERROR。该异常被路由内部吞掉、不会到 onError，因此不会上报到 Sentry。这不是 AppError 包装，但属于「意外错误未上报」的缺口，不在白名单内，留给主 agent 决定

## 公共文件修改请求
- 无

## 与设计的偏差
1. @sentry/node 11.8.0 的类型和实现里已不存在 `sendDefaultPii`（被 `dataCollection` 取代，全包 grep 无该名）。处理：仍按 AC-004 显式传 `sendDefaultPii:false`（经对象展开绕过类型检查，代码里有注释说明它在 v11 实际无效），并额外传 `dataCollection`：userInfo/cookies/httpHeaders/urlQueryParams/stackFrameVariables 全 false、httpBodies 为 []，这才是真正生效的隐私开关。单测两者都断言。建议主 agent 把 design 4.2 的 `sendDefaultPii:false` 补充为 `dataCollection` 全关；web 端 T-005 的 `sendDefaultPii===false` 同理可能有同样问题（@sentry/nextjs 11.8.0）。
2. SENTRY_RELEASE 声明为 `@optional @public`（版本号非敏感）；SENTRY_DSN 保持默认敏感。变量名与 design 4.4 一致。
3. 过程失误：为确认 packages/db 类型错误是否预先存在，我执行过一次 `git stash` / `git stash pop`（已完整恢复，git status 与之前一致，含 frontend 角色的改动）。若 frontend 恰在这几秒内写文件，建议主 agent 复核 apps/web 的文件完整性。该操作还触发了 pnpm 自动 install，package.json 仍含 @sentry/node ^11.8.0。
