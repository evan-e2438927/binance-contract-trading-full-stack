# 需求文档（草稿，仅范围，未做澄清/设计/任务）

> 来源：`docs/design/09-monitoring.md` 第四节「第 1、2 层」、附加、第七节步骤 1～5。从 09 拆出的第 3 个迭代。
> 状态：**未走 proposal**。这一块体量仍然偏大，proposal 阶段建议先问是否继续细拆。

## 基本信息

- **迭代序号**: 003
- **变更类型**: feature
- **Slug**: health-probe-heartbeat
- **前置**: 001 已 accepted；002 可并行或之后

## 需求摘要

让「没人在看的时候出事」能被发现：外部探测 + 定时任务心跳 + 账目对账。

## 范围（In Scope，初稿）

- server 新增 `GET /health`（db / feed / engine / binance 封禁状态；不限流、不登录、不暴露账户数据）；Docker healthcheck 继续用 `/`，不改
- Better Stack 探测 M1（`/health`）、M2（首页）+ SSL 到期提醒
- 心跳 H1 资金费、H2 权益快照、H3 分层表同步；心跳 URL 走环境变量，没配就不打卡
- H4：把 `packages/db/src/scripts/reconcile-ledger.ts` 改成 server 每小时任务，对平才打卡，不平走 `/fail`
- H5：mac-mini 宿主机脚本（launchd）
- Cloudflare 自带三项：Tunnel Health Alert、Workers Logs（`wrangler.jsonc` 加 `observability`）、Web Analytics

## 不包含（初稿）

- 状态页、日志集中、Grafana（09 第七节步骤 6）
- 「对账不平暂停下单」维护开关（09 第九节待决 3，属新功能）
- 数据库备份（09 第十节，单独迭代）
- 业务事件上报到 Sentry（418/429、落库失败等，001 已明确留后）

## 待澄清（proposal 阶段必须提问）

1. 是否细拆：建议 `/health` + 探测 / 心跳 + 对账 / 宿主机脚本 + Cloudflare 项 三块
2. `feed` 持续不 ready 多久判 503（09 写 60 秒）是否沿用
3. 对账任务的执行位置与是否会影响撮合队列（涉及 `jobs/` 与资金不变式，须谨慎）
4. 是否同时补做 001 留下的业务事件上报
