# 会话交接说明

> 给接手这个项目的 Claude Code（或任何人）。
> 生成时间：2026-09-15 ｜ 最后更新：2026-09-21（M10 历史记录完成，前端 14 个模块做完 10 个）｜ 来源：Claude 桌面端 Cowork 会话

---

## 一、目前走到哪了

**后端全部完成**：数据库、引擎内核（02–09）、服务端（10–14），外加真实环境逼出来的 S01～S03（完整盘口、限流事故、盘口精度）。
**现在在做前端 `apps/web`**，按功能拆成 M00～M13 共 14 个模块（见 `docs/frontend/README.md`），已做完 12 个：M00～M08 + S01 + M10 + M11 + M12。
**下一个**：M08b 跟踪委托（要先开第 15 讲：引擎 + 迁移 + 接口）、M09 图上交易线、M13 整体验收。前端只剩这三块。

分工：服务端 10–14 讲由 AI 写代码 + 讲义；第 11 讲起数据库 schema / 迁移也由 AI 写并应用到本地库（用户 2026-09-17 定）；
**2026-09-20 起用户只做决策不读代码，每次改动一律附一份人话讲义**。前端不出正式教程，但每个模块有讲义。
服务端进度见 `docs/tutorial/README.md`，前端进度见 `docs/frontend/README.md`。

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
| 第 07 讲 · 风控与强平 | ✅ 2026-09-17 AI 实现 + 讲义：`risk.ts`（逐仓逐个判、全仓整户判；撤单 → 强平单逐档吃盘口、比破产价差的不吃、剩余按破产价平 → Taker 手续费 → 清算费，每项封顶到剩余资产）；用户定：强平成交"吃盘口 + 破产价兜底"、不做部分强平、强平收交易手续费、费用不够扣到 0 为止；清算费按币安币对费率（BTC 1.25%）× 成交价名义价值；`LIQUIDATION` 订单类型（缺口 #7）；不变式 ③ 收窄、新增 ⑨（#19）；其它挂单冻结保证金随仓位重算（#23）；发现算例 B 选层错误（#24）；引擎 243 条测试全绿；讲义 `docs/tutorial/07-risk-liquidation.md`；已 commit（`1dfb60b`） |
| 第 08 讲 · 资金费与账户操作 | ✅ 2026-09-17 AI 实现 + 讲义：`funding.ts`（名义价值按标记价；逐仓从逐仓保证金付；结算后扫风控）、`account-ops.ts`（调杠杆 / 切保证金模式 / 切持仓模式 / 调逐仓保证金按币安规则和 FAQ 公式；账户重置撤单 + 标记价平仓 + RESET 流水，冷却交给宿主）；`ledger-replay.test.ts` 用真实输入重放 `01` 第十二节整张流水表通过；`01-domain-knowledge.md` 六处过时内容加注；缺口 #6 补定，新记 #26 #27；引擎 266 条测试全绿；讲义 `docs/tutorial/08-funding-account-ops.md`；已 commit（`e8b3259`） |
| 第 09 讲 · 触发单与只减仓 | ✅ 2026-09-17 AI 实现 + 讲义：`triggers.ts`（入簿不冻结保证金；标记价推送查 MARK_PRICE 单、行情成交推送查 CONTRACT_PRICE 单；触发时转 MARKET / LIMIT 重走校验链，失败 REJECTED、GTX 会吃单 EXPIRED；closePosition 按当时全部仓位）；校验链第 14 步（触发价已穿过拒 `WOULD_IMMEDIATELY_TRIGGER`，条件单所有币对合计 200）；标记价推送先查触发再跑风控；缺口 #13 #15 定了，新记 #28 #29；引擎 284 条测试全绿；讲义 `docs/tutorial/09-trigger-orders.md`；已 commit（`4a2d32e`） |
| 第 10 讲 · 行情层 | ✅ 2026-09-17 AI 实现 + 讲义：`apps/server/src/market/`——两条连接（/public 盘口、/market 成交 + 标记价 + K 线，缺口 #22）、指数退避重连 + 10 秒看门狗、解析层（字符串直接 parse、格式不对抛错、数量取 nq）、行情源状态 connecting / ready / degraded + 按币对就绪（缺口 #16 行情层一半）、`market:watch` 验收脚本（实测 19 个币对 1 秒内 ready）；发现 TONUSDT 已下架结算（缺口 #30，开放名单要用户定）；server 44 条测试；讲义 `docs/tutorial/10-market-feed.md`；已 commit（`0c9cafb`） |
| 第 11 讲 · 仓储层与引擎宿主 | ✅ 2026-09-17 AI 实现 + 讲义：迁移 0003 / 0004（symbols 交易规则 10 列、positions 带符号 `position_amt`、`LIQUIDATION` 枚举）已应用到本地库并重跑 `seed:symbols`；开放名单去掉 TONUSDT（19 个）；`apps/server/src/persistence`（uuid v5 id 换算、仓位互转、加载、一个事务落库）+ `engine-host`（串行队列 + 回滚、行情门控、资金费由标记价推送驱动、启动恢复、分层表热加载）；引擎加 `setBrackets`；server 启动实测恢复 → 行情就绪 → 19 个币对开始撮合（本机 3000 端口被另一个 node 进程占用，HTTP 那一步没起来）；引擎 285、db 51、server 66 条测试全绿；讲义 `docs/tutorial/11-engine-host.md`；已 commit（`f670ba8`） |
| 第 12 讲 · 鉴权 | ✅ 2026-09-17 AI 实现 + 讲义：迁移 0005（14 张表）；开户 = 账户 + 身份 + INITIAL 流水一个事务（`engine-host/register-account.ts`）；`auth/` 钱包 SIWE / SIWS、邮箱验证码（Resend，开发环境打日志）、Google OAuth + PKCE、JWT；`http/respond.ts` 响应包络；缺口 #35～#38；server 87 条测试；讲义 `docs/tutorial/12-auth.md`；2026-09-17 用户用真实 Google 凭据和 Resend（`onboarding@resend.dev`）各登录成功；已 commit |
| 第 13a 讲 · REST 接口（上） | ✅ 2026-09-17 AI 实现 + 讲义：第 13 讲拆成 13a / 13b。13a：`http/`（数值边界只收字符串、最多 8 位小数；三档限流；游标分页）、引擎只读视图 `views.ts` + 宿主 `read()`、引擎输入 `cancelAllOrders`、`api/` 交易 3 + 仓位 4 + 账户 10 个接口、`app.ts` 组装；**修了两个 bug**：全仓强平价 cum 符号写反（缺口 #39，只影响展示）、宿主队列只剩同步任务时卡死；缺口 #12 #24 #26～#29 定了，新记 #39～#44；引擎 297、server 103 条测试；讲义 `docs/tutorial/13a-rest-trading-account.md`；已 commit |
| 第 13b 讲 · REST 接口（下） | ✅ 2026-09-17 AI 实现 + 讲义：`market/binance-rest.ts`（代理币安 K 线 / 历史资金费率 / 24 小时统计，缓存 + 限流退避 + 严格解析）、`market/market-state.ts`、`api/market.ts` 6 个接口、`api/leaderboard.ts`、`/account/equity-curve`、`jobs/equity-snapshot.ts` 每日 UTC 00:00 快照；排行榜口径用户定（缺口 #48：期初权益为分母、期内重置不上日榜周榜、胜率按平仓成交、错过快照不补、有成交才上榜）；缺口 #31 #34 #44 定了，新记 #45～#48；引擎 299、server 121 条测试；讲义 `docs/tutorial/13b-rest-market-leaderboard.md`；已 commit |
| 第 14 讲 · WebSocket 网关 | ✅ 2026-09-18 AI 实现 + 讲义：`ws/`（protocol / hub / publisher / server），公共频道 depth·trade·ticker·kline·market + 私有频道 account·position·order·fill·liquidation·funding，auth 后自动订私有、token 过期降级、30 秒心跳；交易内核加三个事件钩子；缺口 #49～#52；server 138 条测试；真 server 实测五个频道都在推；讲义 `docs/tutorial/14-websocket.md`；已 commit |
| 前端 `apps/web` · 第 1 阶段 地基 | ✅ 2026-09-19 AI 实现，已 commit：技术选型定稿（`05` 第 0 节：axios / TanStack Query 只管 REST / Zustand / partysocket / TradingView Charting Library v31 / Reown AppKit / Biome）；`lib/`（api、endpoints、types、format、ws-client、session）、四个 store、`providers/ws-bridge`（重连后 hydrate、切回前台 hydrate、私有推送分发）；全站暗色 token；所有路由骨架，模块用带编号的占位块；页面模块清单 `docs/design/08-frontend-pages.md`（给 Figma 用）；web 26 条测试；实测首页 19 个币对实时跳价、交易页盘口 / 成交 / 标记价推送到 store。K 线库放 `apps/web/public/charting_library/`，不进 git |
| 前端 · 首页 / 顶栏 / 登录弹窗 | 🟡 2026-09-19 AI 按 Figma 还原：顶栏（2:6 / 5:8055）、首页四个区块（2:2）、登录弹窗三个 tab（钱包只做样式，等 Reown Project ID）；邮箱验证码登录已实现，收码登录待用户验收。顺带：服务端加 `GET /market/tickers`（首页 1 个请求代替 19 个，修限流）、订币安 `@ticker` 流让 24h 统计实时（缺口 #47 解决，解析失败不影响撮合）；`packages/ui` Tabs 切换时旧面板立即隐藏。设计 `docs/superpowers/specs/2026-09-19-home-header-login-design.md`，计划 `docs/superpowers/plans/2026-09-19-home-header-login.md`；web 52、server 149 条测试；已 commit（邮箱收码登录待用户验收） |
| 前端 · 模块化推进 | 📖 2026-09-19 按功能拆成 M00～M13，见 `docs/frontend/README.md`（功能点、数据、规则、后端缺口、验收）。UI 由用户找设计师做，这份只管功能 |
| 前端 · M01～M08 交易页全链路 | ✅ 2026-09-20 一路做完并 commit：M01 应用外壳（顶栏 / 连接状态 / 行情降级横幅 / 强平弹窗 / Toast / 错误边界）、M02 币对与行情、M03 K 线图、M04 盘口与最新成交、M05 登录与会话、M06 账户设置三件套、M07 下单（预估接口 + 下单面板 + 确认弹窗 + 杠杆 / 保证金模式）、M08 仓位 / 委托 / 账户表格 + 止盈止损弹窗。后端顺带补了 `GET /account/symbol-config`、`POST /orders/preview`、`GET /market/tickers` |
| 行情层 S01～S03（计划外补讲） | ✅ 2026-09-20：S01 盘口从 20 档换成完整盘口（增量流 + REST 快照）；**S02 是 S01 上线当天被币安封 IP 的事故复盘**（限流闸门全进程唯一、盘口对齐两个 bug、日志失真）；S03 盘口精度（聚合挪到服务端、砍掉喂不起的精度、页面撑满屏幕）。讲义 `docs/tutorial/S01`～`S03`，**接着 S01 读 S02** |
| 前端 · M11 排行榜与权益曲线 | 🟡 2026-09-21 AI 实现：日 / 周 / 总榜 + 我的排名 + 权益曲线（7/30/90 天）+ 榜单口径说明；周期和天数写进 URL；**曲线缺的日子断开不插值、横坐标按日期算**（几何在 `_lib/curve.ts`，11 条测试）；未上榜不猜原因（接口没给字段）；图按 dataviz 规格画，全程 bigint。web 170 条测试；讲义 `docs/frontend/M11-leaderboard.md`；**未 commit**，右边两块待用户登录验收 |
| 前端 · M12 模拟规则页 | ✅ 2026-09-21 AI 实现：`/rules` 左目录右正文，四节（失真点 9 条 / 撮合与排队 / 保证金·强平·资金费 / 账户与重置）；内容按设计文档写，不按 Figma 文案（用户 2026-09-19 定）；费率和清算费率从 `GET /market/symbols` 现取不写死；锚点定义在 `lib/config/rule-anchors.ts`，**有测试盯着「每个锚点都有对应段落」**；界面四处 `?` 已接上。web 149 条测试；讲义 `docs/frontend/M12-rules-page.md`；**未 commit** |
| 前端 · M10 历史记录 | 🟡 2026-09-21 AI 实现：`/orders` 五个 tab（历史委托 / 成交 / 资金流水 / 资金费 / 强平）+ 币对与流水类型筛选 + 游标分页「加载更多」；tab 和筛选写进 URL；已下架币对按数值自己的小数位显示（不显示 `--`）；顺带接上强平弹窗的「查看详情」（**M01 至此全部完成**）、中文标签收到 `app/_shared/labels.ts` 一份。web 145 条测试；讲义 `docs/frontend/M10-history-page.md`；**未 commit，且需要用户登录后验收表里的真实数据** |
| 前端 · 第 2～6 阶段（旧说法，已被上面的模块表取代） | ⬜ 2 只读交易页（K 线 / 盘口 / 成交 / 行情条）→ 3 登录（邮箱、Google、钱包）→ 4 下单与账户（含补 `POST /orders/preview`）→ 5 历史 / 排行榜 / 规则 → 6 按 `05` 第 15 节验收。UI 等用户的 Figma 稿 |
| 前端 | 不出教程——`apps/web` 由 AI 直接实现 |
| 表结构 12 → 14 张（`identities` / `email_verification_codes`） | ✅ 2026-09-17 迁移 0005：`accounts` 删 `address` / `chain`，登录身份在 `identities`；集成测试改为插账户 + 身份两行 |

