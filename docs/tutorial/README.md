# 搭建教程总览

> 分工：第 01 讲数据库层你自己写；**01b、引擎（02–09）、服务端（10–14，2026-09-17 定）由 AI 写代码 + 讲义，你对照阅读**；数据库 schema 跟进仍由你写；前端由 AI 直接实现，不出教程。
>
> 引擎代码读不下去时先看 [engine-reading-guide.md](engine-reading-guide.md)。

---

## 怎么用这套教程

**一次只写"下一讲"的完整教程，其余模块在这里只有大纲。**

原因是每一讲都要接在你上一讲**真实写出来的代码**上，而不是接在我的假设上。第 01 讲已经证明了这一点：

- 你做了教程之外的选择（`fetch:brackets` 直接从币安拉分层表，后来又升级成官方接口每日同步，见 01b），后面的讲义要知道这件事
- 设计在变（登录方式从一种变成三种，表从 12 张变成 14 张），提前写好的讲义会过时

所以节奏是：

```
你照着讲义写代码 → 测试全绿 → 自己 commit → 告诉我"第 XX 讲做完了"
                                                    ↓
                        我读你的实际代码，写下一讲 ←┘
```

引擎部分改成 AI 写代码之后，节奏变成：**AI 写代码 + 讲义（不 commit）→ 你读讲义和代码、跑测试 → 你 commit → 开下一讲**。

每一讲结束时都有一份验收清单。**验收没全过，就不要进下一讲**——引擎模块是一层叠一层的，底下一层算错，上面全错。

---

## 进度

> 引擎代码读不下去？先看 [engine-reading-guide.md](engine-reading-guide.md)：不贴大段代码，只讲每个文件干什么、怎么串起来。

| # | 模块 | 位置 | 状态 |
| --- | --- | --- | --- |
| 01 | 数据库层：定标库、12 张表、种子与对账脚本 | `packages/shared` `packages/db` | ✅ 完成 |
| 01b | 分层表官方同步：签名接口、三道校验、每日定时任务 | `packages/db/src/brackets` `apps/server/src/jobs` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[01b-bracket-sync.md](01b-bracket-sync.md) |
| 02 | 引擎骨架、测试脚手架、回滚日志 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[02-engine-skeleton.md](02-engine-skeleton.md) |
| 03 | 计算公式：保证金、强平价、手续费、资金费 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[03-formulas.md](03-formulas.md) |
| 04 | 下单校验链（13 步） | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[04-order-validation.md](04-order-validation.md) |
| 05 | 市价单与成交落账 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[05-market-order-fills.md](05-market-order-fills.md) |
| 06 | 限价单与拟真排队 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[06-limit-orders-queue.md](06-limit-orders-queue.md) |
| 07 | 风控与强平 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[07-risk-liquidation.md](07-risk-liquidation.md) |
| 08 | 资金费与账户操作 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[08-funding-account-ops.md](08-funding-account-ops.md) |
| 09 | 触发单与只减仓 | `packages/engine` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[09-trigger-orders.md](09-trigger-orders.md) |
| 10 | 行情层：接币安 WebSocket | `apps/server/src/market` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[10-market-feed.md](10-market-feed.md) |
| 11 | 仓储层与引擎宿主：落库、恢复、定时任务 | `apps/server` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[11-engine-host.md](11-engine-host.md) |
| 12 | 鉴权：钱包 / 邮箱 / Google 三种登录 | `apps/server` `packages/db` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[12-auth.md](12-auth.md) ✅ 13a：REST `/account/positions` 按币安表示法输出（`positionSide` BOTH + `positionAmt` 带符号） |
| 13a | REST 接口（上）：HTTP 基础设施、交易、账户 | `apps/server/src/api` `apps/server/src/http` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[13a-rest-trading-account.md](13a-rest-trading-account.md) |
| 13b | REST 接口（下）：行情、权益快照、排行榜 | `apps/server/src/api` `apps/server/src/jobs` `apps/server/src/market` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[13b-rest-market-leaderboard.md](13b-rest-market-leaderboard.md) |
| 14 | WebSocket 网关 | `apps/server/src/ws` | ✅ 代码已实现（AI 编写，讲义对照阅读）：[14-websocket.md](14-websocket.md) |
| — | 前端 | `apps/web` | 由 AI 直接实现 |

### 计划外的补充讲（S 系列）

主线讲完之后，因为真实环境暴露的问题临时补的。**按日期读，不影响主线顺序。**

| # | 内容 | 位置 | 日期 |
| --- | --- | --- | --- |
| S01 | 行情层升级：盘口从 20 档换成完整盘口（增量流 + REST 快照） | `apps/server/src/market` | 2026-09-20 |
| S02 | 事故复盘：被币安封了 IP。限流闸门、盘口对齐的两个 bug、日志失真 | `apps/server/src/market` | 2026-09-20 |

- [S01-full-order-book.md](S01-full-order-book.md)
- [S02-rate-limit-incident.md](S02-rate-limit-incident.md) ← **S01 上线当天出的事故，接着 S01 读**

---

## 依赖关系与顺序

```
01 ─► 02 ─► 03 ─► 04 ─► 05 ─► 06 ─► 07 ─► 08 ─► 09 ──┐
       │                                            ▼
       └───────────► 10 行情层 ─────────────────► 11 仓储 + 宿主 ─► 12 鉴权 ─► 13 REST ─► 14 WS ─► 前端
```

**推荐顺序：02 → 09 先把引擎内核一口气做完，再做 10 → 14 服务端。**

