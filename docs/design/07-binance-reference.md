# 07 · 币安标准参考

> 项目的决策规则（`HANDOFF.md` 第六节）：**设计文档没说清、拿不准的地方，以币安官方做法为标准；实现不了的问用户。**
> 这份文档把已经核对过的币安规则集中记下来，写明出处和核对日期，方便查阅、开发时对照。
>
> 只记**我们用到、而且核对过**的规则。没核对过的不写进来，免得把记忆当事实。每条都注明核对日期——币安会改规则，引用前如果日期很久了，重新核对一次。

---

## 0. 怎么查币安文档

**先查本地副本**：`pnpm run docs:binance` 会拉到 `docs/vendor/binance/`（不进 git）：`usds-futures.txt`（U 本位合约的错误码、更新日志、WebSocket 等）和 `rest-api/*.md`（REST 接口参数说明，来自币安官方 Go SDK）。参数**默认值**和接口下方的**备注**本地没有，还得看网页版。详见 `docs/vendor/binance/README.md`。

| 要查什么 | 去哪里 | 注意 |
| --- | --- | --- |
| 接口参数、错误码 | `https://developers.binance.com/docs/derivatives/usds-margined-futures/` | 动态页面，`curl` / WebFetch 拿不到正文，用浏览器打开 |
| 全部开发文档的纯文本版 | `https://developers.binance.com/en/docs/llms-full.txt`（本地：`docs/vendor/binance/`） | 约 8 MB，包含现货、合约、钱包等所有产品线，但**不含 REST 接口参数说明**。搜错误码用拆出来的 `usds-futures.txt`，现货同编号的错误码意思不同 |
| 币对的实时交易规则 | `GET https://fapi.binance.com/fapi/v1/exchangeInfo` | 公开接口，不需要 Key，本机能直连 |
| 公式类说明（开仓成本、强平价、资金费） | `https://www.binance.com/en/support/faq/...` | 动态页面，用浏览器打开 |

---

## 1. 持仓表示（positionRisk）

**出处**：Position Information V2 / V3（`GET /fapi/v2/positionRisk`、`/fapi/v3/positionRisk`）｜核对：2026-09-17

| 字段 | 规则 |
| --- | --- |
| `positionSide` | 单向持仓模式为 `BOTH`；双向持仓模式为 `LONG` / `SHORT` |
| `positionAmt` | 带符号：多头为正、空头为负（字段说明原文 "positive for long, negative for short"） |

**我们怎么用**：数据库按这个表示法存（缺口 #12，第 11 讲迁移）；引擎内部用 `LONG` / `SHORT` + 非负数量，仓储层互转。

---

## 2. 下单参数

**出处**：New Order（`POST /fapi/v1/order`）、New Algo Order（`POST /fapi/v1/algoOrder`）｜核对：2026-09-17

> 币安现在把止损 / 止盈这类条件单放到单独的 Algo Order 接口（普通下单接口传条件单会报 `-4120`）。我们对外仍然是一个下单接口，规则按两个接口合起来看。

| 参数 | 币安规则 | 我们的实现 |
| --- | --- | --- |
| `positionSide` | 单向模式默认 `BOTH`；双向模式必须传 `LONG` / `SHORT` | 校验链第 4 步 |
| `reduceOnly` | **双向模式不能传**；不能和 `closePosition=true` 同时传 | 第 3 步，传 `false` 也拒 |
| `closePosition` | 只配 `STOP_MARKET` / `TAKE_PROFIT_MARKET`；不能带 `quantity`；双向模式下不能用在开仓方向（`BUY + LONG`、`SELL + SHORT`） | 第 3 步 |
| `timeInForce` | `LIMIT` 必填；`STOP` / `TAKE_PROFIT` 可传，默认 `GTC` | 第 3 步；限价类默认 `GTC` |
| `workingType` | 条件单可选 `MARK_PRICE` / `CONTRACT_PRICE`，**默认 `CONTRACT_PRICE`** | 默认 `CONTRACT_PRICE`（2026-09-17 改） |
| 多传不需要的参数 | 报 `-1106 PARAM_NOT_REQUIRED` | 第 3 步统一报 `INVALID_PARAMS` |

**条件单触发条件**（Algo Order 接口说明，第 09 讲用）：

| 类型 | 买单触发 | 卖单触发 |
| --- | --- | --- |
| `STOP` / `STOP_MARKET` | 价格 ≥ 触发价 | 价格 ≤ 触发价 |
| `TAKE_PROFIT` / `TAKE_PROFIT_MARKET` | 价格 ≤ 触发价 | 价格 ≥ 触发价 |

"价格"是标记价还是最新成交价，由 `workingType` 决定。下单时就已满足触发条件的，币安拒单（`-2021` / `-4142`，缺口 #15）。

