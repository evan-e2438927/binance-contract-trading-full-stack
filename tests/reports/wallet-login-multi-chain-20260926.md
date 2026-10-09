# 测试执行报告

## 基本信息

- **执行时间**: 2026-09-26 22:43:00
- **迭代**: 001-wallet-login-multi-chain-feature
- **测试框架**: vitest（apps/web）
- **Lint 工具**: biome（apps/web）
- **范围**: 本迭代只改动 `apps/web`（新增/修改文件见 tracks/frontend.md）与根 `pnpm-workspace.yaml`/`pnpm-lock.yaml`（依赖安装），因此 test-pipeline 只跑 `apps/web`

## 测试结果

| 阶段 | 状态 | 通过/总数 | 备注 |
|------|------|-----------|------|
| Lint（apps/web） | ✅ | 0 error / 0 warning | `pnpm --filter web lint` |
| Unit（apps/web） | ✅ | 226/226 | `pnpm --filter web test`，含本次新增 16 条用例 |
| check-types（apps/web） | ✅ | 通过 | `pnpm --filter web check-types` |
| check-types（apps/server） | ✅ | 通过 | 确认 `viem` 版本 override 没有影响服务端类型 |

## Requirement → Test Matrix

| Requirement ID | Task IDs | Test File | 说明 |
|-----------------|----------|-----------|------|
| R-001 (EVM 登录) | T-003 | `apps/web/src/lib/wallet/sign-in.test.ts` | 编排逻辑单测；浏览器验收见 qa |
| R-002 (Solana 登录) | T-004 | `apps/web/src/lib/wallet/sign-in.test.ts` | 同上，Solana 分支 |
| R-003 (错误处理) | T-005 | `apps/web/src/lib/wallet/sign-in.test.ts` | 拒签/过期/校验失败的编排层断言 |
| R-004 (会话行为一致) | T-003, T-004 | `apps/web/src/stores/auth-store.test.ts`、`sign-in.test.ts`（AC-011 用例） | logout 不断连、双链登录不合并身份 |
| R-005 (懒加载性能) | T-002 | `apps/web/src/lib/wallet/appkit-config.test.ts` | 配置装配正确性；网络请求断言见 qa |

## 失败用例

无（apps/web 全绿）。

## 已知的范围外问题（如实记录，非本次改动引入）

`pnpm --filter server test` 现有 `src/ws/hub.test.ts` 5 条用例失败。已核实：失败根源指向 `apps/server/src/ws/serialize.ts`
和 `apps/server/src/ws/publisher.test.ts`——这两个文件在本次 apply **开始前**就已经是用户此前另一项未提交工作留下的
modified 状态，本次钱包登录改动全程未触碰 `apps/server`。不在本次 test-pipeline 判定范围内，详见 `tracks/frontend.md`
「已知遗留」小节。

## 后续步骤

lint + unit 通过后，运行 `/sdlc-workflow qa` 做浏览器功能验收（T-007，已在 tasks.md 补全 AC-004/005/007 场景），
再运行 `/sdlc-workflow accept` 更新文档并提交。