- 引擎是纯函数，不需要数据库、不需要网络、不需要 VPS，测试毫秒级跑完——写起来反馈最快
- 引擎是"算错就前功尽弃"的部分，值得在没有任何外部干扰的环境里一次写对
- 代价是这段时间界面上看不到任何东西在动

**如果你需要阶段性看到东西在动**：第 10 讲只依赖第 02 讲的输入类型，可以在 02 之后任意时刻插队先做，先让终端里跳出币安的实时价格。

---

## 各讲大纲

### 02 · 引擎骨架与测试脚手架

- **做什么**：定死引擎的输入/输出事件类型；实现最小引擎（只处理行情输入和开户）；搭一个每次 `apply` 之后自动检查账目的测试脚手架；纯净性守卫
- **为什么先做**：后面 7 讲都往这个骨架里填逻辑。类型定错了，每一讲都要返工；不变式脚手架晚一天搭，"改了余额没写流水"这类 bug 就多潜伏一天
- **追加**：undo 日志 + `commit()` / `rollback()`——宿主写库失败时按改动回滚，代价和账户总数无关
- **验收**：`packages/engine` 7 个文件 32 条测试全绿；纯净性守卫能抓到故意塞进去的 `Date.now()`

### 03 · 计算公式

- **做什么**：`04-backend-design.md` 第 4 节全部公式——名义价值、起始保证金、未实现盈亏、保证金余额、可用余额、挂单冻结保证金、仓位变更（加仓均价 / 减仓已实现盈亏 / 反手拆分）、分层查找与维持保证金、保证金率、强平价、手续费、资金费
- **关键点**：每个公式对应 `02-architecture.md` 第五节的一条舍入规则，写错一条就对不上账；强平价三条算例必须**连反算一起**写进测试
- **顺带**：把第 02 讲留空的不变式 ③（可用余额非负）⑥（冻结保证金总额）补上
- **验收**：强平价 A 45,180.72 / B 54,780.88 / C 40,160.64 带反算；维持保证金 5 行算例；加仓均价 51,000；减仓已实现 +2,000

### 04 · 下单校验链

- **做什么**：`04-backend-design.md` 第 6 节 13 步校验，纯函数，返回"通过"或"错误码 + 带具体数字的中文提示"
- **关键点**：**顺序不能换**。第 9 步（杠杆分层）必须在第 10 步（余额）之前，否则会给出误导性提示
- **验收**：13 个错误码各一条测试；两条专门测"顺序"的测试
- **实际完成**：`validate-order.ts`，82 条测试（含 2026-09-17 对照币安标准的调整，见讲义第 7 节）；"顺序"第二条是一张同时违反第 4～13 步的单逐个修复、逐个暴露下一步；顺带定了缺口 #12（单向模式仓位内部存 LONG/SHORT）#13（GTX 下单时拒、触发时过期）

### 05 · 市价单与成交落账

- **做什么**：市价单逐档吃单；限价单下单瞬间的角色判定（会立刻成交的部分当 Taker 处理）；GTX / IOC / FOK；成交之后 → 更新仓位 → 扣手续费 → 发 `balanceUpdate`
- **关键点**：吃穿可见深度一半就拒单，不伪造价格；限价单穿透后剩余部分排队位置是 0
- **验收**：市价买 5 BTC 均价 50,000.4；`01-domain-knowledge.md` 第十二节第 1 步的流水（钱包 9,975）
- **实际完成**：`execute-order.ts`（`executeOrder` / `applyFill`），15 条成交测试；按币安加上开仓亏损（缺口 #14）；只减仓成交时截断 + 残余撤销（缺口 #18）；已实现盈亏改 `mulFloor`；不穿透的 GTC / GTX 限价单留给 06，触发单留给 09

### 06 · 限价单与拟真排队

- **做什么**：初始排队位置估算；用 `aggTrade` 成交流消耗队列；盘口更新时总量夹逼；撤单
- **关键点**：`m` 字段方向弄反会让订单在不该成交时成交；Maker 成交价永远是挂单价不是行情价
- **验收**：`04-backend-design.md` 5.5 节 T0→T4 那张表逐行断言；`06-testing-design.md` 第 3 节排队 6 条 + 限价角色 4 条场景
- **实际完成**：`queue.ts`（估算 / 夹逼 / 消耗）+ `resting-orders.ts`（`book` 夹逼、`trade` Maker 成交、`cancelOrder`），34 条测试；`trade` 输入加 `tradeId`、`qty` 取币安 `nq`；定了缺口 #20 #21，新记 #22 #23；顺带补了 `01-domain-knowledge.md` 第十二节第 4 步（Maker 平仓）的测试

### 07 · 风控与强平

- **做什么**：标记价更新后、成交后跑风控扫描；逐仓逐个判、全仓整户判；先撤单再平仓；收清算费；余额归零不倒扣
- **实际完成**：`risk.ts`（`riskScan`：逐仓逐个判、全仓整户判；强平单吃盘口 + 破产价兜底；Taker 手续费 + 按币对清算费（成交价名义价值），费用扣到 0 为止），接到 `markPrice` / `trade` / `placeOrder` 之后；`LIQUIDATION` 订单类型；不变式 ③ 收窄、新增 ⑨；缺口 #7 #19 #23 定了，新记 #24 #25；20 条测试
- **验收**：强平价前一档不强平、触及强平价强平、逐仓只亏逐仓保证金、全仓余额归零不为负

### 08 · 资金费与账户操作