---

## 3. 交易规则（exchangeInfo 的 filters）

**出处**：`GET /fapi/v1/exchangeInfo` 实时数据 + U 本位合约错误码表｜核对：2026-09-17

| filter | 字段 | BTCUSDT 当时的值 | 含义 | 校验链 |
| --- | --- | --- | --- | --- |
| `PRICE_FILTER` | `minPrice` / `maxPrice` / `tickSize` | 556.80 / 4529764 / 0.10 | 委托价、触发价的范围和最小变动 | 第 5 步 |
| `LOT_SIZE` | `minQty` / `maxQty` / `stepSize` | 0.001 / 1000 / 0.001 | 限价类订单数量 | 第 5 步 |
| `MARKET_LOT_SIZE` | `minQty` / `maxQty` / `stepSize` | 0.001 / **120** / 0.001 | 市价单数量（代替 `LOT_SIZE`） | 第 5 步 |
| `MIN_NOTIONAL` | `notional` | 50 | 最小名义价值，只减仓单不受限 | 第 6 步 |
| `PERCENT_PRICE` | `multiplierUp` / `multiplierDown` | 1.0500 / 0.9500 | 价格必须在 [标记价 × down, 标记价 × up] 内，按币对配置 | 第 7 步 |
| `MAX_NUM_ORDERS` | `limit` | 200 | 每个账户在**每个币对**上的挂单数上限 | 第 13 步 |

币对级别的其它字段：`triggerProtect`（BTCUSDT 0.0500，条件单 `priceProtect` 用，第 09 讲再核对）。

**我们怎么用**：引擎 `SymbolSpec` 已按这些字段实现；`symbols` 表加列和 `seed:symbols` 同步由用户写（字段对照见 `docs/tutorial/04-order-validation.md` 第 7 节）。

---

## 4. 错误码对照

**出处**：U 本位合约错误码（`/products/derivatives-trading-usds-futures/error-code`）｜核对：2026-09-17

| 币安错误码 | 币安含义 | 我们的错误码 | 校验链 |
| --- | --- | --- | --- |
| `-1106` PARAM_NOT_REQUIRED | 传了不需要的参数 | `INVALID_PARAMS` | 3 |
| `-4061` POSITION_SIDE_NOT_MATCH | positionSide 和持仓模式不符 | `POSITION_SIDE_MISMATCH` | 4 |
| `-4013` / `-4002` | 价格低于最小价 / 高于最大价 | `PRICE_FILTER` | 5 |
| `-4007` | 触发价高于最大价 | `PRICE_FILTER` | 5 |
| `-4014` | 价格没对齐 tickSize | `PRICE_FILTER` | 5 |
| `-4004` / `-4005` | 数量低于最小 / 高于最大 | `LOT_SIZE` | 5 |
| `-4023` | 数量没对齐 stepSize | `LOT_SIZE` | 5 |
| `-4164` MIN_NOTIONAL | 名义价值低于门槛（只减仓除外） | `MIN_NOTIONAL` | 6 |
| `-4016` / `-4024` | 价格高于标记价上限 / 低于下限 | `PERCENT_PRICE` | 7 |
| `-4131` MARKET_ORDER_REJECT | 市价单对手方最优价不满足 PERCENT_PRICE | `PERCENT_PRICE` | 7 |
| `-2022` REDUCE_ONLY_REJECT | 只减仓单被拒 | `REDUCE_ONLY_REJECTED` | 8 |
| `-2027` MAX_LEVERAGE_RATIO | 当前杠杆下超过允许的最大持仓 | `LEVERAGE_TOO_HIGH` | 9 |
| `-2019` MARGIN_NOT_SUFFICIEN | 保证金不足 | `INSUFFICIENT_MARGIN` | 10 |
| `-5022` GTX_ORDER_REJECT | 只做 Maker 的单会立刻成交，拒单 | `POST_ONLY_REJECTED` | 12 |
| `-2025` MAX_OPEN_ORDER_EXCEEDED | 挂单数达到上限 | `TOO_MANY_ORDERS` | 13 |
| `-2021` / `-4142` | 条件单会立刻触发 | `WOULD_IMMEDIATELY_TRIGGER` | 14 |
| `-4045` MAX_STOP_ORDER_EXCEEDED | 条件单数达到上限（所有币对合计 200） | `TOO_MANY_ORDERS` | 14 |

> 更正记录：设计文档原来说"币安跨层时自动降杠杆，我们改成拒单"。核对错误码表后发现币安下单时同样拒单（`-2027`），设计文档各处已加更正。

---

## 5. 开仓成本（下单保证金）

**出处**：币安 FAQ "How to Calculate the Cost Required to Open a Position in Perpetual Futures Contracts"｜核对：2026-09-17

