# Track 汇报：frontend

- 状态: done
- 执行者: sdlc-frontend-dev
- 完成时间: 2026-10-24T18:10:00+08:00

## 完成的任务与 AC
- T-005: AC-011 ✅, AC-004a ✅, AC-013a ✅, AC-020d ✅（check-types 与 build:cloudflare 均通过，未设变量）, AC-020e ✅, AC-020f ✅
- T-006: AC-008 ✅, AC-008a ✅, AC-009 ✅, AC-010 ✅

验证结果：
- `pnpm --filter web exec vitest run src/lib src/app src/instrumentation-client.test.ts`：33 个文件、227 个用例全部通过
- `pnpm --filter web run check-types`：通过（0 个 error）
- `biome check`（仅白名单内文件）：无问题
- AC-020e：设 `NEXT_PUBLIC_SENTRY_DSN=https://pub@o0.ingest.sentry.io/0` 跑 `build:cloudflare` 成功，`.next/static/chunks/3ohy_5gbfsiuq.js` 命中 `o0.ingest.sentry.io`（1 个 client chunk）；不设变量再构建成功，命中 0 个
- NFR-004（体积）：`.next/static/chunks` 约 7140 KB，gzip 合计设 DSN 1,918,830 B / 不设 1,919,716 B，两者几乎相同，说明 @sentry/nextjs（含 error.tsx 的 captureException 引用）无论是否配置 DSN 都进入了 client 包。想测"接入前基线"时，临时还原改动再构建因类型检查连带测试文件失败，未得到可靠基线数字，故没有"接入前 vs 接入后"的对比，只能给出上述两种配置的数据。

## 修改的文件
- apps/web/.env.schema（新增 `NEXT_PUBLIC_SENTRY_DSN`，`@optional @public @type=url`）
- apps/web/src/env.ts（`varlock codegen` 生成物，被 git 忽略，未手改）
- apps/web/src/lib/config/env.ts（新增 `SENTRY_DSN`，字面量 `process.env.NEXT_PUBLIC_SENTRY_DSN ?? ""`）
- apps/web/src/instrumentation-client.ts（新建）
- apps/web/src/lib/sentry/constants.ts（新建）
- apps/web/src/lib/sentry/client-options.ts（新建）
- apps/web/src/lib/sentry/report-render-error.ts（新建）
- apps/web/src/app/error.tsx（useEffect 内调用 reportRenderError，UI 不变）
- apps/web/src/app/global-error.tsx（同上）
- docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/tracks/frontend.md

## 新增的测试
- tests/unit/web/lib/sentry/client-options.test.ts（AC-011, AC-004a, AC-020f）
- tests/unit/web/instrumentation-client.test.ts（AC-013a，及有 DSN 时 init 1 次）
- tests/unit/web/lib/sentry/report-render-error.test.ts（AC-008, AC-008a, AC-010）
- tests/unit/web/app/error.test.tsx（AC-008, AC-008a, AC-010 渲染级；同文件含 GlobalError 的 AC-009，未单建 global-error.test.tsx）

## 公共文件修改请求
无

## 与设计的偏差
- GlobalError 的测试合并在 error.test.tsx，未新建 global-error.test.tsx（tasks.md 目标文件里只列了 error.test.tsx）
- 无 withSentryConfig 也能在 Next 16 / Turbopack 下构建，DSN 已内联；未改 next.config.ts
- 注意：执行期间发现工作区被他人临时 `git stash` 又恢复，期间构建曾因此失败，恢复后重跑正常；我的改动经核对均完好

## 修复记录（主 agent，汇总阶段 ⑥.3）
- 问题：`@sentry/*` 11.8.0 的类型里已没有 `sendDefaultPii`（被 `dataCollection` 取代，默认 userInfo/cookies/httpHeaders/httpBodies/urlQueryParams 全开），web 端只传 `sendDefaultPii:false` 实际不生效，不满足 NFR-003。backend 角色在 server 端先发现并修了，这里对齐。
- 改动：`apps/web/src/lib/sentry/constants.ts` 新增 `DATA_COLLECTION_OFF`；`client-options.ts` 的选项与 `BrowserOptionsLike` 增加 `dataCollection`；`client-options.test.ts` 新增 AC-004a (security) 用例。
- 验证：web 全量 vitest 37 个文件 241 个用例通过；`check-types` 通过（`httpBodies` 用 `never[]` 以匹配 SDK 联合类型）。
- AC-020e 的构建验证在此修复之前完成；修复只增加选项字段，不影响 DSN 内联，未重跑 build。

## 汇总阶段对「他人 git stash」的核对
- backend 角色为确认 `packages/db` 的既有类型错误执行过一次 `git stash` / `git stash pop`。汇总时核对：`git stash list` 为空；两个角色汇报的全部文件都在工作区且测试通过，未发现丢失。
