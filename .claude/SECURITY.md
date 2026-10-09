# Security Guidelines

> 本文件由 `/sdlc-workflow:sdlc-init` existing-project intake 基于真实代码填实（2026-09-24）。
> 未能从代码逐项核实的项标注「待确认」。

## 认证与授权

- 三种登录方式：钱包（自研 SIWE/EVM + SIWS/Solana 验签，不引第三方托管）、邮箱验证码（6 位数字，服务端发信+校验，不用 magic link）、Google OAuth（Authorization Code + PKCE，用轻量库 `arctic`，不引入完整认证框架）。三种方式互相独立，**不做账户合并**——一个登录身份 = 一个独立账户（`docs/design/00-overview.md`）
- 会话：服务端自签 JWT（`hono/jwt`，HS256），7 天有效期，三种登录方式共用同一套签发/校验逻辑（`apps/server/src/auth/tokens.ts`）。payload 只有 `{ sub: accountId, iat, exp }`，**不含**身份细节（地址/邮箱/OAuth 信息），要身份信息需另查 `/auth/me`
- Token 过期区分错误码：过期 → `TOKEN_EXPIRED`；签名/格式/算法任何问题 → `UNAUTHORIZED`（不泄露具体失败原因）
- 授权模型：单账户单用户，无角色分级（合约模拟盘不需要多角色 RBAC）——**待确认**是否有管理端/运营端接口需要额外授权

## 数据保护

- 金额/价格/数量全程 `bigint` 定标 1e8（根 `CLAUDE.md` 硬约束），杜绝浮点误差导致的资金计算偏差
- 任何资金变动必须写 `ledger_entries`，`balanceAfter` 必填，需守住 `accounts.wallet_balance === SUM(ledger_entries.amount)`（根 `CLAUDE.md` 硬约束第五条），这是本项目最核心的资金一致性不变式
- USDT 是模拟发放，**不产生任何真实下单**，不存在真实资金托管，因此不涉及真实资金的合规/托管风险，但仍需保证账本内部一致，否则用户会看到"余额对不上"的可信度问题

## 密钥/Token 管理

环境变量通过 `varlock` 管理，`env.ts` 自动生成（禁止手改），敏感项标注 `🔐 sensitive`（`apps/server/src/env.ts`）：

| 变量 | 用途 | 敏感 |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Postgres 连接串 | 是 |
| `BINANCE_API_KEY` / `BINANCE_SECRET_KEY` | **只读** Key，仅服务端同步杠杆分层表（`packages/db/src/brackets/`），**绝不下发到前端**（根 `CLAUDE.md`） | 是 |
| `JWT_SECRET` | 签 HS256 JWT，要求 ≥32 字符 | 是 |
| `RESEND_API_KEY` | 邮箱验证码发信（可选） | 是 |
| `CORS_ORIGIN` | CORS 白名单 | 否 |

- 币安 Key 边界是本项目最关键的安全约束：只读、只在 `apps/server`、只用于同步杠杆分层表，任何把 Key（或能推导出 Key 的逻辑）下发到 `apps/web` 的改动都是安全事故级别的问题
- `.claude/.sdlc-config` 与 `.claude/.sdlc-config.local` 已在根 `.gitignore` 排除

## 输入验证

- 后端用 `zod`（`catalog:` 统一版本）做入参校验——**待确认**具体覆盖范围是否已覆盖所有 API handler，intake 未逐个 handler 核对
- 金额相关输入必须先经 `packages/shared` 的定标/舍入逻辑转换为 `Fixed`（bigint），禁止 `parseFloat`/`Number()`/`toFixed()` 出现在计算路径（根 `CLAUDE.md` 硬约束第一条），这既是精度问题也是安全边界（防止精度攻击导致的资金套利）

## API 安全

- CORS 通过 `CORS_ORIGIN` 环境变量配置白名单
- 市价单吃穿 20 档深度直接拒单，不做"最后一档 + 滑点惩罚"的假成交（根 `CLAUDE.md`「一条原则」）——这是业务诚实性约束，不是传统意义的安全项，但违反会造成用户资金计算的可信度问题
- Rate limiting——**待确认**，intake 未在 `apps/server` 找到显式限流中间件，若涉及邮箱验证码发送等易被滥用的接口，需要在设计阶段确认是否已有防刷机制

## 依赖安全

- 未发现自动化依赖审计（如 `pnpm audit` 的 CI 集成）——**待确认**，`.github/` 不存在，说明目前无 CI，依赖更新策略依赖人工
- `pnpm-workspace.yaml` 里 `minimumReleaseAgeExclude` 对个别包（`vitest` 相关）豁免了发布冷却期检查，其余依赖默认走 pnpm 的发布冷却期保护

## Workspace 边界

- `apps/web` 不得持有任何数据库连接、币安 Key 或 JWT 签名密钥——所有敏感操作经 `apps/server` 的 API/WS 代理
- `packages/engine` 是纯函数，天然不可能泄露密钥（无 IO 能力），这是架构上的安全收益，不只是代码整洁的考量
- `packages/db/src/brackets/` 的杠杆分层数据来源必须是服务端用只读 Key 通过官方签名接口同步，写库前后双重校验，变更留快照（`docs/design/00-overview.md`）——不得手抄或从未签名的公开页面抓取

## 安全审计

- 未发现集中式安全日志/监控方案——**待确认**，intake 未在 `apps/server` 找到审计日志模块
- 资金相关操作的可追溯性由 `ledger_entries`（必填 `balanceAfter`）提供，本质上起到审计轨迹的作用，但这是会计不变式而非专门的安全审计系统