```
开仓成本 = 起始保证金（按假设价格） + 开仓亏损

假设价格：限价 / 条件多单 = 委托价
         限价 / 条件空单 = max(委托价, 标记价, 最新价 × 1.0015)
         市价单 = 最新价 × 1.0015
开仓亏损 = 数量 × |min(0, 方向 × (标记价 − 委托价))|     方向：多 = 1，空 = −1
```

**我们怎么用**（第 05 讲）：`validate-order.ts` 的 `limitOpenCost` / `marketOpenCost`。和币安的两处不同见第 6 节。

---

## 6. 我们和币安刻意不同的地方

按决策规则，这些都是"实现不了"或者已经定下来的，**改回币安做法之前先问用户**。

| 地方 | 币安 | 我们 | 为什么 |
| --- | --- | --- | --- |
| 市价单开仓成本的价格 | 最新价 × 1.0015 估算 | 逐档用真实成交价 | 撮合在同一次 `apply` 里完成，已知道真实成交价，不需要估 |
| 开仓成本里的手续费 | 不含 | 额外按 Taker 费率预留 | 设计文档 4.3 节的刻意保守，成交时不会余额不够 |
| 市价单吃不够深度 | 真实盘口会一直吃下去 | 超过可见 20 档深度的 50% 就拒单 | 只看得到 20 档，宁可拒单也不编价格（失真点 #4） |
| 模拟单对流动性的影响 | 真实成交会消耗盘口 | 不消耗，多个用户可吃同一档 | 失真点 #1、#2 |
| 挂单冻结保证金 | 单向模式买卖挂单净额冻结 | 逐单冻结 | 设计文档 4.3 节，方向保守 |
| 行情断线 | 交易所不会断 | 暂停撮合、恢复后不补算 | 失真点 #7 |
| 市价 / IOC / FOK 是否占挂单数上限 | 文档没写 | 不占 | 挂满了也要能平仓；是我们的判断 |
| 只减仓单是否扣掉其它挂单数量 | 文档没写清（`-2022`） | 下单时只和当前仓位比，成交时截断到剩余仓位 | 用户 2026-09-17 定（缺口 #18） |
| 强平成交价 | 限价破产价的 IOC 单打进真实市场，会消耗流动性 | 逐档吃可见 20 档（不消耗盘口），吃不完按破产价 | 失真点 #2、#4；用户 2026-09-17 定 |
| 部分强平 | Smart Liquidation，保证金够了就停 | 整仓一次平掉 | IOC 单大小文档没写，不编；用户 2026-09-17 定 |
| 盘口深度 | 增量流 `<symbol>@depth@100ms` + REST 快照（`GET /fapi/v1/depth`，limit 5/10/20/50 权重 2、100 权重 5、500 权重 10、1000 权重 20）维护本地盘口；规则见《How to manage a local order book correctly》：丢 `u < lastUpdateId`、首条要 `U <= lastUpdateId <= u`、之后 `pu` 接上一条的 `u`、数量为 0 删档 | 我们取 500 档快照、保留 200 档（2026-09-20 核对并实现，S01） |
| 挂单什么时候成交 | 真实订单簿按价格时间优先撮合 | 用行情成交流推算排队位置（撤单假设在我后面 + 盘口总量夹逼） | 看不到币安队列内部（失真点 #3），设计文档 5.5 节；第 06 讲 |

---

## 7. 行情推送（WebSocket 市场流）

**出处**：U 本位合约更新日志（2025-11-18 RPI 订单、2025-12-29 `nq` 字段）、"Important WebSocket Change Notice"（本地 `usds-futures.txt`）+ 2026-09-17 连 BTCUSDT 实时推送抓包｜核对：2026-09-17

**连接地址**：币安把合约 WebSocket 拆成三个入口，旧的 `wss://fstream.binance.com/ws`、`/stream` 在 2026-04-23 之后**只推 `/public` 那一类数据**（实测：旧地址收得到 depth，收不到 aggTrade）。

| 入口 | 我们要订阅的流 |
| --- | --- |
| `wss://fstream.binance.com/public/stream?streams=` | `<symbol>@depth20@100ms` |
| `wss://fstream.binance.com/market/stream?streams=` | `<symbol>@aggTrade`、`<symbol>@markPrice@1s`、`<symbol>@kline_<interval>`、`<symbol>@ticker`（2026-09-19 加） |

**连接规则**（本地 `usds-futures.txt` 的 websocket-market-streams/Connect，核对 2026-09-17）：

