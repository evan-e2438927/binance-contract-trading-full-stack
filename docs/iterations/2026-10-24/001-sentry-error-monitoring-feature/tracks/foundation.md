# Track 汇报：foundation

- 状态: done
- 执行者: main
- 完成时间: 2026-10-24T17:52:53+0800

## 完成的任务与 AC
- T-001: AC-020a ✅（`pnpm install --frozen-lockfile --lockfile-only` 通过）, AC-020b ✅（lockfile 与两个 package.json 一致；Docker 同款过滤安装使用同一份 lockfile）
- T-002: AC-014 ✅, AC-015 ✅, AC-016 ✅, AC-017 ✅, AC-018 ✅, AC-019 ✅（`tests/unit/packages/shared/sentry-scrub.test.ts` 13 个用例通过；shared `tsc --noEmit` 通过）

## 修改的文件
- apps/server/package.json（新增 @sentry/node ^11.8.0）
- apps/web/package.json（新增 @sentry/nextjs ^11.8.0）
- pnpm-lock.yaml
- packages/shared/src/sentry-scrub.ts
- packages/shared/src/index.ts
- apps/web/vitest.config.mts（公共配置：include 从 `src/**/*.test.ts` 扩为 `src/**/*.test.{ts,tsx}`，否则 T-006 的 error.test.tsx 不会被执行）

## 新增的测试
- tests/unit/packages/shared/sentry-scrub.test.ts（覆盖 AC-014～019）

## 公共文件修改请求
无

## 与设计的偏差
- 新增 `SENTRY_EMAIL_PLACEHOLDER` 导出常量；`request.url` 里的查询串也做脱敏（design 4.2 只写了 query_string，这是同类泄露面，保守起见一并处理）
- 发现 apps/server/.env（被 git 忽略的本地文件）里已有 SENTRY_DSN、SENTRY_RELEASE 以及 HEARTBEAT_* 变量，变量名与本迭代一致；HEARTBEAT_* 属后续迭代，本次不声明

## 追加：T-007 文档（主 agent，B 阶段结束后执行）
- 状态: done
- 完成的 AC: AC-021 ✅, AC-021a ✅, AC-021b ✅
- 修改的文件:
  - docs/design/09-monitoring.md（顶部状态与「迭代拆分」表；新增「第 3 层 · 本迭代（001）的实际做法」与 Sentry 控制台配置清单；记录 Google 开户失败不经全局处理器、不会上报的已知缺口）
  - docs/design/README.md（09 一行注明分三个迭代）
  - docs/frontend/cloudflare-deployment.md（NEXT_PUBLIC_SENTRY_DSN：本机示例、CI 导出示例、构建期内联说明、CI 必需变量清单）
  - README.md（env 文件表注明两个文件的可选 Sentry 变量，server 与 web 必须使用不同 DSN）
- 核对: `grep -E "https://[A-Za-z0-9]+@"` 在上述文档中 0 命中（仅有带尖括号的占位示例，无真实 DSN）

## 追加：单测迁移到 tests/unit/（主 agent，用户决定）
- 起因：开发角色按项目 CODING_GUIDELINES 把测试放在源码同目录；用户指出流程规定单测应放 `tests/unit/` 镜像目录，选择迁移。
- 迁移：本迭代新增的 9 个测试文件移到 `tests/unit/{packages/shared,server,web}/...`，import 改为指向源码的相对路径；老测试不动。
- 配置：`packages/shared/vitest.config.ts`、`apps/web/vitest.config.mts` 的 include 追加对应的 `../../tests/unit/...`；`apps/server/vitest.config.ts` 新建（此前没有）。
- 新增 `packages/config/vitest/resolve-tests-unit-imports.ts`：根目录没有 vitest/hono/react/@sentry 等包，`tests/unit/` 下的裸模块导入（含 `vi.mock("包名")`）会解析失败或与源码不是同一份模块；该插件让它们从各 workspace 解析。
- 验证：shared 62、web 241、server（src/http + src/observability + tests/unit/server）29 个用例通过；三个包 check-types 无新增错误；biome 通过（web）。
- 已知取舍：`tests/unit/` 下的文件不在各 app 的 `tsc` 范围内（不做类型检查，vitest 本身不检查类型）。
