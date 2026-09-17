# 会话交接说明

> 给接手这个项目的 Claude Code（或任何人）。
> 生成时间：2026-09-15 ｜ 最后更新：2026-09-17（第 07 讲完成）｜ 来源：Claude 桌面端 Cowork 会话

---

## 一、目前走到哪了

**数据库层已完成，引擎内核做到第 07 讲（风控与强平），下一讲 08：资金费与账户操作。教程按模块一讲一讲写，总览和进度见 `docs/tutorial/README.md`。**

| 阶段 | 状态 |
| --- | --- |
| 需求探讨与技术决策 | ✅ 完成 |
| 设计文档 | ✅ 完成，7 份在 `docs/design/`（已含邮箱 / Google 登录，14 张表版本） |
| 第 01 讲 · 数据库层 | ✅ 用户已完成：`packages/shared` + 12 张表 + 种子/对账脚本；分层表由 `fetch:brackets` 从币安拉取，20 个币对已导入 |
| 第 01b 讲 · 分层表官方同步 | ✅ 2026-09-16 AI 实现 + 讲义：官方签名接口（只读 Key）+ 三道校验 + `leverage_bracket_changes` 快照表（迁移 0002）+ server 每日 UTC 00:05 同步；旧的 JSON / `fetch:brackets` / `seed:brackets` 已删除；已 commit |
| 第 02 讲 · 引擎骨架、测试脚手架、回滚日志 | ✅ AI 写代码 + 讲义，用户对照阅读。`packages/engine` 骨架（7 个测试文件 32 条全绿），undo 日志 + `commit()`/`rollback()`；已 commit |
| 第 03 讲 · 计算公式 | ✅ 2026-09-17 AI 实现 + 讲义：`formulas.ts`/`position.ts`/`liquidation.ts`，强平价三算例带反向验算；顺带定了设计缺口 #5（强平价不对齐 tickSize）#6（逐仓保证金不占 walletBalance）；`packages/shared` 补 `mulRound`，修了 `format()` 截断显示 bug（缺口 #11）；接上不变式 ③⑥；84 条测试全绿；讲义 `docs/tutorial/03-formulas.md`；已 commit |
| 第 04 讲 · 下单校验链 | ✅ 2026-09-17 AI 实现 + 讲义：`validate-order.ts` 13 步，`apply` 接上 `placeOrder` 的拒单路径（通过时仍明确抛错，等 05 讲）；定了缺口 #12（引擎内部存 LONG/SHORT；数据库侧用户定为按币安标准：BOTH + 带符号数量，第 11 讲迁移）#13（GTX 拒单 vs 过期）；新记 #14～#16；169 条测试全绿；讲义 `docs/tutorial/04-order-validation.md`；已 commit |
| 第 05 讲 · 市价单与成交落账 | ✅ 2026-09-17 AI 实现 + 讲义：`execute-order.ts`（市价逐档吃单、限价穿透部分 Taker 成交、IOC / FOK / GTC 剩余处理、`applyFill` 落账）；缺口 #14 开仓亏损按币安实现、#18 只减仓成交时截断 + 残余撤销；已实现盈亏改 `mulFloor`；新记 #19；引擎 189 条、shared 34 条测试全绿；讲义 `docs/tutorial/05-market-order-fills.md`；币安规则汇总 `docs/design/07-binance-reference.md`；已 commit |
| 第 06 讲 · 限价单与拟真排队 | ✅ 2026-09-17 AI 实现 + 讲义：`queue.ts`（估算 / 夹逼 / 消耗三个纯函数）、`resting-orders.ts`（`book` 夹逼、`trade` Maker 成交、撤单）；`trade` 输入加 `tradeId`、`qty` 取币安 `nq`（不含 RPI）；定了缺口 #20（排队估算两处修正设计伪代码）#21（排队位置变化不发事件）；新记 #22（币安行情流地址拆成 /public、/market，第 10 讲）#23（其它挂单冻结保证金不随仓位重算，第 07 讲）；引擎 223 条测试全绿；讲义 `docs/tutorial/06-limit-orders-queue.md`；已 commit |
| 第 07 讲 · 风控与强平 | ✅ 2026-09-17 AI 实现 + 讲义：`risk.ts`（逐仓逐个判、全仓整户判；撤单 → 强平单逐档吃盘口、比破产价差的不吃、剩余按破产价平 → Taker 手续费 → 清算费，每项封顶到剩余资产）；用户定：强平成交"吃盘口 + 破产价兜底"、不做部分强平、强平收交易手续费、费用不够扣到 0 为止；清算费按币安币对费率（BTC 1.25%）× 成交价名义价值；`LIQUIDATION` 订单类型（缺口 #7）；不变式 ③ 收窄、新增 ⑨（#19）；其它挂单冻结保证金随仓位重算（#23）；发现算例 B 选层错误（#24）；引擎 243 条测试全绿；讲义 `docs/tutorial/07-risk-liquidation.md`；**未 commit** |
| 第 08–09 讲 · 引擎内核 | ⬜ 只有大纲（见教程 README），08 是下一讲：资金费与账户操作 |
| 第 10–14 讲 · 服务端 | ⬜ 只有大纲 |
| 前端 | 不出教程——`apps/web` 由 AI 直接实现 |
| 表结构 12 → 14 张（`identities` / `email_verification_codes`） | ⬜ 放在第 12 讲鉴权里做迁移，不挡引擎 |