| 规则 | 我们怎么处理（第 10 讲 `apps/server/src/market/connection.ts`） |
| --- | --- |
| 一条连接最多有效 24 小时，到点断开 | 当普通断线处理，1 秒后重连 |
| 服务器每 3 分钟发 ping 帧，10 分钟内没收到 pong 就断开 | Node 自带 WebSocket（undici）自动回 pong |
| 每秒最多收客户端 10 条消息，超了断开、反复超可能封 IP | 只在 URL 里订阅，不发 SUBSCRIBE 消息 |
| 一条连接最多 1024 个流 | 20 个币对：/public 20 个、/market 60 个 |
| 组合流推送包成 `{"stream","data"}`，流名里币对小写 | 同左 |

**币对状态**：只有 exchangeInfo 里 `status = TRADING` 的币对有盘口和成交。2026-09-17 发现 **TONUSDT 已是 `SETTLING`**（下架结算中，`GET /fapi/v1/depth` 返回空盘口，`deliveryDate` 1782205200000 = 2026-06-23），但还在我们的开放名单 `OPEN_SYMBOLS` 里（缺口 #30）。

**其它推送字段**（2026-09-17 实测，样例在 `apps/server/src/market/__fixtures__/binance-streams-2026-09-17.jsonl`）：

| 流 | 我们用的字段 |
| --- | --- |
| `@depth20@100ms`（事件 `depthUpdate`） | `s`、`T` 撮合时间、`b` / `a` 各 20 档 `[价格, 数量]` 字符串，买盘降序、卖盘升序 |
| `@markPrice@1s`（事件 `markPriceUpdate`） | `s`、`E` 事件时间、`p` 标记价、`r` 资金费率（可为负）、`T` 下次资金费结算时间；另有 `i` 指数价、`P` 预估结算价、`ap` 不用 |
| `@kline_1m`（事件 `kline`） | `k.t` / `k.T` 开收盘时间、`k.o/h/l/c/v`、`k.x` 是否收盘 |
| `@ticker`（事件 `24hrTicker`，2026-09-19 实测，样例 `binance-ticker-2026-09-19.jsonl`） | 24 小时**滚动**统计（不是 UTC 自然日）：`p` 涨跌额、`P` 涨跌幅（百分数，可负）、`o/h/l/c`、`v` 成交量、`q` 成交额、`O` / `C` 统计窗口、`n` 笔数、`E` 事件时间；`w` `Q` `F` `L` `ps` `st` 不用。本地 `llms-full.txt` 里的 `@ticker` 样例是现货 / Alpha 的，字段不同，以实测为准 |

**`@aggTrade` 实测推送**：

```json
{"e":"aggTrade","E":1789611046969,"a":3453526450,"s":"BTCUSDT","p":"76132.50","q":"0.060","nq":"0.060","f":8087728613,"l":8087728629,"T":1789611046819,"m":true,"st":1}
```

| 字段 | 含义 | 引擎输入 `trade` |
| --- | --- | --- |
| `a` | 归集成交 id | `tradeId`：拼 Maker 成交 id `订单id:t<a>` |
| `p` | 成交价 | `price` |
| `q` | 成交量（含 RPI 订单） | 不用 |
| `nq` | 只含普通订单的成交量（2025-12-31 起） | **`qty`** |
| `m` | 买方是否是 Maker | `buyerIsMaker` |
| `T` | 成交时间 | `ts` |

**RPI 订单**：只挂单、只和 App / 网页端订单撮合，**不出现在** `@depth<levels>` / `@depth` / bookTicker 里（有单独的 `@rpiDepth@500ms`）。我们的排队位置从 depth 流读，所以消耗它必须用同口径的 `nq`；用 `q` 会让队列前进得比真实快。

**`@depth20@100ms` 实测推送**（节选，`b` / `a` 各 20 档，`[价格, 数量]`）：`{"e":"depthUpdate","T":…,"s":"BTCUSDT","b":[["76119.90","1.089"],…],"a":[["76120.00","9.428"],…]}`。是快照不是增量，只含非空价位。

---

## 8. 强平

**出处**：币安 FAQ "Binance Futures Liquidation Protocols"（2026-01-04 更新）、"What Is Auto-Deleveraging (ADL) and How Does It Work?"（2026-01-13 更新）、"What Fees are Generated in Binance Futures Trading?"（2026-01-05 更新）、"How to Calculate Liquidation Price of USDⓈ-M Futures Contracts"、`GET /fapi/v1/exchangeInfo` 实时数据、U 本位合约公共定义（订单类型、到期原因）｜核对：2026-09-17

