# 交易页 · 组件拆分设计

> 日期：2026-09-19
> 覆盖模块：M02（T-01 / T-02）、M03（T-03）、M04（T-04 / T-05）、M07（T-06 / T-09 / T-10）、M08（T-07 / T-08 / T-11～T-14）、M09（图上交易线）、跟踪委托（新增，见第六节）
> 页面编号见 `docs/design/08-frontend-pages.md`，功能清单见 `docs/frontend/README.md`，目录规范见 `docs/frontend/directory-structure.md`
> 样式还原的做法同 `2026-09-19-home-header-login-design.md`「样式还原的做法」一节

---

## 设计稿

fileKey：`tEjxTvnW0drLCL1w4ygMgo`

| 部分 | 节点 | 组件 |
| --- | --- | --- |
| 交易页整页 | `4:4601`（页面主体 `4:4646`） | `trade-view.tsx` 网格 |
| 币对栏（T-01 + T-02） | `4:4647`（切换按钮 `4:4649`） | `symbol-bar/*` |
| K 线区 | `4:4713`（工具栏 `4:4714`） | `chart/*` |
| 盘口 | `4:5076` | `order-book/*` |
| 最新成交 | `4:5408` | `recent-trades/*` |
| 仓位 / 委托表格区 | `4:5604`（tab 栏 `4:5605`） | `records/*` |
| 下单面板 | `4:5718`（杠杆 / 保证金 / 持仓模式 `4:5719`） | `order-panel/*` |
| 账户面板 | `4:5824` | `account-panel/*` |
| 止盈/止损弹窗 · 止盈/止损 tab | `4:369` | `dialogs/position-tpsl/tpsl-orders-tab.tsx` |
| 止盈/止损弹窗 · 仓位止盈止损 tab | `4:1812` | `dialogs/position-tpsl/position-tpsl-tab.tsx` |
| 止盈/止损弹窗 · 跟踪委托 tab | `4:3213` | `dialogs/position-tpsl/trailing-tab.tsx` |

布局：稿子是 1282 宽，列宽 `1fr · 320px · 360px`，和 `08` 定的一致；按 1280 验证最窄布局。

---

## 一、已定的事（2026-09-19 用户定）

| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 跟踪委托 | **做**。引擎、迁移、接口单独一讲（第 15 讲，AI 写代码 + 讲义），见第六节 |
| 2 | 排行榜「每 30 分钟更新一次 · 基于账户权益净值排名」 | 改文案：「数据截至 {日期}（每日 UTC 00:00 快照）」，后端不动 |
| 3 | 规则页文案 | 只用设计稿样式，内容按设计文档重写（含 R-02 失真点 #1～#9） |
| 4 | 交易页组件拆分 | 按本文档 |

## 二、和设计稿不一样的地方

分两类：**按功能补**（稿子没画，但 `docs/frontend/README.md` 要求有）和**按规则改**（照稿子做会违反项目规则）。其余一律以设计稿为准。

| # | 位置 | 设计稿 | 实现 | 类型 |
| --- | --- | --- | --- | --- |
| 1 | 下单面板 | 没有可用余额 | 方向切换下面加「可用 xx USDT」（服务端下发） | 补 |
| 2 | 下单面板 | 没有只减仓、生效时间 | 「止盈/止损」折叠项旁边加「只减仓」勾选 + TIF 下拉（仅限价） | 补 |
| 3 | 下单面板 | 预估区只有名义价值 / 保证金 / 手续费 | 加「可开最大」「预估强平价」（后者等 `POST /orders/preview`，没有时 `--`） | 补 |
| 4 | 下单面板 | 没有开仓 / 平仓切换 | 仅双向持仓模式下出现，在方向切换上方 | 补 |
| 5 | 下单面板 | 条件委托 tab 内容没画 | 触发价 + 触发依据（最新 / 标记）+ 执行方式（限价 / 市价），其余同限价 | 补 |
| 6 | 账户面板 | 没有可用余额；「重置」直接一个按钮 | 加「可用余额」行；「重置」打开 G-08 确认弹窗 | 补 |
| 7 | 盘口中间行 | 最新价 + `≈$80715.0` | 最新价 + 标记价（`08` T-04；USDT 本位再写一遍美元价没有信息量） | 改 |
| 8 | 盘口 | 没有视图切换、精度切换 | 表头右侧加（`08` T-04） | 补 |
| 9 | 仓位表「损益两平」「保证金比率」 | — | 服务端补字段（第五节 B3）；没补之前显示 `--` | 改（不在前端算） |
| 10 | 仓位表「预估资金费」 | — | 前端算：`notional × fundingRate`，用 bigint 走 `packages/shared`；只依赖行情，不依赖账户全局状态 | — |
| 11 | 表格区 tab | 持仓 · 当前委托 · 历史委托 · 历史成交 | 同稿子；右侧加「只看当前币对」 | 补 |
| 12 | 止盈/止损 tab「修改」 | 直接改 | 没有改单接口：撤单再下单；弹窗里提示「修改会先撤销原单再重新下单，中间有极短时间没有保护」 | 改 |
| 13 | 止盈/止损 tab「添加」 | 表单没画 | 同条件委托的输入项，数量带百分比快捷 | 补 |
| 14 | K 线工具栏 | 自定义：1m 5m 15m 1h 4h 1d + MA(7/25/99) | 同稿子：隐藏 TradingView 自带的 header，用库的 API 切周期、开关均线 | — |
| 15 | 三个弹窗的标记价示例值 | 80371.60 / 80830.70 / 80895.30 | 实时标记价（示例数据不一致，只提醒设计师） | — |

