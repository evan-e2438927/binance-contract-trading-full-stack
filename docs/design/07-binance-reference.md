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
| `-2021` / `-4142` | 条件单会立刻触发 | （第 09 讲） | — |
| `-4045` MAX_STOP_ORDER_EXCEEDED | 条件单数达到上限（具体数值文档没给） | 未实现 | — |

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
| 挂单什么时候成交 | 真实订单簿按价格时间优先撮合 | 用行情成交流推算排队位置（撤单假设在我后面 + 盘口总量夹逼） | 看不到币安队列内部（失真点 #3），设计文档 5.5 节；第 06 讲 |

---

## 7. 行情推送（WebSocket 市场流）

**出处**：U 本位合约更新日志（2025-11-18 RPI 订单、2025-12-29 `nq` 字段）、"Important WebSocket Change Notice"（本地 `usds-futures.txt`）+ 2026-09-17 连 BTCUSDT 实时推送抓包｜核对：2026-09-17

**连接地址**：币安把合约 WebSocket 拆成三个入口，旧的 `wss://fstream.binance.com/ws`、`/stream` 在 2026-04-23 之后**只推 `/public` 那一类数据**（实测：旧地址收得到 depth，收不到 aggTrade）。

| 入口 | 我们要订阅的流 |
| --- | --- |
| `wss://fstream.binance.com/public/stream?streams=` | `<symbol>@depth20@100ms` |
| `wss://fstream.binance.com/market/stream?streams=` | `<symbol>@aggTrade`、`<symbol>@markPrice@1s`、`<symbol>@kline_<interval>` |

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

## 8. 还没核对、写到时要查的

| 讲 | 要查的币安规则 |
| --- | --- |
| 07 | 强平价公式和维持保证金的最新口径（FAQ "How to Calculate Liquidation Price of USDⓈ-M Futures Contracts"）；强平清算费；可用余额能不能为负 |
| 08 | 资金费结算时间和公式；调杠杆、切保证金模式、切持仓模式的限制（`-4047` / `-4048` / `-4067` / `-4068` / `-4161`） |
| 09 | 条件单 `priceProtect` / `triggerProtect`；条件单数量上限（`-4045`）；止损限价单的委托价限制（`-4183` / `-4184`） |