| 规则 | 币安 | 我们（第 07 讲） |
| --- | --- | --- |
| 触发 | 保证金余额 < 维持保证金；保证金率达到 100%；标记价触及强平价 | 权益 ≤ 维持保证金（恰好相等也强平，对应"触及"） |
| 全仓的钱包口径 | `crossWalletBalance`（不含逐仓保证金）+ `crossUnPnl` | 钱包 − Σ 逐仓保证金 + Σ 全仓未实现盈亏 |
| 撤单 | 全仓：所有币对的挂单；逐仓：同一币对的挂单 | 同左，状态 `EXPIRED`（到期原因 5） |
| 强平单 | 订单类型 `LIQUIDATION`，`clientOrderId` 以 `autoclose-` 开头；限价 = 破产价的 IOC 单 | 同左 |
| 破产价 | "the price at which the margin balance of the liquidated user is equal to zero"；强平单按它作限价 | 多：开仓价 − 可用资产 ÷ 数量；空：开仓价 + 可用资产 ÷ 数量 |
| 吃不完的部分 | 破产仓位，保险基金按破产价接管；保险基金不够再 ADL | 按破产价平掉（没有保险基金和 ADL，失真点 #5） |
| 部分强平 | Smart Liquidation：先发大 IOC 单，保证金够了就停 | **不做**，整仓平（用户 2026-09-17 定：IOC 单多大文档没说） |
| 交易手续费 | Commission Fee "Incurred every time an order is executed"，名义价值 = 数量 × 成交价 | 强平单吃盘口的每笔按 Taker 收；按破产价接管的部分不收 |
| 清算费 | Insurance Clearance Fee = 数量 × **成交价** × 币对费率，从这个仓位的资产里扣；破产仓位不收；小仓位维持保证金率低于清算费率时"进入强平就会变成破产仓位" | 同左；扣费顺序 已实现盈亏 → 交易手续费 → 清算费，每一项最多扣到剩余资产为 0 |
| 维持保证金选层 | 按名义价值所在的层算；假设的层和名义价值对不上时，换对应层重算强平价 | 风控扫描按标记价名义价值查层（缺口 #24） |
| 清算费率 | exchangeInfo 币对字段 `liquidationFee` | 2026-09-17：BTC / ETH / BNB / XRP / ADA / DOT / TRX / LTC / BCH / LINK 0.0125；SOL / DOGE / AVAX / NEAR / APT / ARB / OP / SUI / TON / FIL 0.015 |
| 负余额 | 保险基金每 10 分钟自动清零（Automated Negative Balance Clearance） | 按破产价平仓保证不会出现负余额（失真点 #6） |

**没核对到、我们自己定的**：强平单的手续费角色（我们按 Taker：IOC 单吃盘口）；手续费和清算费谁先扣（我们先手续费后清算费）。2026-09-17 用户定：强平要收交易手续费；剩余资产不够交费时扣到 0 为止。

---

## 9. 资金费与账户操作

**出处**：FAQ "Introduction to Binance Futures Funding Rates"（2026-03-06 更新）、"How to Adjust Margin Balance in Cross/Isolated Margin Mode?"（2026-01-02 更新）；U 本位合约错误码、用户数据流（`ACCOUNT_UPDATE` 资金费说明）；REST 接口 Change Initial Leverage / Change Margin Type / Change Position Mode / Modify Isolated Position Margin；`GET /fapi/v1/fundingInfo` 实时数据｜核对：2026-09-17

**资金费**

| 规则 | 币安 | 我们（第 08 讲） |
| --- | --- | --- |
| 金额 | 名义价值 × 费率，名义价值 = 标记价 × 数量；币安不收费 | 同左，`fundingFee()` 朝零截断 |
| 间隔 | 默认 8 小时（UTC 00/08/16），可按币对调整；有 15 秒误差 | 宿主按推送的下次结算时间排期；2026-09-17 开放币对中 19 个查到是 8 小时 |
| 费率上下限 | `fundingInfo`：BTCUSDT / ETHUSDT ±0.3%，其它 ±0.375% ～ ±2% | 费率由币安推送，不自己算、不自己封顶 |
| 逐仓仓位 | 资金费发生在逐仓仓位上时，`ACCOUNT_UPDATE` 带上那个仓位（isolated wallet 变化） | 钱包余额和逐仓保证金一起变 |
| 结算后 | 保证金不够会被强平 | 立刻 `riskScan` |

**账户操作**

