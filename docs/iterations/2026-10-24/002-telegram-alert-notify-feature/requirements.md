# 需求文档（草稿，仅范围，未做澄清/设计/任务）

> 来源：`docs/design/09-monitoring.md` 第五节末尾 + 第九节待决 1。从 09 拆出的第 2 个迭代，排在 001（Sentry）之后。
> 状态：**未走 proposal**。开工前需运行 `/sdlc-workflow:sdlc-proposal` 补全澄清、设计、任务；本文件只固定范围与待澄清项。

## 基本信息

- **迭代序号**: 002
- **变更类型**: feature
- **Slug**: telegram-alert-notify
- **前置**: 001 已 accepted（有 Sentry 事件可转发）

## 需求摘要

把告警推到 Telegram，让重要告警能在手机上第一时间看到，不依赖 Better Stack App。

## 范围（In Scope，初稿）

- 一个小转发服务：接收 Sentry / Better Stack / Cloudflare 的 Webhook，转成 Telegram 消息（09 建议放在 Cloudflare Worker）
- 按 09 第五节的 P1/P2/P3 分级决定是否推送、怎么标注
- Bot Token、Chat ID 走环境变量，不进 git

## 不包含（初稿）

- 探测、心跳、`/health`（见 003）
- 自动处置、双向交互命令（只推送，不接收指令）

## 待澄清（proposal 阶段必须提问）

1. 转发服务放哪：Cloudflare Worker（09 建议）还是并入 `apps/server`？后者 server 挂了就发不出告警，一般不推荐
2. 先转发哪几个来源：本迭代只有 Sentry 可用，Better Stack 要等 003
3. 是否要去重/限频（同一问题短时间内只推一次）
4. Webhook 如何防伪造（共享密钥放 URL 还是请求头）
5. 目录归属：新增转发服务是否需要新 workspace（受 `.claude/EXISTING_STRUCTURE.md` 约束，须在 design.md 说明）