- **做什么**：资金费结算（结算后立刻跑风控）；调杠杆、切保证金模式、切持仓模式、调逐仓保证金、账户重置
- **验收**：资金费 4 条场景；**把 `01-domain-knowledge.md` 第十二节整张流水表完整重放一遍，净收益 +1,959.5**——这是引擎内核的毕业考试
- **实际完成**：`funding.ts`（资金费结算，逐仓从逐仓保证金付，结算后扫风控）、`account-ops.ts`（调杠杆、切保证金模式、切持仓模式、调逐仓保证金、账户重置，规则按币安核对）；`ledger-replay.test.ts` 用真实输入把第十二节整张表重放通过（11,959.5）；`01-domain-knowledge.md` 过时的六处加了注；缺口 #6 补定（调逐仓保证金不写流水），新记 #26 #27；23 条测试

### 09 · 触发单与只减仓

- **做什么**：止损/止盈四个方向的触发判定；触发瞬间才校验保证金；`closePosition`；仓位平完后残余只减仓单自动撤销
- **验收**：止损买 / 止损卖 / 止盈买 / 止盈卖**四条一条都不能少**
- **实际完成**：`triggers.ts`（下单入簿不冻结保证金；标记价 / 最新价推送时按 workingType 检查；触发时转 MARKET / LIMIT 重走校验链，失败 REJECTED、GTX 会吃单 EXPIRED；closePosition 按当时全部仓位）；校验链第 14 步（触发价已穿过拒单、条件单合计 200）；标记价推送先查触发再跑风控；缺口 #13 #15 定了，新记 #28 #29；18 条测试。**引擎内核（02–09）全部完成**

### 10 · 行情层

- **做什么**：连币安组合流；解析 `aggTrade` / `depth20` / `markPrice` / `kline`（字符串直接 `parse()`，不经过 `number`）；指数退避重连；断线降级状态
- **验收**：终端实时打印 20 个币对价格；拔网线 30 秒后自动恢复；解析层用一段录下来的真实推送做单测
- **实际完成**：`streams.ts`、`parse.ts`、`connection.ts`（指数退避 + 10 秒看门狗）、`market-feed.ts`（两条连接合成、connecting / ready / degraded + 按币对就绪）、`exchange-info.ts`、`watch.ts`（`pnpm --filter server market:watch`）；30 条真实推送做解析测试；缺口 #22 定了、#16 行情层这一半做了；发现 TONUSDT 已下架结算（#30）；server 44 条测试

### 11 · 仓储层与引擎宿主

- **做什么**：一笔成交的全部变更放进一个事务；纯挂单变化异步批量写；启动恢复（排队位置保守重置 + 全账户风控补扫）；资金费定时器；每日权益快照
- **验收**：真数据库 + 假行情的集成测试；进程被 `kill -9` 后重启，`reconcile:ledger` 依然通过
- **实际完成**：数据库迁移 0003 / 0004（symbols 加 10 列交易规则、positions `qty` → 带符号 `position_amt`、`order_type` 加 `LIQUIDATION`、`orders.working_type` 默认值）并应用到本地库，`seed:symbols` 同步新列、拒绝不在 TRADING 的开放币对；开放名单去掉 TONUSDT（19 个）；`persistence/`（id 换算 uuid v5、仓位表示法互转、加载、一个事务落库）；`engine-host/`（串行队列 + 回滚、行情门控、盘口合并、资金费由标记价推送驱动、启动恢复、分层表热加载）；引擎加 `setBrackets` 输入；server 接上；缺口 #8 #12 #16 #17 #25 #30 定了，新记 #32～#34；真数据库集成测试（含重启恢复对比）

### 12 · 鉴权

- **做什么**：先做一次真实的 schema 迁移（`accounts` 拆出 `identities`，新增 `email_verification_codes`，`shared` 补枚举和错误码）；再实现钱包验签、邮箱验证码、Google OAuth，三条路收敛到同一套 JWT
- **验收**：三种方式都能登录并拿到 10,000 USDT；三种身份互相独立不合并
- **实际完成**：迁移 0005（`accounts` 删 `address` / `chain`，删列前手写回填；新增 `auth_provider` 枚举、`identities`、`email_verification_codes`）已应用到本地库；`shared` 补 `AUTH_PROVIDER` 和 5 个错误码；开户改为身份先记内存、`registerAccount` 的 INITIAL 流水落库时账户 + 身份 + 流水一个事务（`engine-host/register-account.ts`，并发首次登录撞唯一索引 → 回滚 → 重查）；`http/respond.ts` 响应包络；`auth/`（JWT、SIWE / SIWS 验签、邮箱验证码 + Resend、Google OAuth + PKCE、脱敏昵称、7 个接口）；缺口 #9 定了，新记 #35～#38；真数据库验收 6 条 + 单元 15 条；真 server 邮箱登录 → `kill -9` → 重启恢复 → 对账通过

### 13 · REST 接口