| 操作 | 币安规则 | 我们的错误码 |
| --- | --- | --- |
| 调杠杆 | 1 ～ 币对最大杠杆（-4028） | `INVALID_PARAMS` |
| | 逐仓有持仓时不能调低（-4161） | `INVALID_PARAMS` |
| | 持仓超过新杠杆允许的最大名义价值（-2027） | `LEVERAGE_TOO_HIGH` |
| | 全仓余额不够（-4050） | `INSUFFICIENT_MARGIN` |
| 切保证金模式 | 已经是这个模式（-4046）；这个币对有挂单（-4047）/ 持仓（-4048） | `INVALID_PARAMS` / `MARGIN_MODE_LOCKED` |
| 切持仓模式 | 对所有币对生效；已经是（-4059）；任何挂单（-4067）/ 持仓（-4068） | `INVALID_PARAMS` / `POSITION_MODE_LOCKED` |
| 调逐仓保证金 | 只能调逐仓（"Only for isolated symbol"）；双向模式必须传 LONG / SHORT | `INVALID_PARAMS` / `POSITION_SIDE_MISMATCH` |
| | 最多可加 = max(0, min(crossWalletBalance − Σ 逐仓挂单起始保证金 − Σ 全仓仓位维持保证金, 可用余额)) | 超过：`INSUFFICIENT_MARGIN` |
| | 最多可减 = max(0, min(逐仓保证金 − 仓位维持保证金, 逐仓保证金 + 数量 × (标记价 − 开仓价) − 标记价 × 数量 × IMR)) | 超过：`MARGIN_WOULD_LIQUIDATE`（币安 -4051 ISOLATED_BALANCE_INSUFFICIENT） |

**没核对到、我们自己定的**：调杠杆时是否把挂单冻结保证金一起算进"余额够不够"（我们算，方向保守）；调低杠杆时持仓 + 开仓挂单一起比最大名义价值（和下单第 9 步同口径）；设置和当前一样时拒单而不是静默成功（按币安 -4046 / -4059 的做法，调杠杆币安没有对应错误码，我们同样拒）；调逐仓保证金不写流水（缺口 #6：逐仓保证金在钱包余额里）。

---

## 10. 触发单

**出处**：New Algo Order（`POST /fapi/v1/algoOrder`）网页版接口说明、U 本位合约更新日志 2025-12-29、用户数据流 `ALGO_UPDATE` / `CONDITIONAL_ORDER_TRIGGER_REJECT`、错误码｜核对：2026-09-17

| 规则 | 币安 | 我们（第 09 讲） |
| --- | --- | --- |
| 触发条件 | STOP / STOP_MARKET 买：latest price ≥ triggerPrice，卖：≤；TAKE_PROFIT / TAKE_PROFIT_MARKET 买：≤，卖：≥。latest price 是 MARK_PRICE 还是 CONTRACT_PRICE 由 `workingType` 定（默认 CONTRACT_PRICE） | 同左；标记价推送查 MARK_PRICE 单，行情成交推送查 CONTRACT_PRICE 单 |
| 下单时已满足触发条件 | -2021 ORDER_WOULD_IMMEDIATELY_TRIGGER / -4142 | `WOULD_IMMEDIATELY_TRIGGER`（校验链第 14 步） |
| 条件单数量 | 2025-12-29 起 `MAX_NUM_ALGO_ORDERS` 移除，"conditional order limits is 200 across all symbols"（-4045）；`MAX_NUM_ORDERS` 普通单和 algo 单一起算 | 未触发的条件单所有币对合计 ≤ 200（`LimitConfig.maxConditionalOrdersNum`）；每币对挂单数照旧普通单和触发单一起算 |
| closePosition | 只配 STOP_MARKET / TAKE_PROFIT_MARKET；"If triggered, close all current long position (if SELL) or current short position (if BUY)" | 触发时数量取对应方向当时的全部仓位 |
| STOP / TAKE_PROFIT 的 timeInForce | 可传，默认 GTC | 同左 |
| 触发后 | 转发到撮合引擎新下一张单（algoStatus TRIGGERING → TRIGGERED，actualOrderId） | 沿用同一张订单，`triggered = true` |
| 触发后被拒 | algoStatus `REJECTED`（"such as in scenarios of margin check failures"），推送 `CONDITIONAL_ORDER_TRIGGER_REJECT` | 校验链不通过 → `REJECTED`；GTX 会吃单 → `EXPIRED`（缺口 #13） |
| priceProtect | STOP_MARKET / TAKE_PROFIT_MARKET 可选，默认 false；触发时标记价和最新价偏差不能超过币对 `triggerProtect` | **没实现**（等于永远 false，缺口 #28） |
| 止损限价单委托价上下限 | -4183 / -4184 "Limit price can't be higher / lower than %s"（相对触发价的倍数） | **没实现**，具体倍数字段文档没写（缺口 #28） |

---

## 11. 账户与仓位展示（第 13a 讲）

**出处**：REST `GET /fapi/v3/account`、`GET /fapi/v3/positionRisk` 网页版字段说明；FAQ「How to Calculate Liquidation Price of USDⓈ-M Futures Contracts」（页面更新于 2025-12-31）、「How to Calculate Profit and Loss for Futures Contracts」（页面更新于 2026-02-02）｜核对：2026-09-17

