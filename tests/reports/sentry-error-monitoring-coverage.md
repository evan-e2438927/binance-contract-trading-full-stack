# 测试覆盖度分析报告

## 基本信息

- **生成时间**: 2026-10-24
- **迭代**: docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/
- **测试框架**: vitest
- **E2E 框架**: Playwright（由 qa 命令编写）

## AC → 覆盖测试 → 状态

| AC | 维度 | 覆盖测试 | 状态 |
|----|------|----------|------|
| AC-001 | happy-path | tests/unit/server/http/respond.test.ts；集成：sentry.integration.test.ts（AC-001b） | ✅ |
| AC-002 | error | respond.test.ts（AC-002）；sentry.integration.test.ts（AC-002a） | ✅ |
| AC-003 | boundary | respond.test.ts（AC-003）；sentry.integration.test.ts（AC-003a） | ✅ |
| AC-004 | happy-path | tests/unit/server/observability/sentry.test.ts | ✅ |
| AC-005 | boundary | sentry.test.ts（initSentry 返回 null）；respond.test.ts（AC-005a 不传 reportError） | ✅ |
| AC-006 | boundary | flush-before-exit.test.ts（启用/null/抛错/挂起超时）；sentry.test.ts（flush 透传 2000） | ✅（`index.ts` 中 SIGTERM 接线本身无单测，见待补充） |
| AC-007 | error | sentry.test.ts；respond.test.ts（AC-007a） | ✅ |
| AC-008 | happy-path | tests/unit/web/lib/sentry/report-render-error.test.ts；tests/unit/web/app/error.test.tsx | ✅ |
| AC-009 | happy-path | tests/unit/web/app/error.test.tsx（GlobalError 用例） | ✅ |
| AC-010 | ui-state | report-render-error.test.ts；error.test.tsx（captureException 抛错不崩，点重试） | ✅（真实广告拦截场景见 qa） |
| AC-011 | boundary | tests/unit/web/lib/sentry/client-options.test.ts | ✅ |
| AC-012 | happy-path | - | deferred to qa（playwright-mcp） |
| AC-013 | boundary | instrumentation-client.test.ts 覆盖 Sentry.init 未调用（AC-013a）；零请求部分 | deferred to qa（浏览器零请求验证） |
| AC-014 | security | tests/unit/packages/shared/sentry-scrub.test.ts | ✅ |
| AC-015 | security | sentry-scrub.test.ts | ✅ |
| AC-016 | security | sentry-scrub.test.ts | ✅ |
| AC-017 | security | sentry-scrub.test.ts；集成：sentry.integration.test.ts（EVM 地址） | ✅ |
| AC-018 | error | sentry-scrub.test.ts；sentry.test.ts（beforeSend 返回 null） | ✅ |
| AC-019 | boundary | sentry-scrub.test.ts | ✅ |
| AC-020 | happy-path | AC-020f：client-options.test.ts（web 未设置为空串）；server 侧不设变量由 check-types / build 验证（开发汇报）；schema 文本未做单测（不读取 .env*） | ✅（部分靠 check-types/build，非 vitest） |
| AC-021 | happy-path | - | manual（主 agent T-007） |

子 AC：AC-001a/004a/005a/007a/008a/013a/020a-f 见开发角色汇报；AC-021a/021b：manual（主 agent T-007）。AC-010b：deferred to qa。

## AC 覆盖率汇总

| 总 AC 数 | 单元测试覆盖 | deferred to qa | manual | 未覆盖（应覆盖但缺测试） |
|----------|-------------|----------------|--------|--------------------------|
| 21 | 17 | 3（AC-012、AC-013、AC-010b 的浏览器部分） | 1（AC-021） | 0 |

## 运行结果

- server `src/observability src/http`：6 文件 29 用例通过（含新增 4 个集成用例）
- web `src/lib src/app src/instrumentation-client.test.ts`：全部通过
- shared 全量：4 文件 62 用例通过

## 待补充测试

- index.ts 的 SIGTERM 接线（先 flushBeforeExit 再 process.exit(0)）无单测，当前靠 flushBeforeExit 单测 + 人工 review
- auth/routes.ts:314 开户失败被吞（backend 汇报的缺口，属 ASM-004 范围外）