- **做什么**：统一响应包络；zod 校验；`bigint` 序列化边界；限流；游标分页；交易/账户/行情/排行榜路由
- **验收**：每个接口一条集成测试；同一个 `clientOrderId` 提交两次只产生一张单
- **拆成两讲**（2026-09-17）：接口有 25 个，13a 做 HTTP 基础设施 + 交易 + 账户，13b 做行情 + 权益快照 + 排行榜
- **13a 实际完成**：`http/`（数值边界：只收字符串、超过 8 位小数拒绝不截断；固定窗口限流三档；游标分页 (时间, id)）；引擎只读视图 `views.ts`（账户资产 / 仓位视图，字段对照币安 account v3 / positionRisk v3，缺标记价返回 null）+ 宿主 `read()` 排队读；引擎新输入 `cancelAllOrders`；**修了全仓强平价 cum 符号 bug（缺口 #39）**，按币安 FAQ 重写并换档重算；修了宿主队列只剩同步任务时卡死的 bug；`api/` 交易 3 + 仓位 4 + 账户 10 个接口，`app.ts` 组装；缺口 #12 #24 #26～#29 定了，新记 #39～#44；真数据库集成测试 7 条（含并发幂等、并发重置、限流、分页不重不漏）；真 server 对真实行情下单撤单
- **13b 实际完成**：`market/binance-rest.ts`（K 线 / 历史资金费率 / 24 小时统计代理币安，TTL 缓存 + 并发只请求一次 + 被限流按 Retry-After 退避 + 严格解析）、`market/market-state.ts`（最新标记价 / 指数价格 / 成交，标记价推送补解析指数价格 `i`）；引擎只读视图加 `marketView` `allAccountViews`；`api/market.ts` 6 个接口、`api/leaderboard.ts`、`/account/equity-curve`、调杠杆返回 `maxNotional`；`jobs/equity-snapshot.ts` 每日 UTC 00:00 快照；排行榜口径用户定（缺口 #48）；缺口 #31 #34 #44 定了，新记 #45～#48；测试脚手架抽到 `testing/api-harness.ts`；真数据库集成测试 9 条（行情 6、排行榜 3）

### 14 · WebSocket 网关

- **做什么**：公共频道（行情）+ 私有频道（账户推送）；连接鉴权；心跳；行情降级通知
- **验收**：两个账户同时在线互不串号；断线重连后状态一致
- **实际完成**：`ws/protocol.ts`（消息与频道名解析，补 ack / error，缺口 #49）、`ws/hub.ts`（订阅、auth 后自动订私有频道、token 过期降级、30 秒心跳 / 60 秒断开）、`ws/publisher.ts`（行情事件 → 公共频道，宿主 `onCommitted` → 私有频道，账户快照按 apply 去重）、`ws/server.ts`（直接用 `ws` 库接 upgrade，缺口 #51）；交易内核加 `onMarketEvent` / `onFeedStatus` / `onCommitted` 三个钩子；缺口 #49～#52；server 138 条测试（新增 17：协议 2、hub 8、推送 4、端到端 3）；真 server 实测 9 秒内收到盘口 81 / 成交 32 / ticker 9 / K 线 18 条，下单撤单各推一条 order

---

## 设计缺口清单

读设计文档写教程时发现的、文档没说清楚或前后矛盾的地方。**不在这里记下来，就会在写代码时被某个人随手决定掉。**

> 拿不定的地方以币安为标准，实现不了的问用户——规则见 `HANDOFF.md` 第六节"决策规则"。