**拿不定的地方以币安为标准**，见第六节"决策规则"。

**写下一讲之前必看**：`docs/tutorial/README.md` 的"设计缺口清单"。第 6 条（逐仓保证金算不算在钱包余额里）已在第 03 讲定了：不算。写第 08 讲前：资金费结算后要立刻跑风控扫描，直接调 `risk.ts` 的 `riskScan(state, accountsHolding(state, symbol), ts)`；调杠杆 / 切保证金模式要同步已有仓位（`applyFill` 遇到不一致会抛错）；第十二节整张流水表重放是 08 的毕业考试，第 4 步 Maker 平仓第 06 讲已经有测试。

> **本节踩过的一个坑，供参考**：上一位接手者一开始把"M0 地基"理解成"AI 直接写代码"，写了一份完整的实现计划（`docs/superpowers/plans/2026-09-15-m0-foundation.md`）。用户确认后发现本意是"数据库/后端两层用户自己动手，AI 写教程带路，前端才是 AI 直接写"，于是那份计划改成了仅供参考（教程内容是从它转写的，代码经过和设计文档核对，可以放心抄），真正要跟的是 `docs/tutorial/01-database.md`。**如果又看到类似"AI 要不要直接写数据库/后端代码"的模糊指令，先跟用户确认这一点，别想当然直接开始写实现。**

---

## 二、先读什么

```
docs/design/
├── README.md                索引 + 五条贯穿原则          ← 从这里开始
├── 00-overview.md           定位、边界、技术决策定稿表
├── 01-domain-knowledge.md   合约业务基础（概念 + 算例）
├── 02-architecture.md       ★ 系统架构总纲              ← 最重要
├── 03-database-design.md      ├─ 数据库子设计
├── 04-backend-design.md       ├─ 后端子设计（最长，1180 行）
├── 05-frontend-design.md      ├─ 前端子设计
└── 06-testing-design.md       └─ 测试子设计
```

仓库根的 `CLAUDE.md` 是常驻约束，每次开工都会读到。

**⚠️ 两个陷阱**

1. `docs/books-tutorial.md` 和 `docs/db-notes.md` 是早前跑通全栈链路的**练手记录**，和本项目业务无关。别照着它们建表。
2. 仓库里还留着 books 练手链路的代码（`apps/server/src/routers/`、`apps/web/src/app/books/`、`packages/db/src/schema/books.ts` 等，已在 `ecf1016` 单独 commit），不是本项目的业务代码。

---

## 三、仓库现状

分支 `main`。books 练手链路已在 `ecf1016` 单独 commit；本项目代码按讲 commit，最近一次是第 06 讲（限价单与拟真排队，`40d91d6`）。

技术栈：Better-T-Stack 脚手架 —— Next.js 16 + React 19 + Hono + Drizzle + Supabase Postgres + Turborepo + pnpm 11 catalog。Node v22.23.2。脚手架的 `api` 和 `auth` 都是 `none`，所以前后端走 Hono 接口 + fetch，鉴权要自己实现。

---

## 四、已验算的数值（可直接抄成测试用例）

这些数字都用脚本独立复算过，误差为 0：

| 项 | 值 | 验证方式 |
| --- | --- | --- |
| 强平价 A · 逐仓多（EP 50,000，1 BTC，10x，保证金 5,000） | **45,180.72** | 反算：权益 180.7229 = 维持保证金 180.7229 |
| 强平价 B · 逐仓空（同上做空） | **54,780.88** | 反算：权益 219.1235 = 维持保证金 219.1235 |
| 强平价 C · 全仓多（钱包 10,000，其余同 A） | **40,160.64** | 反算：权益 160.6426 = 维持保证金 160.6426 |
| BTCUSDT 十层分层表 | 9 个边界 | 相邻两层在边界上的维持保证金两两相等 |
| 市价逐档吃 5 BTC | 均价 **50,000.4**，滑点 0.4 | 加权平均 |
| 加仓均价（1@50,000 + 1@52,000） | **51,000** | |
| 完整资金流水 | 净收益 **+1,959.5**，ROE **+39.19%**，摩擦 40.5 | 逐笔累加 |
| 拟真排队推演 | 3.0 → 1.8 →（夹逼）1.5 → 0.7 → 成交 0.5 | Maker 费 4.99 |

> 强平价那三条**一定要连反算一起写进测试**。只断言结果的话，公式抄错而期望值也写成错的，测试会一直绿。反算是独立于公式的第二条路径。

---

## 五、下一步