| 项 | 币安 | 我们 |
| --- | --- | --- |
| 账户字段 | `totalWalletBalance` `totalUnrealizedProfit` `totalMarginBalance` `totalPositionInitialMargin` `totalOpenOrderInitialMargin` `totalMaintMargin` `totalCrossWalletBalance` `totalCrossUnPnl` `availableBalance` | `GET /account` 同口径（`openOrderMargin` 含手续费预留，缺口 #40） |
| 仓位起始保证金 | positionRisk `initialMargin`："initial margin required with current mark price" | 按标记价 ÷ 杠杆（可用余额里还是开仓价口径，缺口 #43） |
| 强平价公式 | `(WB − TMM₁ + UPNL₁ + cumB + cumL + cumS − Side_B×Pos_B×EP_B − Pos_L×EP_L + Pos_S×EP_S) ÷ (Pos_B×MMR_B + Pos_L×MMR_L + Pos_S×MMR_S − Side_B×Pos_B − Pos_L + Pos_S)`；全仓 WB = crossWalletBalance，逐仓 WB = 该仓位逐仓钱包、TMM = UPNL = 0；档位对不上时换档重算 | `liquidation.ts`，FAQ 算例 ETH 1,153.26 / BTC 26,316.89 进测试（缺口 #39） |
| ROI% | 标记价口径：未实现盈亏 ÷ (标记价 × 数量 × IMR)，IMR = 1 / 杠杆 | 仓位 `roe` 同口径 |
| 撤单 | `DELETE /fapi/v1/allOpenOrders` 按币对全撤 | `DELETE /orders?symbol=`，含未触发的条件单 |
| `newClientOrderId` | "A unique id among open orders. Automatically generated if not sent"，规则 `^[\.A-Z\:/a-z0-9_-]{1,36}$` | 同规则；幂等范围比币安大（缺口 #41） |
| 调杠杆 | 参数说明只有 "target initial leverage"，上限按分层表（BTCUSDT 第 1 层现在 150x） | 接口只校验 ≥ 1 的整数，上限由引擎按分层表判 |

---

## 12. 公开行情 REST（第 13b 讲）

**出处**：网页版 Market Data REST API（Kline/Candlestick Data、Get Funding Rate History、24hr Ticker Price Change Statistics）+ 2026-09-17 实际请求｜核对：2026-09-17
封禁规则出处：`docs/vendor/binance/usds-futures.txt` Limits 一节（"IP bans are tracked and scale in duration for repeat offenders, from 2 minutes to 3 days"）｜核对：2026-09-20

| 接口 | 币安规则 | 我们 |
| --- | --- | --- |
| `GET /fapi/v1/klines` | interval 15 种：1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M（没有 1s）；limit 默认 500、最大 1500；权重按 limit：[1,100) 1、[100,500) 2、[500,1000] 5、> 1000 10；不带 startTime / endTime 返回最近的 | `/market/klines` 同规则；最新 5 秒缓存，整段已收盘 10 分钟 |
| `GET /fapi/v1/fundingRate` | limit 默认 100、最大 1000；和 fundingInfo 共享 500 次 / 5 分钟 / IP；文档说不带时间范围返回最近 200 条，按时间升序；响应带 `markPrice` `rateType`（Regular / Special） | `/market/funding-history`，60 秒缓存。**实测** `limit=1000` 返回 500 条（缺口 #46） |
| `GET /fapi/v1/ticker/24hr` | 单币对权重 1，不带 symbol 40；`priceChangePercent` 形如 `-95.960`（百分数） | ticker 的 `stats24h`，单币对 3 秒缓存；`/market/tickers` 用不带 symbol 的全量，10 秒缓存（权重 40 × 6 次 / 分钟 = 240，IP 限额 `REQUEST_WEIGHT` 2400 / 分钟，出处 `docs/vendor/binance/usds-futures.txt` exchangeInfo 示例） |
| 标记价推送 `<symbol>@markPrice@1s` | 字段 `i` 是指数价格（真实推送 fixtures 里有） | 行情层解析出 `indexPrice`，只给展示 |
| 限流响应 | HTTP 429 = 超限警告；**收到 429 之后继续发**才会被自动封 IP（418）。带 `Retry-After` | 按 `Retry-After` 暂停请求（没有就 60 秒），期间直接 `SERVICE_UNAVAILABLE`，一个请求都不发 |
| 封禁时长 | IP 封禁**按累犯次数递增，2 分钟到 3 天**；限额按 **IP** 算，不按 API Key。被封期间继续撞会继续累加 | 全进程共用一个 `binanceRest` 实例（退避状态在实例闭包里），快照排队限速 + 指数退避 |

---

## 14. 跟踪委托 TRAILING_STOP_MARKET（第 15 讲）

**出处**：New Algo Order（`POST /fapi/v1/algoOrder`）网页版接口说明（请求体 + 下方备注）、`GET /fapi/v1/allOrders` 响应字段、`MAX_NUM_ALGO_ORDERS` filter 说明、用户数据流 `ORDER_TRADE_UPDATE` 的 `AP` / `cr` 字段、FAQ「What Is a Trailing Stop Order?」（360042299292）｜核对：2026-09-21

