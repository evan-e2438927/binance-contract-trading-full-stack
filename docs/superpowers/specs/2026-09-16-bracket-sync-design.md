# 杠杆分层表官方同步 · 设计

> 2026-09-16 ｜ 状态：已确认，实施中

## 背景与决定

原设计：`GET /fapi/v1/leverageBracket` 是签名接口，项目定了不用 API Key，所以分层表人工维护、季度复核。
后来改为用币安网页端的 bapi（`fetch:brackets`）拉取，写进 `seed/leverage-brackets.json` 再导入。

2026-09-16 实测：20 个开放币对，官方签名接口、bapi、仓库 JSON 三方逐层 **0 差异**。
但 server 要做**每日自动同步**，常驻服务不应依赖未公开接口，因此改为：

- **只读 API Key 仅供服务端同步分层表**，仍然不下任何真实订单；
- 数据源只保留官方签名接口，bapi 脚本与仓库 JSON 删除（git 历史 `2267d10` 可找回）；
- 官方数据校验通过即**自动写库**，并留整表快照做变更记录——币安调表后已有仓位也立即按新表算，自动同步与之一致；
- 同步范围以 `symbols.enabled = true` 为准，开放名单收进 `open-symbols.ts`，由 `seed:symbols` 应用。

## 模块（`packages/db/src/brackets/`）

| 文件 | 职责 | 副作用 |
| --- | --- | --- |
| `types.ts` | `BracketRow`（十进制字符串形式的一层） | 无 |
| `binance-client.ts` | 签名（HMAC-SHA256）、请求、错误码翻译；`fetch` / 时钟可注入 | 网络 |
| `normalize.ts` | 官方返回 → `BracketRow[]`，承担全部结构与数值校验；`checkContinuity` | 纯 |
| `diff.ts` | 库内表 vs 官方表，逐层逐字段差异 | 纯 |
| `sync.ts` | `syncLeverageBrackets({ db, fetchBrackets, dryRun })` 编排 | 数据库 |
| `open-symbols.ts` | 20 个开放币对及顺序 | 无 |

脚本：`sync:brackets [--dry-run]`、`verify:brackets`（读库 + 连续性 + 与官方比对）、`seed:symbols`（按名单置 `enabled` / `sortOrder`）。

## 数据流

```
读 symbols where enabled
 → 拉官方全量 → 逐个开放币对 normalize（任何一个失败 / 缺失 → 整次中止，不写库）
 → 与库内 diff
 → dryRun：返回报告结束
 → 事务：变化的币对 delete + insert leverage_brackets，并插一条 leverage_bracket_changes
 → 事务后读回，与官方逐层比对，不一致抛错
 → 返回报告 { checked, changed[], unchanged[] }
```

无变化时不写任何行。

## 新表 `leverage_bracket_changes`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | |
| `symbol` | text fk → symbols | |
| `before` | jsonb | 旧整表 `BracketRow[]`，首次导入为 `[]` |
| `after` | jsonb | 新整表 `BracketRow[]` |
| `changed_at` | timestamptz | |

jsonb 内数值一律十进制字符串（遵守"bigint 不进 JSON"）。索引 `(symbol, changed_at desc)`。

## 校验（三道）

1. **写库前，官方数据自身**
   - 数值可精确表示为 1e8 定标：拒绝科学计数法、超过 8 位小数、非有限数
   - 层号从 1 连续；第 1 层 floor = 0；每层 floor = 上层 cap；cap > floor
   - 最大杠杆为正整数且逐层不增；mmr 逐层不减
   - 相邻层在边界上维持保证金相等（`checkContinuity`）
   - `notionalCoef` 存在且 ≠ 1 → 账户被个性化调整，不是公开表，中止
2. **写库后读回**，与官方逐层逐字段比对
3. **`verify:brackets`** 随时可跑：库内连续性 + 与官方 0 差异，否则退出码 1

## server（`apps/server/src/jobs/bracket-sync.ts`）

- 启动监听后跑一次；失败只打错误日志，不影响服务
- 此后每天 UTC 00:05；`setTimeout` 链 + 纯函数 `nextRunAt(now)` 排期，重启即重新排期
- 防重入：上一次未结束则跳过
- `onChanged(report)` 目前只打日志；引擎热加载留给第 11 讲引擎宿主。在那之前分层表变更需重启 server 才进入引擎——记入 `02-architecture.md` 已知失真点

## 测试

| 对象 | 用例 |
| --- | --- |
| 签名 | 币安文档示例向量 |
| client | 请求头、查询串、非 200 时带错误码的报错（假 fetch） |
| normalize | 每条校验规则一个失败用例 + 真实形状通过用例 |
| diff | 无变化 / 字段变化 / 层数增减 |
| sync | 连本地库、事务内执行后回滚：dryRun 不写、校验失败不写、无变化不记变更、有变化写表 + 变更记录、官方缺开放币对中止 |
| 排期 | 00:05 前 / 正好 00:05 / 之后跨天 |

## 文档同步

`CLAUDE.md`、`docs/design/README.md`、`00`、`01`、`02`、`03`、`04`、`06`、`HANDOFF.md`、`docs/tutorial/README.md`、
`leverage-brackets.ts` 与 `engine/testing/fixtures.ts` 注释；新增讲义 `docs/tutorial/01b-bracket-sync.md`；
`01-database.md` 正文不改，仅在分层表相关小节加指向 01b 的提示。