**M0 地基已经全部完成**（下面这节是历史记录，留着方便对照）。当前进度是引擎内核在做，下一讲是**第 08 讲：资金费与账户操作**，见 `docs/tutorial/README.md` 的进度表和各讲大纲。

按 `数据库 → 后端 → 前端` 的顺序搭。前两层用户想自己一步步做，前端交给 AI。

### M0 地基（第一步，已完成）

1. 建 `packages/shared`，写 `fixed.ts`（定标 1e8、`parse`/`format`、`mul`/`div`、五种舍入）
2. 建 `packages/engine` 骨架 + `types.ts`（`EngineInput` / `EngineEvent`，签名见 `02-architecture.md` 第六节）
3. `packages/db` 建 12 张表（结构逐字段见 `03-database-design.md`）
4. ~~人工整理 20 个币对的杠杆分层表 JSON~~ → 已改为官方签名接口同步（见第 01b 讲）
   ⚠️ 分层表数字**只能来自官方接口**，不要凭记忆生成。
5. 脚本：`seed:symbols`、`sync:brackets`、`verify:brackets`、`reconcile:ledger`

**M0 验收**：`seed:symbols` + `sync:brackets` 后库里有 20 个币对的规格和分层表，`verify:brackets` 与官方 0 差异，`fixed.ts` 单测全绿。

### 一条建议

`06-testing-design.md` 第 4 节那七条不变式，**在写第一行业务代码之前就写好**。一个小时能写完，但从第一天起就替你盯着最危险的那类错误（尤其是"改了余额没写流水"）。等发现账目对不上再回头加，那时候历史数据已经是一团乱麻。

---

## 六、这个项目的性格

用户明确说过：**宁可说做不到，不要编数字。**

- 市价单吃穿 20 档深度 → 拒单，不按"最后一档 + 滑点惩罚"硬成交
- 行情断线 → 暂停撮合，恢复后不补算
- 跨层杠杆超限 → 拒单（2026-09-17 核对：币安也是拒单，错误码 -2027，设计文档里"币安自动降杠杆"的说法有误，已加更正）
- 账户重置 → 走正常平仓流程再设回 10,000，不直接改余额（为了保住"余额 == 流水之和"）

`02-architecture.md` 第九节列了 10 条已知失真点。**做任何改动前对一下那张表**，如果改动会让某条变得更不诚实，就不该做。

### 决策规则：以币安为标准（用户 2026-09-17 定）

设计文档没说清、前后矛盾、或者拿不准怎么做的地方：

1. **以币安官方做法为标准**，自己定下来直接实现，不用停下来等拍板。
   查找顺序写在 `CLAUDE.md`"查币安规则的顺序"：先查 `docs/design/07-binance-reference.md`（已核对的规则），再查本地副本 `docs/vendor/binance/`（没有就先跑 `pnpm run docs:binance`），最后才去网页版；查完补进 07。
2. **实现不了的，问用户。** "实现不了"包括：
   - 模拟盘条件做不到（没有真实流动性、只有 20 档深度、看不到真实排队等，对应 `02-architecture.md` 第九节的失真点）
   - 按币安做会违反 `CLAUDE.md` 硬约束或"宁可说做不到，不要编数字"
   - 和已经刻意偏离币安的决定冲突：市价单吃穿深度拒单、行情断线暂停撮合等——**这些不自己改回币安做法，先问**
3. 定下来之后：记进 `docs/tutorial/README.md` 的设计缺口清单，在设计文档原文处加"已定"注释，写明依据的币安文档。

已按这条规则定的：缺口 #12（数据库仓位按币安 positionRisk 表示法）、#14（所需保证金加开仓亏损，05 讲）、#15（触发价已被穿过的触发单拒单，09 讲）；第 04 讲校验链已对照币安核对并调整，#17（挂单数按币对计数、触发单默认 CONTRACT_PRICE、交易规则按币对读 exchangeInfo）用户已定按币安，改动清单见 `docs/tutorial/04-order-validation.md` 第 7 节。

---

## 七、还没定的事

| 事项 | 状态 |
| --- | --- |
| VPS 选型与开通 | 未开始。必须在**能直连 `fapi.binance.com`** 的海外区域（日/新/韩），上线前先 `curl https://fapi.binance.com/fapi/v1/time` 验证 |
| Supabase 项目 | 复用 books 练手那个还是新建，未定 |
| 前端 UI 设计稿 | 用户说交给 Figma 做，尚未产出 |
| 域名与 TLS | 未开始（浏览器 WSS 要求 https 来源） |
| 数据库跟进第 04 讲（**用户来写**） | `symbols` 表按币安 `exchangeInfo` 加 9 列并更新 `seed:symbols`；`orders.working_type` 默认值改 `CONTRACT_PRICE`；`positions` 按缺口 #12 改名 `position_amt` + 改部分索引。字段清单见 `docs/tutorial/04-order-validation.md` 第 7 节。**第 07 讲追加（缺口 #25）**：`order_type` 枚举加 `LIQUIDATION`；`symbols` 表加 `liquidation_fee`。第 11 讲接宿主之前完成 |