> ⚠️ **币安接口说明这一段本身是坏的**：网页版和它背后的页面数据里，两个 `<=` 被当成 HTML 标签吃掉了，
> 触发条件只剩半句（"BUY: the lowest price after order placed = the lowest price * (1 + callbackRate)"）。
> 缺掉的那半句按 FAQ 360042299292 的表格补全（该页写的是「激活价 ≤ 最高价」「回调幅度 ≥ 回调率」），
> 两边其余部分互相吻合。**这一条是全文唯一一处靠两个来源拼出来的规则，以后币安把文档修好了要回来核对。**

| 规则 | 币安 | 我们（第 15 讲） |
| --- | --- | --- |
| 参数 | `activatePrice`（可选，不传默认为下单那一刻的 latest price，按 `workingType` 取）、`callbackRate`；`stopPrice` 对这个类型无意义（allOrders 响应写明 "please ignore when order type is TRAILING_STOP_MARKET"） | 同左。`activationPrice` 可选，不传取下单那一刻的参照价 |
| `callbackRate` 范围 | **接口**：min 0.1、max 10（百分数，即 0.1% ～ 10%）。**FAQ 页面**写的是 0.01% ～ 20%（网页端口径），两边不一致 | 按**接口**的 0.1% ～ 10%——我们对外是 API，以接口口径为准 |
| 触发条件（SELL，护多头） | 下单后的**最高价** ≥ `activatePrice`，且 latest price ≤ 最高价 × (1 − `callbackRate`) | 同左 |
| 触发条件（BUY，护空头） | 下单后的**最低价** ≤ `activatePrice`，且 latest price ≥ 最低价 × (1 + `callbackRate`) | 同左 |
| 最高 / 最低价从什么时候算 | "after order placed" —— 从下单那一刻起 | 同左。追踪的是 `workingType` 对应的那个价（标记价或最新成交价），不混用 |
| 下单时已满足 | -2021 ORDER_WOULD_IMMEDIATELY_TRIGGER。BUY：`activatePrice` 必须小于 latest price；SELL：必须大于 | 同左，复用校验链第 14 步的 `WOULD_IMMEDIATELY_TRIGGER` |
| 触发后 | 按市价单成交 | 同左：转成 MARKET 重走校验链（和第 09 讲的条件单一个路径） |
| `closePosition` | 接口说明写「Close-All，used with STOP_MARKET or TAKE_PROFIT_MARKET」——**不配跟踪委托** | 不支持，传了拒单 |
| `reduceOnly` | 可以传（双向持仓模式下不能传） | 同左 |
| 数量限制 | 算 algo 单：`MAX_NUM_ALGO_ORDERS` 把 `STOP` / `STOP_MARKET` / `TAKE_PROFIT` / `TAKE_PROFIT_MARKET` / `TRAILING_STOP_MARKET` 一起数；2025-12-29 后的口径是所有币对合计 200 | 和第 09 讲的条件单共用同一个计数（合计 ≤ 200） |
| 展示字段 | allOrders 返回 `activatePrice` + `priceRate`（回调率）；推送里是 `AP` / `cr` | 我们的订单对外给 `activationPrice` + `callbackRate`，另外多给一个**币安没有的** `trackedPrice`（当前追踪到的最高 / 最低价），理由见第 15 讲讲义 |

---

## 13. 还没核对、写到时要查的

| 讲 | 要查的币安规则 |
| --- | --- |
| 07 | ✅ 已核对，见第 8 节；强平价展示公式 ✅ 13a 已查，见第 11 节。**还没查**：可用余额 `availableBalance` 能不能为负（不影响引擎：强平线在维持保证金，缺口 #19 已按"下单不能把它变负"定） |
| 08 | ✅ 已核对，见第 9 节 |
| 09 | ✅ 已核对，见第 10 节。**还没查**：`priceProtect` 触发时怎么判（`triggerProtect` 的含义）、止损限价单委托价上下限用的是哪个字段（缺口 #28，要做时再查） |
| 13a | ✅ 账户 / 仓位字段、强平价公式、ROI% 已查，见第 11 节。**还没查**：`availableBalance` 的全仓起始保证金按开仓价还是标记价（缺口 #43）；`totalOpenOrderInitialMargin` 含不含手续费（缺口 #40） |
| 15 | ✅ 已核对，见第 14 节。**注意**：币安那段接口说明本身有渲染 bug，触发条件是拿 FAQ 补全的；**还没查**：跟踪委托触发后被拒是什么状态（按第 09 讲同样处理）、激活前算不算进 `MAX_NUM_ORDERS`（我们算） |