还没画、先用基础样式做的：调杠杆（T-09）、保证金模式（T-10）、持仓模式（G-07）、逐仓保证金（T-11）、平仓确认 / 限价平仓（T-12）、全部撤单确认（T-14）、重置确认（G-08）、币对切换下拉、未登录 / 行情降级 / 加载中 / 空状态。

---

## 三、组件树

```
app/trade/
├─ [symbol]/page.tsx                  服务端组件：读参数、标题、渲染 TradeView
├─ _ui-components/
│  ├─ trade-view.tsx                  币对校验（T-00）+ 网格布局 + useSymbolMarket(symbol)
│  │
│  ├─ symbol-bar/                     T-01 / T-02 · M02
│  │  ├─ symbol-bar.tsx                 一行容器
│  │  ├─ symbol-switcher.tsx            「BTC/USDT 永续 ▼」+ 下拉（搜索、列表带最新价和涨跌），切换用 router.push
│  │  ├─ last-price.tsx                 大号最新价（和上一笔比较着色）+ 24h 涨跌额 / 幅
│  │  └─ ticker-stats.tsx               标记价 · 指数价 · 资金费率 / 倒计时 · 24h 高 / 低 / 量
│  │
│  ├─ chart/                          T-03 · M03，M09
│  │  ├─ chart-panel.tsx                工具栏 + 图表容器
│  │  ├─ chart-toolbar.tsx              周期按钮 + MA 开关
│  │  ├─ tv-chart.tsx                   只在客户端加载；创建 / 销毁 widget；换币对调 setSymbol；库缺失时提示
│  │  └─ trade-lines.tsx                M09：仓位线 / 强平线 / 挂单线 / 触发线（不渲染 DOM，只调图表 API）
│  │
│  ├─ order-book/                     T-04 · M04
│  │  ├─ order-book.tsx                 标题 + 表头（视图 / 精度切换）+ 卖盘 + 中间行 + 买盘
│  │  ├─ book-side.tsx                  一侧 20 档
│  │  ├─ book-row.tsx                   memo，key = 价格；累计量背景条用 CSS 变量
│  │  └─ book-mid.tsx                   最新价 + 标记价
│  │
│  ├─ recent-trades/                  T-05 · M04
│  │  └─ recent-trades.tsx              最近 50 条
│  │
│  ├─ order-panel/                    T-06 · M07
│  │  ├─ order-panel.tsx                组装；未登录 / 降级时的整体状态
│  │  ├─ order-type-tabs.tsx            限价 · 市价 · 条件委托
│  │  ├─ config-bar.tsx                 杠杆 · 保证金模式 · 持仓模式 三个按钮 → 各自弹窗
│  │  ├─ side-switch.tsx                买入/做多 | 卖出/做空（双向时上方多一个 开仓 | 平仓）
│  │  ├─ trigger-field.tsx              条件委托：触发价 + 触发依据
│  │  ├─ price-field.tsx                限价：价格，失焦吸附 tickSize，「最新」快捷
│  │  ├─ qty-field.tsx                  数量，单位 币 / USDT
│  │  ├─ order-options.tsx              只减仓 · TIF · 止盈/止损折叠
│  │  ├─ order-estimate.tsx             名义价值 · 预估保证金 · 预估手续费 · 可开最大 · 预估强平价
│  │  └─ submit-button.tsx              五种状态（08 T-06）
│  │
│  ├─ records/                        T-07 · M08
│  │  ├─ records-panel.tsx              tab（持仓 (n) · 当前委托 (n) · 历史委托 · 历史成交）+「只看当前币对」
│  │  ├─ positions-table.tsx            仓位表；操作：平仓（T-12）· 止盈/损（T-13）；逐仓保证金铅笔（T-11）
│  │  ├─ open-orders-table.tsx          当前委托；前方排队列；撤单；全部撤单（T-14）
│  │  └─ recent-history.tsx             历史委托 / 历史成交最近 20 条 +「查看全部」→ /orders（列定义复用 _shared）
│  │
│  ├─ account-panel/                  T-08 · M08
│  │  └─ account-panel.tsx              钱包余额 · 保证金余额 · 可用余额 · 未实现盈亏 · 维持保证金 · 委托冻结 · 保证金比率；「重置」→ G-08
│  │
│  └─ dialogs/                        只有交易页用的弹窗
│     ├─ leverage-dialog.tsx            T-09
│     ├─ margin-mode-dialog.tsx         T-10
│     ├─ isolated-margin-dialog.tsx     T-11
│     ├─ close-position-dialog.tsx      T-12（市价确认 / 限价平仓）
│     ├─ cancel-all-dialog.tsx          T-14
│     └─ position-tpsl/                 T-13，一个弹窗三个 tab
│        ├─ position-tpsl-dialog.tsx      头部（合约 · 开仓价 · 标记价 · 强平价）+ 风险提示 + tab
│        ├─ tpsl-orders-tab.tsx           部分止盈止损单列表；排序、全部取消、添加、修改、取消
│        ├─ tpsl-order-form.tsx           添加 / 修改的表单
│        ├─ position-tpsl-tab.tsx         仓位止盈止损（closePosition），按价格或按盈亏输入
│        └─ trailing-tab.tsx              跟踪委托：回调幅度、数量、激活价
│
├─ _lib/                              交易页私有的纯函数，全部带 .test.ts
│  ├─ aggregate-book.ts                 盘口精度聚合（买向下、卖向上取整合并）+ 累计量
│  ├─ order-validate.ts                 tickSize / stepSize / minQty / minNotional / percentPrice 即时校验
│  ├─ order-estimate.ts                 成本、手续费、可开最大（受分层 notionalCap 限制）
│  ├─ order-body.ts                     表单 → PlaceOrderBody（side / positionSide 按 M07 那张表）
│  ├─ tpsl-math.ts                      盈亏 ↔ 触发价换算、预估盈亏
│  └─ tv-datafeed.ts                    TradingView Datafeed 适配器（依赖 server-api-module，所以不放 src/lib）
│
└─ _stores/
   └─ order-form-store.ts             下单表单状态（从 ui-store 的 orderDraft 挪过来，见第四节）
```