**拿不定的地方以币安为标准**，见第六节"决策规则"。

**动手写前端之前必看**：`docs/design/05-frontend-design.md`；接口形状看 `docs/tutorial/13a-rest-trading-account.md` / `13b-rest-market-leaderboard.md`，推送看 `14-websocket.md`。要点：数值全是字符串（前端不要用 `Number` 参与计算）；断线重连后必须重新 auth、重新 sub，并用 REST 全量覆盖本地状态（`04` 第 12 节）；强平价、可用余额一律用服务端返回的，不要前端自己算。缺口 #43（可用余额口径）仍待定；#47 已于 2026-09-19 解决（服务端订币安 `@ticker` 流，24h 统计随 WS ticker 推送）。

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

分支 `main`。books 练手链路已在 `ecf1016` 单独 commit；本项目代码按讲 / 按模块 commit，最近一次是 S03（盘口精度，`bd731d9`）。M10、M12 已 commit（`3cc63d9`、`941f5da`）；M11 已实现但**还没 commit**（用户说提交才提交）。

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

后端全部完成，**现在在做前端**。剩下的 4 个模块，按 `docs/frontend/README.md` 的建议顺序：

| 下一步 | 要做什么 | 前置 |
| --- | --- | --- |
| M08b 跟踪委托 | T-13 第三个 tab。**要先开第 15 讲**：引擎加跟踪委托 + 数据库迁移 + 接口，是剩下的活里最大的一块 | 第 15 讲 |
| M09 图上交易线 | K 线图上画开仓均价线 / 强平价线 / 挂单线，线上带平仓和撤单按钮 | 改单接口（可选） |
| M13 整体验收 | `05` 第 15 节清单 + Playwright E2E 主链路 + 故障演练 | 前面都做完 |

**还压在用户手上的三件事**（AI 做不了，需要用户本人）：

1. **邮箱收码登录验收**——本地 Resend 是测试发件地址，只能发给账户本人
2. **钱包登录**——等用户申请 Reown Project ID，拿到后一次做完（2026-09-20 用户定）
3. **登录后验收 M07 / M10 / M11 / M12**——真下单、改杠杆、可开最大、预估强平价，历史记录五个 tab 的真实数据和翻页，规则页里需要登录才看得到的两个 `?`，以及排行榜的「我的排名」和权益曲线

下面这节是 M0 地基的历史记录，留着方便对照。

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
| 前端 UI 设计稿 | 用户说交给 Figma 做，尚未产出。设计输入（页面、模块编号、状态）见 `docs/design/08-frontend-pages.md` |
| 域名与 TLS | 未开始（浏览器 WSS 要求 https 来源） |
| 数据库跟进第 04、07 讲 | ✅ 2026-09-17 第 11 讲完成（用户授权 AI 写并应用到本地库）：迁移 0003 / 0004、`seed:symbols` 新列 |
