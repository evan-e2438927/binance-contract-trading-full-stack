# Track 汇报：test

- 状态: done
- 执行者: sdlc-test-dev
- 完成时间: 2026-10-24T18:05:00+08:00

## 完成的任务与 AC
- T-008: AC-001b ✅, AC-002a ✅, AC-003a ✅
- 查漏：AC-001~011、014~019 均有单测覆盖（见 tests/reports/sentry-error-monitoring-coverage.md）；AC-006 由 flush-before-exit.test.ts 4 个用例覆盖（启用/null/抛错/挂起超时），AC-020/020c 由 check-types/build + web 空串用例覆盖，均无需补用例；AC-012/AC-013/AC-010b 标 deferred to qa；AC-021/021a/021b 标 manual（主 agent T-007）
- 未覆盖且应覆盖的 AC：0

## 修改的文件
- tests/reports/sentry-error-monitoring-coverage.md（新建）
- docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/tracks/test.md

## 新增的测试
- tests/unit/server/observability/sentry.integration.test.ts（覆盖 AC-001b, AC-002a, AC-003a；4 个用例，通过）
  做法：vi.mock('@sentry/node', importOriginal) 包装 init，注入内存 transport；真实 initSentry + 真实 createErrorHandler + Hono；用 withIsolationScope 事件处理器模拟 HTTP 集成把 Authorization/Cookie 挂到事件上；断言作用于 beforeSend 之后的 envelope

## 公共文件修改请求
无

## 与设计的偏差
- 注入 transport 时同时设置了 defaultIntegrations:false、integrations:[]（仅测试内），避免默认集成产生额外 envelope；因此该测试不验证默认集成的行为（AC-004 由 sentry.test.ts 断言参数）
- 测试里请求头由测试自带的 event processor 注入（Hono 无 HTTP 集成，事件本身没有 request 头），目的是证明 beforeSend 会清掉它们
- 验证：server `src/observability src/http` 6 文件 29 用例通过；web 目标目录通过；shared 62 用例通过
- 未触碰 .env* 文件；AC-020 的 schema 文本未做单测；index.ts 的 SIGTERM 接线无单测（见覆盖报告「待补充」）