### 放到 `app/_shared/` 的

| 组件 | 原因 |
| --- | --- |
| `position-mode-dialog.tsx`（G-07） | 账户菜单和下单面板都会打开 |
| `reset-account-dialog.tsx`（G-08） | 账户菜单和账户面板都会打开 |
| `order-columns.tsx` / `fill-columns.tsx` | 交易页「历史委托 / 历史成交」和 `/orders` 共用列定义 |
| `login-gate.tsx` | 未登录占位（「登录后查看」+ 按钮），交易页、订单页都用 |

### 放到 `components/` 的（通用，不认识业务）

`number-field.tsx`（带单位后缀、步进、错误 / 警告态）· `percent-slider.tsx`（0/25/50/75/100 刻度）· `countdown.tsx` · `data-table.tsx`（表头、空状态、骨架、加载更多）· `stat-item.tsx`（小标题 + 数值）· `confirm-dialog.tsx`（普通 / 危险）。已有的 `direction-text.tsx`、`segmented-tabs.tsx` 直接用。

---

## 四、状态放哪

| 状态 | 位置 | 原因 |
| --- | --- | --- |
| 当前币对 | 路由 `/trade/[symbol]` | 刷新、分享能保住 |
| 盘口、成交、ticker | `market-store`（已有） | WS 推送写入，多组件读 |
| 账户、仓位、当前委托 | `account-store`（已有） | 同上 |
| K 线周期、盘口精度 | `ui-store`（已有） | 跨刷新记住 |
| 下单表单（类型、方向、开平、价格、触发价、数量、单位、选项） | **新建** `app/trade/_stores/order-form-store.ts` | 盘口点击要填价格 / 数量，K 线平仓线要预填；只有交易页用，按目录规范第 5.3 节放模块内。把 `ui-store` 的 `orderDraft` / `fillPrice` / `fillQty` 挪过来 |
| 当前币对的杠杆和保证金模式 | React Query `GET /account/symbol-config`（B1） | 没有仓位时也要知道 |
| 预估强平价 | React Query `POST /orders/preview`（B2），输入停 300ms 后请求 | 服务端算，前端不算 |
| 历史委托 / 成交（最近 20 条） | React Query（M00 已接好失效） | — |
| 弹窗开关 | 各自组件内部 `useState` | 不跨组件 |