| # | 缺口 | 在哪一讲解决 |
| --- | --- | --- |
| 1 | `02-architecture.md` 第六节的 `EngineInput` 没有开户、账户重置、切持仓模式、调逐仓保证金这几种输入 | 02（已补进类型） |
| 2 | 订单 id 谁来生成没说——引擎不能用随机数 | 02（宿主生成，放进 `placeOrder` 输入） |
| 3 | `rejected` 事件只带 `clientOrderId`，撤单被拒时根本没有这个字段 | 02（改成通用形状） |
| 4 | `liquidation` / `fundingPaid` 事件的字段和对应数据库表对不上 | 02（改成和表一一对应的记录） |
| 5 | 强平价要不要对齐 `tickSize`：4.6 节伪代码里对齐了，但算例（45,180.72）保留两位小数，并不是 0.1 的整数倍 | ✅ 03：不对齐（`04-backend-design.md` 4.6 节已加注）。强平价是风控阈值，不是要挂盘口的委托价，只在最终一步 `divRound` 到 8 位 |
| 6 | **逐仓保证金算不算在钱包余额里**：`01` 第十二节说开逐仓后钱包是 9,975（算在里面），`04` 第 8 节强平结算"余额 > 0 退回 walletBalance"的写法又像不在里面。这决定开仓时要不要写流水 | ✅ 03：不算。开仓不产生 `walletBalance` 变动，只有手续费/已实现盈亏/资金费/强平才动它；逐仓保证金只是把钱从"可用"标成"锁定"，体现在 `availableBalance` 的减项里，不是一条流水。`adjustIsolatedMargin`（手动划转）留给 08 讲单独定。✅ 08 补定 `adjustIsolatedMargin`：同理不写流水，只改 `isolatedMargin`（在"全仓可用"和"锁给仓位"之间挪）；资金费发生在逐仓仓位上时钱包和 `isolatedMargin` 一起变 |
| 7 | 强平成交要写 `fills`，但 `fills.order_id` 是非空外键，强平并没有用户下的订单 | ✅ 07：按币安，强平时系统生成一张 `type = LIQUIDATION` 的订单（`clientOrderId` 以 `autoclose-` 开头），成交引用它。`packages/shared` 的 `ORDER_TYPE` 已加 `LIQUIDATION`，**数据库 `order_type` 枚举要迁移（用户写）** |
| 8 | 引擎内的 id 是确定性字符串（为了可重放），数据库里的 id 列是 uuid | ✅ 11：`persistence/ids.ts`——本来就是 uuid 的（宿主生成的订单 id、账户 id）原样用，其它按 UUID v5（固定命名空间）换算。同一个引擎 id 永远同一个 uuid：外键、流水 ref_id 各自换算也对得上，重复落库撞主键，不需要映射表 |
| 9 | 代码是 12 张表，设计文档已经是 14 张表 | ✅ 12：迁移 0005 新增 `auth_provider` 枚举、`identities`、`email_verification_codes`，`accounts` 删 `address` / `chain`（删列前 SQL 手写回填：`chain` → `wallet_<chain>`），已应用到本地库；`chain` 枚举保留给 `auth_nonces`。账户行由 `persist.ts` 在 INITIAL 流水的事务里建（和身份一起） |
| 10 | 写库失败怎么回滚内存没说。若宿主每次 `apply` 前调 `snapshot()`，代价是 O(全体账户)，账户一多就被 GC 拖垮。方向已定为引擎内 undo 日志 + `commit()` / `rollback()`，见 `02-architecture.md` 第七节"回滚怎么做" | 02（已实现：`journal.ts` + `commit()` / `rollback()`，第 7 节） |
| 11 | `packages/shared` 的 `format(value, precision)` 精度不足 8 位时是**截断**不是四舍五入，写强平价算例 B 的测试才发现：内部值 54780.87649402…，截断显示成 "54780.87"，和文档里手算四舍五入的 "54780.88" 对不上 | ✅ 03：改成四舍五入（`format` 先对整个值按目标精度四舍五入再拆分整数/小数部分，进位能正确传到整数位），补了对应测试 |
| 12 | **单向持仓模式下仓位怎么存**：`04-backend-design.md` 第 3 节说"内部仍用 LONG/SHORT"，`packages/db` 的 `positions.ts` 注释说"单向模式恒为 BOTH"。`qty` 非负，存 BOTH 分不清多空 | ✅ 04（引擎侧）：订单上是 BOTH，仓位在引擎内部存 LONG/SHORT + 非负 qty，同币对最多一个。✅ 2026-09-17 用户定（数据库侧）：**按币安标准**（`GET /fapi/v3/positionRisk`：单向模式 `positionSide = BOTH`，`positionAmt` 多正空负，双向模式 SHORT 也为负）。第 11 讲迁移：`qty` 改名 `position_amt` 存带符号数量，部分索引条件改 `position_amt <> 0`，仓储层负责两种表示法互转。设计文档 03/04 已加注。REST `/account/positions` 输出是否也用 `positionAmt` 带符号，第 13 讲确认（建议一致）。✅ 11：迁移 0003 / 0004 已应用到本地库；`persistence/positions.ts` 互转 |
| 13 | GTX 会吃单：`04` 第 6 节第 12 步说拒单（`POST_ONLY_REJECTED`），第 3 节状态机、5.4 节、`06` 场景表说 `EXPIRED` | ✅ 04：时机不同。普通 LIMIT+GTX 下单时就会吃单 → 拒单；止损/止盈限价单的 GTX 在触发时才会吃单 → 转 `EXPIRED`（09 讲）。`04` 第 3/5.4/6 节、`06` 场景表已加注。✅ 09 已实现：触发时 GTX 会吃单 → `EXPIRED`；其它触发时校验失败按币安条件单状态 → `REJECTED`（不是设计里的 `EXPIRED`） |
| 14 | 所需保证金没算"开仓亏损"：市价买单成交价高于标记价，成交瞬间就有浮亏，币安会把它加进所需保证金；设计文档只写了"起始保证金 + 预留手续费" | ✅ 05：按币安 FAQ 公式实现（开仓成本 = 起始保证金 + 开仓亏损），市价单用真实逐档成交价，另外仍预留 Taker 手续费。见 `05-market-order-fills.md` 第 3 节、`docs/design/07-binance-reference.md` 第 5 节 |
| 15 | 触发单的触发价在下单时就已经被穿过（例如标记价 50,000 时挂触发价 49,000 的止损买单），币安会拒，设计文档没提 | ✅ 09：校验链第 14 步，按 workingType 取标记价或最新价判断，满足触发条件就拒 `WOULD_IMMEDIATELY_TRIGGER`（`packages/shared` 新增错误码，币安 -2021 / -4142） |
| 16 | 校验链第 2 步"行情就绪"只能查有没有盘口/标记价，查不了新不新——引擎没有时钟。行情断线暂停交易要由宿主负责 | ✅ 10（行情层这一半）：`market-feed.ts` 报告 connecting / ready / degraded 和按币对的 `symbolReady()`；静默断线由 10 秒看门狗发现。✅ 11（宿主一半）：`engine-host.ts` 按币对就绪门控——行情成交和标记价丢掉、下单拒 `MARKET_NOT_READY`、资金费跳过；盘口照常喂 |
| 17 | **和币安标准核对第 04 讲后，和已定设计冲突 / 要改数据库的三处**（2026-09-17，依据：币安 New Order / New Algo Order 接口说明、U 本位合约错误码、`GET /fapi/v1/exchangeInfo` 实时数据）：① 挂单数上限口径（我们每账户 200，币安 `MAX_NUM_ORDERS` 每币对 200）② 触发单默认价格类型（设计 `MARK_PRICE` 且误称与币安一致，币安默认 `CONTRACT_PRICE`）③ `PRICE_FILTER` 上下限、`LOT_SIZE.maxQty`、`MARKET_LOT_SIZE`、按币对的 `PERCENT_PRICE` 需要 `symbols` 表存 | ✅ 2026-09-17 用户定：三处都按币安。①② 第 04 讲已实现；③ 引擎 `SymbolSpec` 已实现，**`symbols` 表加列和 `seed:symbols` 同步由用户写**（字段对照见 `04-order-validation.md` 第 7 节），`orders.working_type` 默认值同样待改。✅ 11：`symbols` 表 10 列（含第 07 讲的 `liquidation_fee_rate`）+ `seed:symbols` 已做（AI 写，用户授权），`working_type` 默认值已改 |
| 18 | 只减仓数量要不要扣掉其它挂单：币安 `-2022` 只说"新的只减仓单和已有挂单冲突"，文档没写清 | ✅ 2026-09-17 用户定：下单时只和当前仓位比（规则一，现状）。"只平不反"由成交时保证——✅ 05 已实现：只减仓类订单成交时截断到剩余仓位；仓位平完后同方向残余只减仓挂单 `CANCELED` |
| 19 | 不变式 ③"可用余额非负"只在开仓类操作下成立：全仓仓位浮亏（价格不利变动）会让可用余额在强平之前就变成负数，测试脚手架会误报 | ✅ 07：强平线是维持保证金，不是可用余额，浮亏让可用余额变负是正常状态（此时开不了新仓）。③ 改成"一次成功的下单不会把可用余额从非负变成负数"：测试脚手架只在下单成功、且下单前可用余额非负时检查下单账户。另外新增不变式 ⑨：每次 `apply` 之后不能留下该强平没强平的仓位 |
| 20 | 设计文档 5.5 节排队伪代码漏了两种情况，都偏向对用户有利：① 挂单价在可见 20 档**范围内**但落在空价位上，伪代码走"最深档兜底"；② 盘口更新时挂单**掉出视野**（价格往反方向跑远），伪代码"找不到这一档就归零"，等于把用户排到队首 | ✅ 06：① 范围内的空价位前方就是 0 量，`queueAhead = 0`、不算估算；② 比可见最深档还深时保持不动。只有"正好有这一档"才夹逼，只有"范围内这一档没了"才归零。`04` 5.5 节已加注 |
| 21 | 排队位置变化要不要发事件落库：`queue_ahead` 是 `orders` 表的列，但 depth 每 100ms 一次 | ✅ 06：**不发事件**。内存值是准的；数据库里的值跟着成交、撤单的 `orderUpdate` 顺带写，重启后按当时盘口保守重置（`04` 第 10 节第 4 步），旧值本来就不用。仍然走 `putOrder` 进 undo 日志 |
| 22 | **币安合约 WebSocket 地址拆分**：depth / bookTicker 走 `wss://fstream.binance.com/public/`，aggTrade / markPrice / kline 走 `/market/`（币安 "Important WebSocket Change Notice"：旧地址 `/ws`、`/stream` 2026-04-23 之后只推 `/public` 那一类数据）。`04` 第 2 节还是旧的 `/stream`，2026-09-17 实测旧地址收得到 depth、收不到 aggTrade，和公告一致。另外 aggTrade 推送有 `nq`（不含 RPI 订单的成交量），RPI 挂单不在 depth 流里 | ✅ 10：`streams.ts` 按新地址拆成两条连接；`parse.ts` 数量取 `nq`、id 取 `a`；`04` 第 2 节已加"已定" |
| 23 | 挂单的冻结保证金只在下单、自己部分成交时算，**仓位变了不会重算别的挂单**：单向模式持多 1、挂普通限价卖 2（只冻结开空 1 的成本），之后市价平掉多头，这张挂单全成交会开空 2，冻结却只有 1 份，可用余额被高估 | ✅ 07：成交改变仓位后，同账户同币对的其它挂单按新仓位重算冻结保证金，变了就发 `orderUpdate`（`refreshFrozenMargins`）。只在仓位变化时重算，标记价变化不重算。重算后可用余额可能变负，挂单不撤——强平只看维持保证金 |
| 24 | `01-domain-knowledge.md` 算例 B（逐仓空头强平价 54,780.88）固定用了第 1 层 0.4%，但 54,780.88 的名义价值已经超过第 1 层上限 50,000，应该用第 2 层 | ✅ 07：真实强平价 54,776.12。第 03 讲的公式测试保留（它演示公式，分层是传进去的），风控扫描按名义价值查层。`01` 第六节已加注 ✅ 13a：强平价按币安 FAQ 换档重算，算例 B 的展示强平价 = 54,776.12，和风控真正强平的位置一致（`views.test.ts` 标记价比强平价高 / 低 0.01 验证） |
| 25 | 第 07 讲要数据库跟进的两处：① `order_type` 枚举加 `LIQUIDATION`（`packages/shared` 已改，要生成迁移）② `symbols` 表加 `liquidation_fee`（币安 exchangeInfo 币对字段，`seed:symbols` 同步），引擎 `SymbolSpec.liquidationFeeRate` 读它；`FeeConfig` 里原来的全局 `liquidationFeeRate` 已删 | ✅ 11：已做（AI 写并应用到本地库，用户 2026-09-17 授权） |
| 26 | `ledger_entries` 的 `MARGIN_TRANSFER` 类型现在没有任何事件会产生：调逐仓保证金不改钱包余额（缺口 #6），不写流水。用户要看"调过几次保证金"的历史，只能从 `positionUpdate` 里看 | 08 定：暂不用。第 13 讲做 REST 时如果需要调整历史（币安有 `GET /fapi/v1/positionMargin/history`），再决定加表还是复用这个类型 13a：不做保证金调整历史接口，`MARGIN_TRANSFER` 继续不用 |
| 27 | 账户操作的错误码和币安不是一一对应：调逐仓保证金减太多，币安是 `-4051 ISOLATED_BALANCE_INSUFFICIENT`，我们沿用设计文档的 `MARGIN_WOULD_LIQUIDATE`（名字窄了：币安的上限还包括"不能低于起始保证金"）；调杠杆超范围、逐仓不能调低、设置没变都归到 `INVALID_PARAMS`。对照表见 `07-binance-reference.md` 第 9 节 | 13：REST 层返回错误时决定要不要细分，改 `packages/shared` 的 `ERROR_CODES` 13a：不细分，沿用现在的错误码（`MARGIN_WOULD_LIQUIDATE` / `INVALID_PARAMS`），`message` 里写清楚最多可调多少 |
| 28 | 触发单没实现的币安参数 / 规则：`priceProtect`（触发时标记价和最新价偏差不能超过币对 `triggerProtect`，币安默认 false）；止损 / 止盈限价单委托价相对触发价的上下限（-4183 / -4184，文档没写用哪个字段）；`TRAILING_STOP_MARKET`；`GTD` | 13：REST 下单接口定参数时决定要不要支持；支持前 zod 直接拒这些参数 ✅ 13a：`POST /orders` 用 zod 严格模式，这些参数一律 `INVALID_PARAMS`"不支持的参数：xxx" |
| 29 | 触发后沿用同一张订单（`triggered = true`），不像币安那样新开一张普通单（algoId → actualOrderId）。好处是 `orders` 表不用加映射；代价是对外接口的订单 id 语义和币安不同 | 13：REST / WS 输出订单时确认是否需要区分条件单和触发后的普通单 13a：不区分。订单输出带 `triggered` 字段，触发后还是同一个 id |
| 30 | **TONUSDT 已下架结算**：2026-09-17 exchangeInfo 状态 `SETTLING`（`deliveryDate` = 2026-06-23），盘口为空，但还在 `packages/db/src/brackets/open-symbols.ts` 的 `OPEN_SYMBOLS` 里。订阅它行情源永远 ready 不了 | 行情层只订阅 `TRADING` 的币对（已做）。✅ 11：用户定去掉，开放名单 19 个，`seed:symbols` 已跑；`seed:symbols` 现在遇到开放名单里不是 TRADING 的币对直接中止 |
| 31 | 行情层第 10 讲没做的：K 线缓存和历史 K 线（设计第 1 节 `kline-store.ts`、`binance-rest.ts`）。K 线只给前端画图，引擎不用 | 13 / 14：REST 行情接口和 WS 公共频道时再做 → 13b ✅ 13b：`/market/klines` 代理币安 REST（5 秒 / 已收盘段 10 分钟缓存），行情层实时 K 线推送留给第 14 讲 WS |
| 32 | 设计文档第七节"纯挂单变化（下单成功、撤单）异步批量写"没做：第 11 讲**所有事件同步、一个事务**落库。实测会产生事件的输入很少（盘口、大部分行情成交、标记价推送都是 0 个事件，不碰库），同步换来"内存 == 数据库"始终成立、kill -9 什么都不丢 | 压测（06-testing-design 第 7 节）发现落库成为瓶颈时再做批量写 |
| 33 | 资金费结算用的是结算时间之前最后一条标记价推送（最多早 1 秒）的费率和标记价，不是币安结算那一刻的精确值；结算前最后一条推送离结算时间超过 10 秒（行情断过）就跳过这次结算 | 币安 `GET /fapi/v1/fundingRate` 能查每次结算的精确费率和标记价，要更准可以结算后异步核对（未排期） |
| 34 | 每日权益快照（`equity_snapshots`，大纲写在第 11 讲）没做：它只服务排行榜和收益曲线，和账目正确性无关 | 13：做排行榜接口时一起做 → 13b ✅ 13b：server 定时任务 `jobs/equity-snapshot.ts`（不是设计里的独立脚本 `snapshot:equity`——权益要用引擎按标记价算，脚本连不上引擎），口径见 #48 |
| 35 | **JWT 载荷**：`04` 第 11 节写 `{ sub: accountId, addr, chain, iat, exp }`，是只有钱包登录时的形状；拆出 `identities` 后账户没有地址，邮箱 / Google 账户也没有链 | ✅ 12：载荷只放 `{ sub: accountId, iat, exp }`，身份信息查 `/auth/me`。第 14 讲 WS 鉴权用同一个 `verifyToken`。`04` 已加注 |
| 36 | **SIWE statement 不能是中文**：`04` 第 11 节示例的待签名文本里声明句是"登录币安合约模拟交易平台"；EIP-4361 规定 statement 是 ASCII（viem 只检查换行，中文能生成，但严格解析的钱包 / 库会拒） | ✅ 12：用英文声明句，写明"不是交易、不花 gas"（`wallet.ts` `SIGN_IN_STATEMENT`）。Solana SIWS 用同一句。`04` 已加注 |
| 37 | **Google 取 sub 的方式**：`04` 写"用 access_token 查 userinfo" | ✅ 12：从 token 端点直接返回的 ID token 里取 sub（OpenID Connect Core 3.1.3.7：服务端经 TLS 直接从 token 端点拿到的 ID token 可用 TLS 校验代替签名校验），少一次请求，sub 相同。`04` 已加注 |
| 38 | **钱包 nonce 标记已用的时机**：`04` 写"取出 → 验签 → 标记已使用"，两个并发请求拿同一个签名会都通过 | ✅ 12：先用条件 `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING message` 原子领走，再用返回的原文验签；签名不对也算用掉。邮箱验证码同理（错误计数 SQL 内 +1、条件 UPDATE 领走）。`04` 已加注 |
| 39 | **全仓强平价公式 cum 的符号写反了**（第 03 讲 `liquidation.ts`）：写成 `+ cumB − cumL`，全仓时 cum 取了减号。第 03 讲三个算例都在 cum = 0 的第 1 层，测试没发现。另外三处和币安 FAQ 不一致：全仓 WB 用的是钱包余额（应为 crossWalletBalance）、双向持仓没把同币对多空两条腿放进同一个公式、没按"强平价处的名义价值"换档重算 | ✅ 13a：按 FAQ「How to Calculate Liquidation Price of USDⓈ-M Futures Contracts」重写，FAQ 的 ETH 1,153.26 / BTC 26,316.89 算例进测试（旧写法得 1,234.91）。这个函数只用于展示，风控强平不经过它，没影响过任何资金。`01` 第六节、`04` 4.6 节已加注 |
| 40 | 资产接口的 `openOrderMargin` 是挂单冻结保证金之和，含 Taker 手续费预留（第 04 讲 `frozenMargin`）；币安 `totalOpenOrderInitialMargin` 只是起始保证金 | 13a：字段名不叫 openOrderInitialMargin，避免让人以为口径相同；要完全对齐得查币安挂单保证金是否含手续费（未查） |
| 41 | **下单幂等的范围**：设计文档是"同一 `(accountId, clientOrderId)` 返回已存在的单"；币安 `newClientOrderId` 只要求"在未完成订单里唯一"，重复时报错 | 13a：按设计文档做，而且对历史订单也生效（数据库唯一索引），重复提交返回原单 + 响应头 `X-Idempotent-Replay: true`。被拒的单不入库，同一个 id 改参数可以重下 |
| 42 | 调逐仓保证金的 `type`：币安 Modify Isolated Position Margin 用 `1` 增加 / `2` 减少 | 13a：用可读的 `"ADD"` / `"REDUCE"`。我们的接口本来就不兼容币安（`qty` 不叫 `quantity`、数值是字符串） |
| 43 | **可用余额里全仓起始保证金按开仓价算**（`04` 4.2 节、第 04 讲），币安 positionRisk 的 `initialMargin` 是 "with current mark price"。仓位展示已按币安用标记价，但可用余额（下单校验用的那个数）还是开仓价口径，两者对不上 | 待查：币安 `availableBalance` 的全仓起始保证金用哪个价（FAQ 没查到原文前不改引擎的下单校验）。13a 在 `views.test.ts` 里明确断言了现在的口径，改的时候会红 |
| 44 | `POST /positions/leverage` 只返回 `{ symbol, leverage }`；币安 Change Initial Leverage 还返回 `maxNotionalValue`（当前杠杆下最大可开名义价值），前端"最大可开"要用 | ✅ 13b：调杠杆返回 `maxNotional`；`/market/symbols` 带整张分层表 |
| 45 | 胜率的"平仓成交"按 `fills.realized_pnl ≠ 0` 或强平成交认：fills 表没有开仓 / 平仓标记，已实现盈亏恰好为 0（精确到 1e-8）的平仓成交不计入胜率分母 | 13b：接受这个近似。要精确得给 fills 加一列（引擎 Fill 事件里其实知道是不是减仓），排行榜需要时再加 |
| 46 | 币安 `GET /fapi/v1/fundingRate` 文档写 limit 最大 1000、不带时间范围时返回最近 200 条；2026-09-17 实测 `limit=1000` 返回 500 条 | 13b：接口按文档允许 1～1000，实际条数以币安返回为准，不补不编。`07` 第 12 节已记 |
| 47 | ticker 的 24 小时统计走币安 REST（3 秒缓存），没订阅 `<symbol>@ticker` 推送流 | 13b：REST 首屏够用，不动第 10 讲的订阅；第 14 讲 WS 要实时推 24 小时统计时再决定加不加这个流 |
| 48 | **排行榜口径**：设计文档只有 `roi / winRate / tradeCount` 字段名，没有定义，币安也没有可照搬的规则 | ✅ 2026-09-17 用户定：① 总榜 ROI = (权益 − 10,000) ÷ 10,000，从上次重置算；日榜 / 周榜 = 期内权益变化 ÷ 期初快照权益，期内重置过不上榜 ② 胜率按平仓成交（#45），成交次数 = 统计期内成交笔数 ③ 每日 UTC 00:00 快照，错过超过 60 秒就跳过当天、不补拍；缺标记价或行情未就绪的账户当天跳过 ④ 至少有过一笔成交才上榜。`04` 已加注 |
| 49 | WebSocket 协议只写了数据推送 `{ ch, ts, d }` 和四种客户端 op，没写"订阅成功 / 出错怎么回" | ✅ 14：补两种服务端消息，形状和数据推送一致——`ch: "ack"`（回执：哪个 op、接受和拒绝了哪些频道）、`ch: "error"`（用 REST 同一套错误码）。`04` 第 12 节已加注 |
| 50 | `ticker` 频道设计里要推"涨跌幅"，那是 24 小时统计，来自币安 REST（13b），推送里没有 | 14：推送只带实时价格（最新价 / 标记价 / 指数价 / 资金费率），涨跌幅前端首屏拉 `/market/ticker`。要实时涨跌幅就得订阅币安 `<symbol>@ticker` 流（缺口 #47） |
| 51 | Hono 的 Node WebSocket 适配 `@hono/node-ws` 只兼容 `@hono/node-server` v1，我们用的是 v2 | ✅ 14：不用适配层，直接用 `ws` 库接在 HTTP server 的 upgrade 事件上（`ws/server.ts`）。协议本来就是消息驱动的，路由层面只认一个路径 |
| 52 | 设计文档没写"token 在长连接期间过期怎么办" | ✅ 14：按 token 的 exp 排定时器，到点取消这条连接的私有订阅并推一条 `TOKEN_EXPIRED`，客户端重新 auth 即可。不然一条长连接能绕过 7 天有效期 |

---

## 已知问题（和本教程无关，不用管）

`pnpm run check-types` 会在两个地方失败，都是这个项目开工前就有的：

- `web`：`src/app/books/page.tsx`，books 练手页
- `native`：`app/(drawer)/index.tsx`，Expo 端第一版不动

所以教程里的类型检查一律**按包单独跑**，比如：

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run check-types
```