---

## 五、后端要补的

| # | 内容 | 用在 | 做在 |
| --- | --- | --- | --- |
| B1 | `GET /account/symbol-config?symbol=`：当前杠杆、保证金模式（对应币安 `GET /fapi/v1/symbolConfig`） | 下单面板 config-bar | M07 开工前 |
| B2 | `POST /orders/preview`：预估强平价、可开最大 | order-estimate | M07 |
| B3 | 仓位加 `breakEvenPrice`（损益两平）、保证金比率。字段口径先查币安 `positionRisk` / 网页版，不凭记忆 | positions-table | M08 开工前 |
| B4 | 跟踪委托 `TRAILING_STOP_MARKET` | trailing-tab | 第 15 讲，见第六节 |

---

## 六、跟踪委托（第 15 讲）

放在 M08 之后、M09 之前。按「引擎 + 服务端由 AI 写代码 + 讲义」的方式做，讲义 `docs/tutorial/15-trailing-stop.md`。

要查清楚再写的（查找顺序按 `CLAUDE.md`，查完补进 `07-binance-reference.md`）：

- 参数：`activationPrice`（不填时默认用最新价，支持 `workingType`）、`callbackRate` 的取值范围和精度
- 跟踪逻辑：激活前后分别怎么追最高 / 最低价、按哪个价格触发、触发后转市价走校验链
- 币安已经把条件单迁到 Algo Order 接口（本地副本里有 `NewAlgoOrder`），要确认这对我们的订单模型有没有影响
- 条件单总数上限（缺口 #28 那条 200）是否包含跟踪委托

涉及：`packages/shared` 枚举 → 引擎（入簿、每次行情更新时更新极值、触发）→ 迁移（`orders` 加 `activation_price` / `callback_rate` / 当前极值）→ 下单接口放开参数 → 序列化 → 前端类型。缺口 #28 改成「`TRAILING_STOP_MARKET` 已支持」。

---

## 七、实现顺序

每一步做完都要停下来让用户验收，说「继续」再往下做。

1. **M02 收尾**：`symbol-bar/*`、`countdown`、页面标题跟着最新价变
2. **M04**：`order-book/*`、`recent-trades`、`aggregate-book.ts`；建 `order-form-store`，盘口点击填价
3. **M03**：`chart/*`、`tv-datafeed.ts`，自定义工具栏
4. **B1 + B2 → M07**：`order-panel/*`、T-09 / T-10 / G-07、`order-validate` / `order-estimate` / `order-body`
5. **B3 → M08**：`records/*`、`account-panel`、T-11 / T-12 / T-14 / G-08、止盈止损弹窗前两个 tab
6. **第 15 讲 → 跟踪委托 tab**
7. **M09**：`trade-lines.tsx`

## 八、验收

各模块验收项见 `docs/frontend/README.md`。交易页整体额外看：

- 1280 宽不出横向滚动条
- 未登录：行情区正常，下单面板只有「登录」按钮，表格区和账户面板显示 `login-gate`
- 行情降级：所有提交、平仓、止盈止损确认按钮禁用
- 切换币对：不刷新页面，K 线不重建，旧币对的推送退订
