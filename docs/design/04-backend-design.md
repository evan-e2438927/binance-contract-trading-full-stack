# 04 · 后端子设计

> 范围：`apps/server` + `packages/engine` + `packages/shared`
> 前置阅读：`01-domain-knowledge.md`（业务概念）、`02-architecture.md`（分层与精度）

## 目录

1. 模块结构与启动顺序
2. 行情层
3. 引擎：数据结构与状态机
4. 引擎：计算公式
5. 引擎：撮合
6. 引擎：下单校验链
7. 引擎：触发单
8. 引擎：风控与强平
9. 引擎：资金费
10. 引擎宿主
11. REST 接口
12. WebSocket 协议
13. 错误码

---

## 1. 模块结构与启动顺序

```
apps/server/src/
├── index.ts                  进程入口：按序启动各层，注册优雅退出
├── config/
│   ├── symbols.ts            币对清单（从环境变量读，回落到数据库 enabled）
│   └── constants.ts          费率、初始资金、冷却时间、限流阈值
├── market/                   行情层：只和币安打交道，不含任何业务逻辑
│   ├── binance-ws.ts         连接管理 / 订阅 / 心跳 / 指数退避重连
│   ├── binance-rest.ts       exchangeInfo、历史 K 线、历史资金费率
│   ├── orderbook-store.ts    每个币对的 20 档盘口快照
│   ├── markprice-store.ts    标记价 + 资金费率 + 下次结算时间
│   ├── trade-stream.ts       aggTrade 分发（撮合的心跳源）
│   └── kline-store.ts        K 线缓存（内存环形缓冲）
├── engine-host/              宿主层：把纯引擎接到真实世界
│   ├── engine-host.ts        持有 Engine 实例，订阅行情事件驱动它
│   ├── recovery.ts           启动时从数据库恢复订单与仓位
│   ├── persister.ts          把 EngineEvent 写进数据库（事务）
│   └── funding-scheduler.ts  UTC 整点资金费定时器
├── jobs/
│   └── bracket-sync.ts       杠杆分层表每日同步（UTC 00:05，启动时先跑一次）
├── api/                      Hono 路由
│   └── auth.ts  market.ts  account.ts  orders.ts  positions.ts  leaderboard.ts
├── ws/
│   ├── gateway.ts            WS 服务：连接、鉴权、订阅管理
│   ├── public-channels.ts    行情转发
│   └── private-channels.ts   账户/订单/仓位推送
├── auth/
│   ├── siwe.ts               EVM 签名验证
│   ├── siws.ts               Solana 签名验证
│   └── jwt.ts
└── db/                       仓储层（Drizzle 查询封装）

packages/engine/src/
├── types.ts        EngineInput / EngineEvent / Order / Position / Account
├── account.ts      余额、可用余额、保证金汇总
├── position.ts     开平仓、均价、盈亏
├── matching.ts     拟真排队 + 逐档吃单
├── validate.ts     下单校验链
├── risk.ts         维持保证金、保证金率、强平价
├── liquidation.ts  强平执行
├── funding.ts      资金费结算
└── index.ts        Engine 类：apply(input) → EngineEvent[]

packages/shared/src/
├── fixed.ts        SCALE、parse/format、mul/div、五种舍入
├── types.ts        跨层共用类型与枚举
├── errors.ts       ErrorCode 枚举 + EngineError
└── constants.ts    费率等常量
```

### 启动顺序

顺序不能乱，每一步失败都直接退出进程（让 pm2 重启）：

```
1. 加载配置、校验环境变量
2. 连接 Postgres，检查迁移版本
3. 从数据库加载 symbols 规格 + leverage_brackets → 内存
4. 连接币安 WS，订阅 20 个币对的四类流
5. 等待所有币对首次收到 depth 和 markPrice（30s 超时未就绪则退出）
6. 从数据库恢复未完成订单和全部仓位 → 构造 Engine 实例
7. 跑一轮全账户风控扫描（补上停机期间该强平的）
8. 启动资金费定时器 + 分层表每日同步任务（同步失败只记日志，不退出进程；有变化时热加载进引擎）
9. 启动 Hono HTTP 服务 + WS 网关，开始对外提供服务
```

第 5 步是刻意的：**盘口和标记价没就位就不接受下单**，否则第一笔单拿不到价格。

---

## 2. 行情层

### 订阅的流

每个币对订阅 4 条，20 个币对共 80 条。币安单条连接最多 200 个流，一条够用，但为隔离故障拆成两条：

| 连接 | 流 | 用途 |
| --- | --- | --- |
| A（撮合关键） | `<symbol>@aggTrade`、`<symbol>@depth20@100ms`、`<symbol>@markPrice@1s` | 驱动撮合与风控 |
| B（展示用） | `<symbol>@kline_1m` 及用户选中的周期 | 只给前端画图 |

组合流 URL：

```
wss://fstream.binance.com/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms/btcusdt@markPrice@1s/...
```

> **已过时（设计缺口 #22，第 10 讲改）**：币安把合约 WebSocket 拆成了 `/public`（depth、bookTicker）、`/market`（aggTrade、markPrice、kline……）、`/private` 三个入口，旧的 `/ws`、`/stream` 在 2026-04-23 之后只推 `/public` 那一类。连接 A 要拆成 `wss://fstream.binance.com/public/stream?streams=…@depth20@100ms` 和 `wss://fstream.binance.com/market/stream?streams=…@aggTrade/…@markPrice@1s` 两条。见 `07-binance-reference.md` 第 7 节。

### 关键字段

**`@aggTrade`** —— 撮合的心跳

| 字段 | 含义 |
| --- | --- |
| `p` | 成交价 |
| `q` | 成交数量 |
| `m` | **买方是否为 Maker**。`true` = 主动卖单吃掉了买方挂单 |
| `T` | 成交时间 |

`m` 是拟真排队算法的核心：判断这笔成交消耗买方队列还是卖方队列，全靠它。

> **已定（第 06 讲）**：推送里还有 `a`（归集成交 id）和 `nq`（只含普通订单的成交量，不含 RPI 订单）。RPI 挂单不出现在 depth 流里，所以**消耗排队位置用 `nq` 不用 `q`**，和盘口同口径；`a` 用来拼 Maker 成交的 id。见 `07-binance-reference.md` 第 7 节。

**`@markPrice@1s`**

| 字段 | 含义 |
| --- | --- |
| `p` | 标记价格 |
| `i` | 指数价格 |
| `r` | 当前资金费率 |
| `T` | 下次资金费结算时间（毫秒） |

**`@depth20@100ms`**：`b` 买盘 20 档、`a` 卖盘 20 档，每档 `[价格, 数量]`。

这是**快照流**，不是增量流——每次推过来就是完整 20 档，不需要维护序列号，也不会 out-of-sync。这正是选它的原因。

### 重连策略

币安会在 **24 小时**后主动断开，网络抖动也会断：

```
断开 → 指数退避重连：1s, 2s, 4s, 8s, 16s, 30s, 30s...
重连成功 → 重新订阅所有流 → 通过 REST 拉一次 depth 和 markPrice 补齐快照
保活 → 每 20 分钟收到币安的 ping 帧必须回 pong
```

**断线期间**：

- 引擎**暂停**处理拟真成交
- 前端推 `{ t: 'marketStatus', status: 'degraded' }`，界面顶部出黄条
- 恢复后**不补算**断线期间的成交

---

## 3. 引擎：数据结构与状态机

### 核心结构

```ts
interface Account {
  id: string
  walletBalance: Fixed          // 已结算的钱
  positionMode: 'ONE_WAY' | 'HEDGE'
}

interface Position {
  accountId: string
  symbol: string
  positionSide: 'BOTH' | 'LONG' | 'SHORT'
  marginMode: 'CROSS' | 'ISOLATED'
  leverageNum: number
  qty: Fixed                    // 始终 ≥ 0，方向由 positionSide 决定
  entryPrice: Fixed
  isolatedMargin: Fixed         // 仅逐仓
  openedAt: number
}

interface Order {
  id: string
  clientOrderId: string
  accountId: string
  symbol: string
  side: 'BUY' | 'SELL'
  positionSide: 'BOTH' | 'LONG' | 'SHORT'
  type: OrderType
  timeInForce: TimeInForce
  price: Fixed | null           // 市价单为 null
  stopPrice: Fixed | null
  workingType: 'MARK_PRICE' | 'CONTRACT_PRICE'
  qty: Fixed
  executedQty: Fixed
  avgPrice: Fixed
  reduceOnly: boolean
  closePosition: boolean
  status: OrderStatus
  triggered: boolean
  queueAhead: Fixed             // ★ 拟真排队：前方还剩多少量
  queueEstimated: boolean
  frozenMargin: Fixed
  createdAt: number
  updatedAt: number
}
```

**`qty` 恒为非负**：方向完全由 `positionSide` 决定。负数在 bigint 运算里到处要判符号，容易在某个分支漏掉。单向模式对外暴露 `BOTH`，内部仍用 `LONG` / `SHORT` 表示方向。

> **已定（设计缺口 #12）**：引擎内部就按这一段做（第 04 讲已实现：单向模式的仓位在引擎里存 `LONG` / `SHORT`，同一币对最多一个）。**数据库**按币安标准存：单向模式 `BOTH` 一行、数量带符号（多正空负），见 `03-database-design.md` 的 `positions` 一节。两者互转在第 11 讲仓储层。详见 `docs/tutorial/README.md` 设计缺口清单。

### 订单状态机

```
                    ┌──────────┐
   下单校验失败 ────►│ REJECTED │  （终态，不入库为挂单，只记录拒单日志）
                    └──────────┘

   下单校验通过
        │
        ▼
    ┌───────┐  部分成交   ┌───────────────────┐  剩余成交  ┌────────┐
    │  NEW  │────────────►│ PARTIALLY_FILLED  │──────────►│ FILLED │ 终态
    └───┬───┘             └─────────┬─────────┘           └────────┘
        │  全部成交                   │
        └────────────────────────────────────────────────────►
        │
        │  用户撤单 / 只减仓单失效 / 强平清场
        ├────────────────────────────┬──────────────────────►┌──────────┐
        │                            │                       │ CANCELED │ 终态
        │                            │                       └──────────┘
        │  IOC 未成部分 / FOK 未全成 / GTX 会吃单 / 触发时保证金不足
        └──────────────────────────────────────────────────►┌──────────┐
                                                            │ EXPIRED  │ 终态
                                                            └──────────┘
```

> **已定（设计缺口 #13）**：图里"GTX 会吃单 → EXPIRED"只适用于**止损限价 / 止盈限价单触发那一刻**才发现会吃单的情况（订单已经存在过）。普通 `LIMIT` + `GTX` 在**下单那一刻**就会吃单的，由第 6 节校验链第 12 步直接拒单（`POST_ONLY_REJECTED`，走 REJECTED，订单从没存在过）。详见 `docs/tutorial/README.md` 设计缺口清单。

**触发单**（STOP / TAKE_PROFIT 系列）：

```
下单成功 → status = NEW, triggered = false   （不占盘口，不冻结保证金）
     │
     │  标记价触及 stopPrice
     ▼
triggered = true → 按 type 转化：
     ├─ STOP / TAKE_PROFIT               → 以 price 挂一张限价单，进正常撮合
     └─ STOP_MARKET / TAKE_PROFIT_MARKET → 立即按市价逐档吃单
```

触发单**未触发时不冻结保证金**（和币安一致）。这意味着触发瞬间可能因保证金不足而失败——此时转 `EXPIRED` 并记录原因。

---

## 4. 引擎：计算公式

> 下文伪代码里的 `×` `÷` 指 `mul()` `div()`，不是原生运算符。
> 所有算例都在 `01-domain-knowledge.md` 验算过，写测试直接抄。

### 4.1 基础

```ts
notional(qty, price)                  = qty × price
initialMargin(qty, price, leverageNum) = (qty × price) ÷ leverageNum

unrealizedPnl(p, markPrice) {
  const diff = p.positionSide === 'SHORT'
    ? p.entryPrice - markPrice
    : markPrice - p.entryPrice
  return diff × p.qty
}

marginBalance(acc) = acc.walletBalance + Σ unrealizedPnl(所有仓位)
```

### 4.2 可用余额

最容易算错的一个，逐项列清楚：

```
可用余额 = 钱包余额
         + Σ 全仓仓位的未实现盈亏          （正负都算）
         − Σ 全仓仓位的起始保证金
         − Σ 逐仓仓位的 isolatedMargin
         − Σ 挂单冻结保证金
```

三点说明：

1. **逐仓仓位的浮盈不计入可用余额**。钱已划进那个仓位，浮盈也锁在里面，要拿出来必须手动调保证金或平仓。和币安一致。
2. **全仓仓位的浮盈可以拿来开新仓**。这是全仓资金效率高的原因，也是全仓风险传染的来源。
3. **只减仓单不冻结保证金**（它只会释放保证金）。

### 4.3 挂单冻结保证金

```ts
frozenMargin(order) =
  order.reduceOnly || order.closePosition
    ? 0n
    : (order.qty × order.price) ÷ leverageNum        // 起始保证金
      + ceil8((order.qty × order.price) × takerFeeRate)  // 按最坏情况预留手续费
```

手续费按 Taker 预留是刻意保守：限价单如果穿透盘口就是 Taker，按 Maker 预留会导致成交时余额不够。

> **已定（缺口 #14，第 05 讲实现）**：按币安"开仓成本 = 起始保证金 + 开仓亏损"补上开仓亏损，冻结保证金 = 起始保证金（按币安假设价格）+ 开仓亏损 + 上面的 Taker 手续费预留。公式见 `07-binance-reference.md` 第 5 节，实现在 `validate-order.ts` 的 `limitOpenCost` / `marketOpenCost`。

> **与币安的已知差异**：币安在单向模式下对同一币对的买卖挂单做净额冻结，取 `max(买方向总冻结, 卖方向总冻结)`，因为买卖单不可能同时全成。我们第一版**逐单独立冻结**，同时挂对敲单时占用比币安多。会让用户偶尔觉得"钱不够"，但**方向保守，不会超额开仓**。

### 4.4 仓位变更

**开仓 / 加仓（同方向）**

```ts
newQty        = p.qty + fillQty
newEntryPrice = (p.entryPrice × p.qty + fillPrice × fillQty) ÷ newQty
```

算例：1 BTC @ 50,000 再买 1 BTC @ 52,000 → 2 BTC @ 51,000

**减仓 / 平仓（反方向）** —— 均价不变

```ts
closeQty    = min(fillQty, p.qty)
realizedPnl = p.positionSide === 'SHORT'
  ? (p.entryPrice - fillPrice) × closeQty
  : (fillPrice - p.entryPrice) × closeQty

p.qty -= closeQty
releasedMargin = p.isolatedMargin × (closeQty ÷ 原 p.qty)   // 逐仓按比例释放
```

算例：2 BTC @ 51,000 卖 1 BTC @ 53,000 → 已实现 +2,000，剩 1 BTC 均价仍 51,000

**反手**（仅单向模式，成交量超过仓位）

```
第 1 步：平掉全部现有仓位，结算已实现盈亏
第 2 步：剩余数量以成交价开一个反方向的新仓位
```

双向模式不存在反手：超出部分按 `reduceOnly` 语义拒绝。

### 4.5 杠杆分层与维持保证金

```ts
findBracket(symbol, notional) {
  // brackets 按 notionalCap 升序，返回第一个 notional ≤ cap 的
  return brackets.find(b => notional <= b.notionalCap) ?? brackets.at(-1)
}

maintMargin(notional, bracket) = notional × bracket.mmr − bracket.cum
```

算例（BTCUSDT，分层表见 `01-domain-knowledge.md`）：

| 名义价值 | 层 | 计算 | MM |
| --- | --- | --- | --- |
| 40,000 | 1 | `40,000 × 0.4% − 0` | 160 |
| 50,000 | 1 | `50,000 × 0.4% − 0` | 200 |
| 50,000 | 2（边界） | `50,000 × 0.5% − 50` | 200 ✓ |
| 200,000 | 2 | `200,000 × 0.5% − 50` | 950 |
| 1,000,000 | 3 | `1,000,000 × 1.0% − 3,050` | 6,950 |

### 4.6 保证金率与强平价

```ts
marginRatio(acc) = Σ maintMargin(所有仓位) ÷ marginBalance(acc)
// 达到 1.0（100%）触发强平
```

强平价（币安通用公式）：

```ts
function liquidationPrice(acc, target: Position, ctx): Fixed {
  const side = target.positionSide === 'SHORT' ? -1n : 1n
  const notional = target.qty × ctx.markPrice(target.symbol)
  const bk = findBracket(target.symbol, notional)

  let WB: Fixed, TMM: Fixed, UPNL: Fixed, cumB: Fixed, cumL: Fixed

  if (target.marginMode === 'ISOLATED') {
    WB   = target.isolatedMargin   // 逐仓只拿自己那笔钱兜底
    TMM  = 0n                       // 其他仓位与我无关
    UPNL = 0n
    cumB = bk.cum
    cumL = 0n
  } else {
    WB   = acc.walletBalance
    TMM  = Σ maintMargin(其他全仓仓位)
    UPNL = Σ unrealizedPnl(其他全仓仓位)
    cumB = 0n
    cumL = bk.cum
  }

  const numerator   = WB - TMM + UPNL + cumB - cumL - side × target.qty × target.entryPrice
  const denominator = target.qty × bk.mmr - side × target.qty
  return alignPrice(numerator ÷ denominator, tickSize, ...)
}
```

> **已定（设计缺口 #5）**：强平价**不对齐 `tickSize`**，上面最后一行的 `alignPrice` 作废。强平价是风控阈值，不是要挂上盘口的委托价；下面算例 A 的 45,180.72 本身也不是 0.1 的整数倍。实现只在最后一步 `divRound` 四舍五入到 8 位（第 03 讲 `liquidation.ts`）。详见 `docs/tutorial/README.md` 设计缺口清单。

**三个算例**（单测直接用，验算过程见 `01-domain-knowledge.md` 第六节）：

| 算例 | 条件 | 强平价 | 反算保证金率 |
| --- | --- | --- | --- |
| A 逐仓多 | EP 50,000，1 BTC，10x，逐仓保证金 5,000 | **45,180.72** | 180.72 / 180.72 = 100% ✓ |
| B 逐仓空 | 同上做空 | **54,780.88** | 219.12 / 219.12 = 100% ✓ |
| C 全仓多 | 钱包 10,000，其余同 A | **40,160.64** | 160.64 / 160.64 = 100% ✓ |

### 4.7 资金费

```ts
fundingFee(p, rate, markPrice) {
  const amount = (p.qty × markPrice) × rate
  // 费率为正：多头付出（负流水），空头收到（正流水）
  return p.positionSide === 'SHORT' ? amount : -amount
}
```

### 4.8 手续费

```ts
fee(fillQty, fillPrice, role) =
  ceil8(fillQty × fillPrice × (role === 'MAKER' ? 0.0002 : 0.0005))
```

手续费**在每笔成交时立刻从 `walletBalance` 扣除**，并写一条 `FEE` 流水。不合并、不延后——这样任何一笔成交的资金影响都能独立追溯。

---

## 5. 引擎：撮合

### 5.1 基本立场

真交易所的撮合是：我的单和你的单在同一个订单簿里对撞。

我们做不到——用户只有彼此，没有真实流动性。所以我们的模型是：

> **用币安真实发生的成交流，去"消耗"我们模拟挂单的排队位置。**

我们不撮合订单，我们**判定**"如果这张单真的挂在币安上，它现在成交了吗"。

这个判定的质量，决定了这是个有用的练习工具还是一个骗人的玩具。

### 5.2 事件驱动主循环

| 收到 | 处理顺序 |
| --- | --- |
| `@markPrice` | ① 更新标记价 ② 重算受影响账户的未实现盈亏 ③ 检查触发单 ④ 风控扫描 |
| `@depth20` | ① 覆盖盘口快照 ② 夹逼所有挂单的 `queueAhead` ③ 重评估此前"估算"的排队位置 |
| `@aggTrade` | ① 更新最新价 ② 消耗挂单队列产生成交 ③ 更新仓位/扣费/改余额 ④ 风控扫描 |

**顺序是刻意的**。比如 markPrice 分支必须先更新浮盈再判强平，否则会用旧盈亏判定新价格。这类顺序错误在测试里很难发现，写代码时按这个表逐条对。

### 5.3 市价单：逐档吃

```ts
function executeMarket(side, qty, book): Fill[] {
  const levels = side === 'BUY' ? book.asks : book.bids   // 买吃 asks 升序，卖吃 bids 降序
  const fills = []
  let remaining = qty

  for (const lvl of levels) {
    const take = min(remaining, lvl.qty)
    fills.push({ price: lvl.price, qty: take, role: 'TAKER' })
    remaining -= take
    if (remaining === 0n) break
  }
  if (remaining > 0n) throw new EngineError('MARKET_ORDER_TOO_LARGE')
  return fills
}
```

成交均价 = `Σ(price_i × qty_i) ÷ Σ qty_i`

**算例**：市价买 5 BTC，卖方前三档

| 档 | 价格 | 数量 |
| --- | --- | --- |
| 1 | 50,000.0 | 2 |
| 2 | 50,000.5 | 2 |
| 3 | 50,001.0 | 3 |

```
吃：2 @ 50,000.0 + 2 @ 50,000.5 + 1 @ 50,001.0
均价 = (100,000 + 100,001 + 50,001) ÷ 5 = 50,000.4
滑点 = 0.4 USDT/BTC（相对最优价 0.0008%）
```

这个滑点就是"大单冲击成本"的教学价值。

**吃穿 20 档怎么办**：拒单，不伪造价格。

```
校验：市价单数量 ≤ 对手方 20 档可见深度总量 × 50%
超出 → MARKET_ORDER_TOO_LARGE
提示："当前深度下最大可市价成交 X BTC，请减小数量或用限价单"
```

为什么是 50%：盘口是 100ms 前的快照，真实深度随时在变，留一半余量。

为什么不"按最后一档 + 滑点惩罚"硬成交：那个惩罚系数是我们拍脑袋定的，一旦用户开始研究它，模拟盘就失去意义。**宁可说做不到，不要编一个数字。**

### 5.4 限价单下单瞬间：先判定角色

限价单进来第一件事不是挂单，而是判断它会不会**立刻成交**。

```ts
function placeLimit(order, book) {
  const best = order.side === 'BUY' ? book.asks[0].price : book.bids[0].price
  const crosses = order.side === 'BUY' ? order.price >= best : order.price <= best

  if (crosses) {
    // ── 会立刻成交，是 Taker ──
    if (order.timeInForce === 'GTX') return expire(order, 'POST_ONLY_REJECTED')  // 已定（缺口 #13）：普通限价单走不到这里，第 6 节第 12 步已经拒单；这一行只对触发后挂出的 GTX 单生效

    const fills = takeUpTo(order.side, order.qty, order.price, book)  // 不超过委托价
    if (order.timeInForce === 'FOK' && sumQty(fills) < order.qty) return expire(order)
    applyFills(order, fills)

    const remaining = order.qty - order.executedQty
    if (remaining > 0n) {
      if (order.timeInForce === 'IOC') return expire(order)
      enqueue(order, 0n)   // ★ 穿透后剩余部分，排队位置是 0
    }
  } else {
    // ── 挂进盘口，是 Maker ──
    enqueue(order, estimateQueueAhead(order, book))
  }
}
```

注意 `enqueue(order, 0n)`：**穿透后剩余的部分排队位置是 0**，因为它已经把那个价位的对手方全吃光，自己成了该价位第一张单。这个细节容易漏。

### 5.5 拟真排队算法（核心）

**初始排队位置**

```ts
function estimateQueueAhead(order, book): Fixed {
  const levels = order.side === 'BUY' ? book.bids : book.asks
  const lvl = levels.find(l => l.price === order.price)
  if (lvl) return lvl.qty          // 该价位可见：前方就是这些量

  const best = levels[0].price
  const better = order.side === 'BUY' ? order.price > best : order.price < best
  if (better) return 0n            // 比最优价还优：我是第一个

  return levels.at(-1)!.qty        // 比 20 档最深还深：用最深档兜底，标记 estimated
}
```

最后一种情况在订单上打 `queueEstimated = true`。一旦后续盘口更新让该价位进入可见 20 档，用真实值重新校准。

> **已定（设计缺口 #20，第 06 讲）**：上面的伪代码把"可见范围内、但落在两档之间的空价位"也归进了最深档兜底。depth20 给的是前 20 个非空价位，范围内缺的价位就是 0 量——前方没人，`queueAhead = 0` 且不算估算。只有比可见最深一档还深，才用最深档兜底。实现见 `packages/engine/src/queue.ts`。

**用成交流消耗队列**

先弄清 `m` 字段：

| `m` | 含义 | 消耗谁的队列 |
| --- | --- | --- |
| `true` | 买方是 Maker，主动方在**卖** | **买方队列** |
| `false` | 卖方是 Maker，主动方在**买** | **卖方队列** |

所以：**我的买单只被 `m === true` 的成交推进，我的卖单只被 `m === false` 的成交推进。** 弄反了会导致订单在完全不该成交的时候成交。

```ts
function consume(order: Order, trade: AggTrade): Fill | null {
  const consumesMyQueue = order.side === 'BUY' ? trade.buyerIsMaker : !trade.buyerIsMaker
  if (!consumesMyQueue) return null

  const remaining = order.qty - order.executedQty

  // ① 成交价比我的挂单价"更优" → 那是别人的队列，与我无关
  const better = order.side === 'BUY' ? trade.price > order.price : trade.price < order.price
  if (better) return null

  // ② 价格穿透我了 → 我这个价位已被吃光，剩余全部成交
  const through = order.side === 'BUY' ? trade.price < order.price : trade.price > order.price
  if (through) {
    order.queueAhead = 0n
    return { price: order.price, qty: remaining, role: 'MAKER' }
  }

  // ③ 成交正好在我的价位 → 先消耗前方队列
  if (trade.qty <= order.queueAhead) {
    order.queueAhead -= trade.qty
    return null
  }
  const fillQty = min(trade.qty - order.queueAhead, remaining)
  order.queueAhead = 0n
  return fillQty > 0n ? { price: order.price, qty: fillQty, role: 'MAKER' } : null
}
```

**成交价永远是 `order.price`，不是 `trade.price`。** 我们是 Maker——挂单方按自己的挂单价成交，这是所有订单簿的规则。

**撤单造成的队列变化**

真实队列是 FIFO，前面的人撤单我就前进。但我们看不到队列内部，只能看到该价位的**总量**。

办法是**每次盘口更新做一次夹逼**：

```ts
function reconcileQueue(order, book) {
  const levels = order.side === 'BUY' ? book.bids : book.asks
  const lvl = levels.find(l => l.price === order.price)

  if (!lvl) { order.queueAhead = 0n; return }       // 该价位消失：被吃光或全撤 → 我排第一
  if (order.queueAhead > lvl.qty) order.queueAhead = lvl.qty   // 前方量不可能超过总量
}
```

> **已定（设计缺口 #20，第 06 讲）**：上面的 `if (!lvl) { order.queueAhead = 0n }` 只在挂单价**仍在可见范围内**时成立。价格往反方向跑远、挂单掉出 20 档视野时也找不到这一档，那时归零等于把用户排到队首——所以掉出视野时**保持不动**。另外估算过的单进入可见范围时直接换成真实值（哪怕更大），不取 min。排队位置的变化不发事件（缺口 #21）。

假设是：**撤单默认发生在我后面**（`queueAhead` 只被成交减少），但**总量夹逼**会在前方确实有人撤时纠正回来。

为什么这么设计：真实情况里撤单可能在我前面也可能在我后面。假设都在我前面，模拟盘会让成交比现实容易，那是骗人；假设都在我后面则偏保守。**保守 + 总量夹逼**是两者之间最诚实的折中——不高估成交，也不会因为不夹逼而让你永远排队尾。

**完整算例**

BTCUSDT，在 **49,900** 挂买单 **0.5 BTC**，下单时该价位盘口显示 **3.0 BTC**。

| 时刻 | 收到 | 处理 | queueAhead | 成交 |
| --- | --- | --- | --- | --- |
| T0 | 下单 | 初始化 | 3.0 | — |
| T1 | trade @49,900 qty 1.2 m=true | 消耗 | 1.8 | — |
| T2 | depth：该档只剩 1.5 | 夹逼 min(1.8, 1.5) | 1.5 | — |
| T3 | trade @49,900 qty 0.8 m=true | 消耗 | 0.7 | — |
| T4 | trade @49,900 qty 2.0 m=true | 0.7 用完，剩 1.3 给我 → 只成交 0.5 | 0 | **0.5 @ 49,900** ✓ |

订单 FILLED，Maker 费 = `49,900 × 0.5 × 0.02% = 4.99 USDT`

穿透场景：如果 T4 收到的是 `trade @49,880 m=true`，说明 49,900 这档已被吃光，剩余 0.5 BTC **立刻全部成交在 49,900**。

---

## 6. 引擎：下单校验链

**顺序不能调换**，前面的校验是后面的前提。任何一步失败立刻返回，带明确错误码。

| # | 校验 | 错误码 |
| --- | --- | --- |
| 1 | 币对存在且 `status = TRADING` 且 `enabled` | `SYMBOL_NOT_TRADING` |
| 2 | 行情就绪（有盘口、有标记价） | `MARKET_NOT_READY` |
| 3 | 参数组合合法（type / tif / price / stopPrice 的搭配） | `INVALID_PARAMS` |
| 4 | 持仓模式匹配（HEDGE 必须传 LONG/SHORT，ONE_WAY 必须传 BOTH） | `POSITION_SIDE_MISMATCH` |
| 5 | 价格是 `tickSize` 整数倍、数量是 `stepSize` 整数倍 | `PRICE_FILTER` / `LOT_SIZE` |
| 6 | `qty ≥ minQty`，名义价值 `≥ minNotional` | `MIN_NOTIONAL` |
| 7 | 限价偏离保护：委托价与标记价偏离不超过 ±5% | `PERCENT_PRICE` |
| 8 | `reduceOnly`：存在对应仓位，且数量不超过仓位剩余 | `REDUCE_ONLY_REJECTED` |
| 9 | 杠杆分层：成交后名义价值所在层允许当前杠杆 | `LEVERAGE_TOO_HIGH` |
| 10 | 可用余额 ≥ 所需起始保证金 + 预留 Taker 手续费（第 05 讲按币安加上开仓亏损，缺口 #14） | `INSUFFICIENT_MARGIN` |
| 11 | 市价单数量 ≤ 对手方可见深度 × 50% | `MARKET_ORDER_TOO_LARGE` |
| 12 | `GTX`：该单会立刻成交则拒 | `POST_ONLY_REJECTED` |
| 13 | 账户挂单数 ≤ 200 | `TOO_MANY_ORDERS` |

> **已定（第 04 讲实现时补充的规则）**：表格没写清的几处，实现和理由见 `docs/tutorial/04-order-validation.md` 第 5 节。
>
> - **第 5 条**（按币安）：价格在 `[minPrice, maxPrice]` 内且 `(价格 − minPrice)` 对齐 `tickSize`，触发价同样查；数量在 `[minQty, maxQty]` 内且对齐 `stepSize`，市价单改用 `MARKET_LOT_SIZE`（BTCUSDT 市价单最多 120）。最小数量从第 6 条挪到这里，报 `LOT_SIZE`（币安 `-4004`）。规则全部按币对从 `exchangeInfo` 读，数据库待加列见 `03-database-design.md` 的 `symbols` 一节
> - **第 6 条**（和币安 `-4164` 一致）：只查最小名义价值。减仓类订单（`reduceOnly`、`closePosition`、双向模式下的 `SELL + LONG` / `BUY + SHORT`）不查——价格跌下去之后，剩下的小仓位必须能平掉
> - **第 3 条**（按币安）：双向持仓模式下不能传 `reduceOnly`（币安接口说明 "Cannot be sent in Hedge Mode"，传 `false` 也算传了）；`closePosition` 不能用在开仓方向（`BUY + LONG` / `SELL + SHORT`）；多传不需要的参数一律拒（币安 `-1106`）
> - **第 7 条**（按币安）：以**标记价**为基准。限价单查委托价（币安 `-4016` / `-4024`），**市价单查对手方最优价**（币安 `-4131`）；止损限价 / 止盈限价的委托价在触发时才查（第 09 讲）。上下限按币对配置（`PERCENT_PRICE.multiplierUp` / `multiplierDown`，BTCUSDT 1.05 / 0.95），表格里的"±5%"只是 BTCUSDT 的值
> - **第 8 条**：双向模式下 `SELL + LONG` / `BUY + SHORT` 本身就是减仓，数量不能超过仓位（"双向模式禁止反手"，币安 `-2022`）
> - **第 9 条**："成交后名义价值" = 同方向现有仓位（按标记价）+ **同方向其它会开仓的挂单**（未成交部分 × 委托价）+ 本单开仓部分。不算挂单的话，拆成多张小单就能绕过分层。超出分层表最后一层上限也报 `LEVERAGE_TOO_HIGH`
> - **第 9、10 条**：只对"开仓部分"检查；未触发的触发单跳过（触发时再校验）。市价单所需保证金按盘口逐档估算、手续费逐档向上取整，不按标记价估
> - **第 10 条**：其它币对的全仓仓位缺标记价、算不出可用余额时，报 `MARKET_NOT_READY`，不拿 0 顶替
> - **第 12 条**：见第 3 节状态机下方缺口 #13 的说明
> - **第 13 条**（按币安 `MAX_NUM_ORDERS`，用户 2026-09-17 定）：**每个币对**分别计数，普通挂单和触发单一起算，BTCUSDT 上限 200。只有会留在挂单簿里的订单受限（GTC / GTX 限价单、触发单）；市价、IOC、FOK 不受限——挂满了也要能市价平仓（这一点是我们的判断，币安文档没写）

**为什么第 9 条必须在第 10 条之前**：杠杆决定需要多少保证金。先查余额再查杠杆，会出现"余额够但杠杆不允许"时给出误导性的错误提示。

**第 7 条是我们自己加的保护**：模拟盘里用户容易挂一个 1 USDT 的 BTC 买单试探系统，这种单永远不会成交却一直占着挂单位。±5% 和币安的价格保护逻辑同源。

**第 9 条的行为**（和币安不同）：

```ts
function checkLeverage(symbol, afterNotional, leverageNum) {
  const b = findBracket(symbol, afterNotional)
  if (leverageNum > b.maxLeverage) {
    return reject(`当前杠杆 ${leverageNum}x 下，${symbol} 最大可开名义价值 ${maxNotionalFor(symbol, leverageNum)} USDT`)
  }
}
```

币安会自动降杠杆，**我们直接拒单并给出明确提示**。

> **更正（2026-09-17 核对币安文档）**：币安下单时同样直接拒单，错误码 `-2027 MAX_LEVERAGE_RATIO`（"Exceeded the maximum allowable position at current leverage."），并不会自动降杠杆。我们和币安一样拒单，区别只是提示里多给了"当前杠杆下最大可开多少"。
理由：自动降杠杆会悄悄改变用户的强平价，模拟盘里这种背着用户动手的行为比拒单更糟。

---

## 7. 引擎：触发单

### 触发判定

```ts
// 默认用标记价触发（workingType = MARK_PRICE，与币安默认一致）
// ⚠️ 已定（2026-09-17，缺口 #17）：币安条件单接口的 workingType 默认是 CONTRACT_PRICE，上面"与币安默认一致"不对。
//    按币安标准改为默认 CONTRACT_PRICE（第 04 讲已实现）；用户仍可显式选 MARK_PRICE
function shouldTrigger(order, markPrice): boolean {
  switch (order.type) {
    case 'STOP':
    case 'STOP_MARKET':
      // 止损：买单在价格涨上去时触发，卖单在价格跌下来时触发
      return order.side === 'BUY' ? markPrice >= order.stopPrice! : markPrice <= order.stopPrice!
    case 'TAKE_PROFIT':
    case 'TAKE_PROFIT_MARKET':
      // 止盈：方向相反
      return order.side === 'BUY' ? markPrice <= order.stopPrice! : markPrice >= order.stopPrice!
  }
}
```

记住这个直觉：**止损是"价格朝我不利的方向走到某点就认输"，止盈是"价格朝我有利的方向走到某点就落袋"**。

方向搞反是最常见的 bug，测试时四种组合（止损买/止损卖/止盈买/止盈卖）都要覆盖。

### 触发后

```
STOP / TAKE_PROFIT                 → 以 order.price 挂限价单，走第 5 节流程
STOP_MARKET / TAKE_PROFIT_MARKET   → 立即走第 5.3 节逐档吃单
```

触发瞬间**才做保证金校验**。失败（余额不够、吃穿深度）→ 转 `EXPIRED`，记录原因并推送通知。

### `closePosition = true`

触发时按**当时的全部仓位数量**平仓，不用预设数量。这类单天然是 `reduceOnly`，不冻结保证金。

> **已定（第 09 讲，按币安 New Algo Order 接口说明核对）**：
> 1. **价格类型**：`MARK_PRICE` 单在标记价推送时检查，`CONTRACT_PRICE`（默认）单在行情成交推送时检查——上面伪代码只写了标记价
> 2. **下单时**（校验链第 14 步）：触发价已经被穿过 → 拒单 `WOULD_IMMEDIATELY_TRIGGER`（缺口 #15，币安 -2021）；未触发的条件单所有币对合计最多 200 张（币安 2025-12-29 更新日志，-4045）
> 3. **触发时**：转成 MARKET / LIMIT 请求**重新走整条校验链**。不通过时，GTX 会吃单 → `EXPIRED`（缺口 #13）；其它（保证金不足、深度不够、没仓位可减）→ **`REJECTED`**，不是上面写的 `EXPIRED`（币安条件单状态 REJECTED："denied by the matching engine, such as in scenarios of margin check failures"）
> 4. **顺序**：标记价推送时先检查触发单、再跑风控——止损单就是为了抢在强平之前平仓
> 5. 触发后沿用同一张订单（`triggered = true`、类型仍是 STOP…），不像币安那样新开一张普通单
> 6. 没实现：`priceProtect`（币安默认 false）、止损限价单委托价相对触发价的上下限（-4183 / -4184）、`TRAILING_STOP_MARKET`
> 实现 `packages/engine/src/triggers.ts`，讲义 `docs/tutorial/09-trigger-orders.md`。

---

## 8. 引擎：风控与强平

### 检测时机

每次这三种情况后都跑风控扫描：markPrice 更新后、成交后、资金费结算后。

```ts
// 全仓：整个账户一起判
crossMaintMargin = Σ maintMargin(全仓仓位)
marginBalance    = walletBalance + Σ unrealizedPnl(所有仓位)
if (marginBalance <= crossMaintMargin) → 全仓强平

// 逐仓：每个仓位单独判
positionEquity = isolatedMargin + unrealizedPnl(该仓位)
if (positionEquity <= maintMargin(该仓位)) → 该仓位强平
```

### 执行流程

```
【逐仓强平】
1. 撤销该账户在该币对该 positionSide 上的所有挂单
2. 按标记价平掉该仓位，算已实现盈亏
3. 收清算费 = 名义价值 × 0.5%（可配置）
4. 结算：余额 = isolatedMargin + 已实现盈亏 − 清算费
        余额 > 0 → 退回 walletBalance
        余额 ≤ 0 → 归零，不倒扣钱包（这就是逐仓的损失上限）
5. 写 liquidation 记录 + 对应流水

【全仓强平】
1. 撤销该账户的所有挂单
2. 按标记价平掉所有全仓仓位（逐仓仓位不动）
3. 逐仓位收清算费
4. 结算后 walletBalance < 0 → 归零（模拟盘不做穿仓追偿）
5. 写 liquidation 记录 + 流水 + 推送强平通知
```

**为什么先撤单再平仓**：挂单占着冻结保证金。不先撤，平仓后算出来的可用余额是错的，而且残留的挂单可能在下一个 tick 立刻又开出新仓。

**为什么单收清算费**：币安把清算成本包在 MMR 里，穿仓部分由保险基金承担。我们不做保险基金，所以显式收一笔 0.5%，让"爆仓比自己平仓亏得多"这件事在模拟盘里也成立——这正是强平最重要的教学点。

> **已定（第 07 讲，按币安核对后改了上面四处）**，依据币安 FAQ "Binance Futures Liquidation Protocols"（2026-01-04 更新）、"What Is Auto-Deleveraging (ADL)"（2026-01-13 更新）、`GET /fapi/v1/exchangeInfo`（2026-09-17）：
>
> 1. **全仓权益要减逐仓保证金**：上面伪代码的 `marginBalance = walletBalance + Σ unrealizedPnl(所有仓位)` 是在"逐仓保证金从钱包扣出去"的假设下写的。缺口 #6 定了逐仓保证金留在钱包里，所以全仓判定用 `全仓钱包余额（钱包 − Σ 逐仓保证金）+ Σ 全仓仓位的未实现盈亏 ≤ Σ 全仓仓位维持保证金`，和币安 `crossWalletBalance + crossUnPnl` 一致
> 2. **撤单范围按币安**：全仓撤账户所有挂单；逐仓撤账户在**这个币对**上的所有挂单（不只是同一个 positionSide）。状态是 `EXPIRED`，不是 `CANCELED`（币安订单到期原因 5 "Order has expired when the account was liquidated"）
> 3. **不按标记价平仓**（用户 2026-09-17 定）：币安的强平单是限价 = 破产价的 IOC 单，打进市场；吃不完的部分是"破产仓位"，由保险基金按破产价接管。我们让强平单逐档吃可见盘口，比破产价差的档位不吃，剩余按破产价平掉——对用户来说结果和币安一致。不做币安"保证金够了就停"的部分强平，整个仓位一次平掉
> 4. **清算费不是 0.5%**：币安本身就单收清算费（"Liquidation Clearance Fee"），费率按币对放在 exchangeInfo 的 `liquidationFee` 里（BTCUSDT 1.25%、SOLUSDT 1.5%）。按成交的名义价值（数量 × 成交价，币安 FAQ "What Fees are Generated in Binance Futures Trading?"）收，最多收到这个仓位剩下的资产为止（币安：小仓位的维持保证金率低于清算费率时会变成破产仓位）；有剩余被按破产价接管（破产仓位）时不收。上面"币安把清算成本包在 MMR 里"的说法不对
> 5. 强平单是一张 `type = LIQUIDATION` 的订单（币安同样有这个订单类型，`clientOrderId` 以 `autoclose-` 开头），`fills.order_id` 引用它（缺口 #7）
> 6. **强平成交也收交易手续费**（用户定；币安 Commission Fee "Incurred every time an order is executed"），吃盘口的每笔按 Taker 收，按破产价接管的部分不收。扣费顺序：已实现盈亏 → 交易手续费 → 清算费，每一项最多扣到剩余资产为 0。流水：已实现盈亏记 `LIQUIDATION`，手续费记 `FEE`（引用成交），清算费记 `LIQUIDATION_FEE`
>
> 实现见 `packages/engine/src/risk.ts`，讲义 `docs/tutorial/07-risk-liquidation.md`。

---

## 9. 引擎：资金费

```ts
// 结算时间来自 markPrice 流的 T 字段，不要自己算本地整点
function scheduleNext(symbol, nextFundingTs) {
  setTimeout(() => settleFunding(symbol), max(nextFundingTs - Date.now(), 0))
}

function settleFunding(symbol) {
  const { fundingRate, markPrice } = markPriceStore.get(symbol)
  for (const pos of allPositionsOf(symbol)) {
    if (pos.qty === 0n) continue
    const amount = fundingFee(pos, fundingRate, markPrice)
    walletBalance(pos.accountId) += amount
    writeLedger({ type: 'FUNDING', amount, ... })
  }
  riskScanAll(symbol)          // ★ 扣费后可能有人被推过强平线
  scheduleNext(symbol, nextTs)
}
```

三个必须注意的点：

1. **用结算那一刻的费率和标记价**，不是提前缓存的值
2. **结算后立刻跑风控扫描**——一笔资金费足以把高杠杆仓位推过强平线，真实交易里经常发生
3. 定时器要处理进程重启：启动时从 markPrice 流拿 `T` 重新排期，不依赖任何持久化的定时器状态

> **已定（第 08 讲，按币安核对）**：引擎输入 `settleFunding` 带上结算那一刻的费率和标记价，定时器留在宿主（第 11 讲）。
> - 公式和上面一致（币安 FAQ "Introduction to Binance Futures Funding Rates"：名义价值 = 标记价 × 数量）
> - **逐仓仓位的资金费从逐仓保证金里付**：钱包余额和 `isolatedMargin` 一起变（币安用户数据流：资金费发生在逐仓仓位上时推送那个仓位的 isolated wallet）；全仓只动钱包
> - 每条资金费一条 `FUNDING` 流水 + 一条 `fundingPaid` 事件；金额为 0 不记
> - 结算后对付了钱的账户跑 `riskScan`
> - 间隔按币对设置（默认 8 小时），费率有上下限，都以币安推送为准
> 实现 `packages/engine/src/funding.ts`，讲义 `docs/tutorial/08-funding-account-ops.md`。

> 注意：`setTimeout` 在宿主层（`funding-scheduler.ts`），不在引擎里。引擎只接收 `{ t: 'settleFunding' }` 输入事件。

---

## 10. 引擎宿主

宿主把纯引擎接到真实世界。它做三件事：**喂事件、落库、推送**。

```ts
class EngineHost {
  private engine: Engine

  private async handle(input: EngineInput) {
    const events = this.engine.apply(input)   // 同步纯函数
    try {
      await this.persist(events)              // 分流落库（资金类同步事务）
      this.engine.commit()
    } catch (err) {
      this.engine.rollback()                  // 只撤本次改动，O(改动数)
      throw err                               // 告警；不推送
    }
    this.broadcast(events)                    // 落库成功才推前端
  }
  // ⚠️ handle 必须串行执行（一个输入队列，前一个 await 完再取下一个）。
  //    落库是异步的，如果并发调用，下一个 apply 会撞上"上一次还没 commit/rollback"直接抛错——
  //    这正是引擎故意设的保险：并发喂输入会让回滚撤错东西。
}
```

### 事件分流

```
┌── 同步写，必须在一个事务里 ──────────────────────────┐
│  balanceUpdate + fill + orderUpdate + positionUpdate  │
│  + ledger                                             │
│  → 一笔成交带来的所有变更，要么全成要么全不成           │
│  → 写失败则回滚内存状态并告警                          │
└──────────────────────────────────────────────────────┘

┌── 异步批量写（攒 200ms 或 50 条）────────────────────┐
│  纯挂单状态变化（下单成功、撤单）                       │
│  → 不涉及资金，晚一点写没有正确性问题                   │
└──────────────────────────────────────────────────────┘

┌── 定时写 ───────────────────────────────────────────┐
│  每日 UTC 00:00 的 equity_snapshots                  │
└──────────────────────────────────────────────────────┘
```

> 上面"写失败则回滚内存状态"**不要**用每次 `apply` 前调 `engine.snapshot()` 的方式实现——那是 O(全体账户) 的深拷贝。用引擎内 undo 日志 + `commit()` / `rollback()`，详见 `02-architecture.md` 第七节"回滚怎么做"。

### 重启恢复

```
1. 读 accounts → 余额
2. 读 positions（qty > 0）→ 仓位
   ⚠️ 已定（缺口 #12）：数据库按币安标准存带符号数量，条件是 position_amt <> 0，
      读出来后转成引擎的 LONG / SHORT + 非负 qty
3. 读 orders（status IN ('NEW','PARTIALLY_FILLED')）→ 挂单
4. queueAhead 的处理：
   ⚠️ 不能直接用库里的旧值——停机期间盘口早变了
   → 重置为"当前该价位的挂单总量"（保守：假设自己排在最后）
5. 用当前标记价重算所有仓位的未实现盈亏和强平价
6. 立刻跑一轮全账户风控扫描：停机期间已经该强平的，现在补上
```

第 4 步会让用户的老单成交慢一点，但不会凭空给他优势。**做模拟盘时每个这种选择都要往保守的方向倒。**

第 6 步很重要：服务停了 10 分钟而价格暴跌，恢复后必须按当前标记价判定强平，不能装作无事发生。

---

## 11. REST 接口

Base URL：`https://api.<域名>`

### 通用约定

**响应包络**

```jsonc
{ "ok": true,  "data": { /* ... */ } }
{ "ok": false, "error": { "code": "INSUFFICIENT_MARGIN", "message": "可用余额不足，需要 5025.00 USDT，当前 3200.00 USDT" } }
```

`message` 是**给用户直接看的中文**，前端不做二次翻译。

**数值一律字符串**：`"50000.25"`。原因见 `02-architecture.md` 第五节。

**鉴权**：`Authorization: Bearer <jwt>`，载荷 `{ sub: accountId, addr, chain, iat, exp }`，有效期 7 天。

**分页**：游标分页，不用 offset。

```
GET /account/fills?limit=50&cursor=<上一页最后一条的 id>
→ { "ok": true, "data": { "items": [...], "nextCursor": "uuid-or-null" } }
```

**限流**

| 范围 | 限制 |
| --- | --- |
| 公共接口（按 IP） | 60 次 / 分钟 |
| 私有查询（按账户） | 120 次 / 分钟 |
| 下单 / 撤单（按账户） | **20 次 / 10 秒** |

下单限流单独设紧是必要的：模拟盘没有真实成本，很容易有人写脚本疯狂下单把引擎打满。

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/nonce` | 钱包登录：请求待签名文本 |
| POST | `/auth/verify` | 钱包登录：提交签名，换 JWT |
| POST | `/auth/email/code` | 邮箱登录：发送 6 位验证码 |
| POST | `/auth/email/verify` | 邮箱登录：提交验证码，换 JWT |
| GET | `/auth/google` | Google 登录：302 跳转到 Google 授权页 |
| GET | `/auth/google/callback` | Google 登录：换 token，重定向回前端并带上 JWT |
| GET | `/auth/me` | 校验登录态（三种登录方式通用） |

```jsonc
// POST /auth/nonce  请求
{ "address": "0xAbC...", "chain": "evm" }
// 响应
{ "ok": true, "data": {
  "nonce": "a1b2c3d4e5f6",
  "message": "binance-sim.example.com wants you to sign in with your Ethereum account:\n0xAbC...\n\n登录币安合约模拟交易平台\n\nURI: https://...\nVersion: 1\nChain ID: 1\nNonce: a1b2c3d4e5f6\nIssued At: 2026-09-15T08:00:00Z",
  "expiresAt": 1789344300000
}}

// POST /auth/verify  请求
{ "address": "0xAbC...", "chain": "evm", "nonce": "a1b2c3d4e5f6", "signature": "0x..." }
// 响应
{ "ok": true, "data": {
  "token": "eyJhbGciOi...",
  "account": { "id": "uuid", "isNew": true }
}}

// POST /auth/email/code  请求
{ "email": "a@b.com" }
// 响应
{ "ok": true, "data": { "expiresAt": 1789344300000 } }

// POST /auth/email/verify  请求
{ "email": "a@b.com", "code": "482913" }
// 响应
{ "ok": true, "data": {
  "token": "eyJhbGciOi...",
  "account": { "id": "uuid", "isNew": true }
}}
```

`GET /auth/google` 和 `/auth/google/callback` 是重定向流程，不是 JSON 接口，见下面的登录流程说明。

**三种登录方式最终都收敛到同一步**：拿到一个 `(provider, providerId)`，去 `identities` 表查账户；查不到就新建账户 + 新建 identity + 发放 10,000 USDT（写一条 `INITIAL` 流水）；最后签发**同一套** JWT。差异只在"怎么证明你拥有这个 providerId"。

#### 钱包（SIWE / SIWS）

```
1. 按 nonce 取出原始 message，校验未过期、未使用
2. EVM：viem 的 verifyMessage 恢复地址并比对（小写归一化）
   Solana：tweetnacl 的 sign.detached.verify 验证 ed25519 签名
3. 标记 nonce 已使用
4. provider = wallet_evm / wallet_solana，providerId = 归一化后的地址 → 查/建账户
5. 签发 JWT
```

> ⚠️ **验签必须用第 1 步取出的原始 message**，不能用客户端重新传上来的文本——否则攻击者可以让你去验一段他自己构造的内容。

#### 邮箱验证码

```
1. /auth/email/code：生成 6 位数字码，sha256 哈希后连同 5 分钟过期时间存 email_verification_codes，明文只通过邮件发出去，不落库、不回响应体
2. /auth/email/verify：按 email 取最近一条未过期未使用的记录，比对哈希；5 次不中 → 作废该记录（EMAIL_CODE_TOO_MANY_ATTEMPTS）
3. 校验通过，标记该记录已使用
4. provider = email，providerId = 小写邮箱 → 查/建账户
5. 签发 JWT
```

发信走事务性邮件 API（如 Resend），不自建 SMTP——量小、免费额度够用，也省得踩发信域名 SPF/DKIM 的坑。

#### Google（OAuth2 Authorization Code + PKCE）

```
1. GET /auth/google：生成 state + PKCE verifier，写进短期 httpOnly cookie，302 跳转 Google 授权页
2. Google 回调 GET /auth/google/callback?code=&state=
3. 校验 state 与 cookie 一致（不一致 → OAUTH_STATE_MISMATCH），用 arctic 拿 code 换 access_token
4. 用 access_token 查 Google userinfo，取 sub（Google 用户唯一 id，不用 email——email 允许换绑）
5. provider = google，providerId = sub → 查/建账户
6. 签发 JWT，302 重定向回 `${WEB_ORIGIN}/login/callback#token=...`
   ★ 用 URL fragment（#）不用 query string：fragment 不会发到服务端、不进访问日志、不进 Referer 头
7. 前端在 /login/callback 里从 location.hash 取 token 存下来，随后清掉 URL
```

只用 `arctic`（纯 OAuth2 客户端库）拿 token、查 userinfo，**不引入管 session/cookie 的完整认证框架**——JWT 的签发、校验、WS 鉴权全部复用钱包登录已有的那一套。三种登录方式共用一条会话链路，不会出现"网页一套登录态、接口一套登录态"的分裂，`apps/native` 以后要接的时候也只用认一种 token 格式。

### 行情（公共）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/market/symbols` | 开放交易的币对及规格 |
| GET | `/market/ticker?symbol=` | 最新价、标记价、涨跌幅、资金费率 |
| GET | `/market/depth?symbol=` | 20 档盘口（首屏用，之后走 WS） |
| GET | `/market/klines?symbol=&interval=&limit=` | K 线（服务端代理币安并缓存） |
| GET | `/market/funding-history?symbol=&limit=` | 历史资金费率 |
| GET | `/market/status` | 行情服务状态 |

```jsonc
// GET /market/ticker?symbol=BTCUSDT
{ "ok": true, "data": {
  "symbol": "BTCUSDT",
  "lastPrice": "50123.40", "markPrice": "50120.15", "indexPrice": "50118.90",
  "priceChangePercent": "2.34",
  "high24h": "51000.00", "low24h": "49000.00", "volume24h": "123456.789",
  "fundingRate": "0.00010000", "nextFundingTime": 1789363200000
}}

// GET /market/status
{ "ok": true, "data": { "status": "normal", "feedConnected": true, "matchingEnabled": true, "lastTradeTs": 1789344000000 } }
```

### 账户（需鉴权）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/account` | 余额、权益、保证金率 |
| GET | `/account/positions` | 仓位列表 |
| GET | `/account/orders?status=open\|history` | 订单 |
| GET | `/account/fills` | 成交历史 |
| GET | `/account/ledger?type=` | 资金流水 |
| GET | `/account/funding` | 资金费明细 |
| GET | `/account/liquidations` | 强平记录 |
| GET | `/account/equity-curve?days=30` | 权益曲线 |
| POST | `/account/reset` | 重置账户 |
| POST | `/account/position-mode` | 切换单向/双向 |
| POST | `/account/nickname` | 排行榜显示名 |

```jsonc
// GET /account
{ "ok": true, "data": {
  "walletBalance":      "9975.00",
  "unrealizedPnl":      "1000.00",
  "marginBalance":      "10975.00",
  "availableBalance":   "4975.00",
  "totalInitialMargin": "5000.00",
  "totalMaintMargin":   "200.00",
  "marginRatio":        "0.0182",
  "positionMode":       "ONE_WAY",
  "canReset":           true,
  "resetAvailableAt":   null
}}

// GET /account/positions
{ "ok": true, "data": [{
  "symbol": "BTCUSDT", "positionSide": "LONG", "marginMode": "ISOLATED", "leverage": 10,
  "qty": "1.000", "entryPrice": "50000.00", "markPrice": "51000.00",
  "notional": "51000.00", "isolatedMargin": "5000.00",
  "unrealizedPnl": "1000.00", "roe": "0.2000",
  "liquidationPrice": "45180.72", "maintMargin": "204.00",
  "openedAt": 1789340000000
}]}
```

> `liquidationPrice` 由**服务端算好返回**，前端不自己算。两处算法一旦漂移，用户看到的强平价和实际执行的就不一样了。

### 交易（需鉴权）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/orders` | 下单 |
| DELETE | `/orders/:id` | 撤单 |
| DELETE | `/orders?symbol=` | 按币对全撤 |
| POST | `/positions/leverage` | 调整杠杆 |
| POST | `/positions/margin-mode` | 切换全仓/逐仓 |
| POST | `/positions/isolated-margin` | 逐仓加减保证金 |
| POST | `/positions/close` | 一键平仓 |

```jsonc
// 限价开多
{ "clientOrderId": "c-1726387200-001", "symbol": "BTCUSDT",
  "side": "BUY", "positionSide": "LONG", "type": "LIMIT",
  "timeInForce": "GTC", "price": "49900.0", "qty": "0.5", "reduceOnly": false }

// 市价平多（双向持仓模式：SELL + LONG 本身就是平多。按币安标准不能再传 reduceOnly，见第 6 节第 3 条的已定说明）
{ "clientOrderId": "c-...-002", "symbol": "BTCUSDT",
  "side": "SELL", "positionSide": "LONG", "type": "MARKET",
  "qty": "0.5" }

// 止损市价全平
{ "clientOrderId": "c-...-003", "symbol": "BTCUSDT",
  "side": "SELL", "positionSide": "LONG", "type": "STOP_MARKET",
  "stopPrice": "48000.0", "closePosition": true, "workingType": "MARK_PRICE" }
```

响应：

```jsonc
{ "ok": true, "data": {
  "id": "uuid", "clientOrderId": "c-...-001", "status": "NEW",
  "symbol": "BTCUSDT", "side": "BUY", "positionSide": "LONG", "type": "LIMIT",
  "price": "49900.0", "qty": "0.5", "executedQty": "0", "avgPrice": "0",
  "queueAhead": "3.000", "frozenMargin": "2495.00", "createdAt": 1789344000000
}}
```

> `queueAhead` 返回给前端是刻意的：挂单列表里显示"前方排队约 3.0 BTC"，这是这个模拟盘区别于玩具的地方，**要让用户看见**。

**幂等**：相同 `(accountId, clientOrderId)` 重复提交返回已存在的那张单，不重复下单。

**参数组合速查**

| type | 必填 | 可选 |
| --- | --- | --- |
| `LIMIT` | `price`, `qty`, `timeInForce` | `reduceOnly` |
| `MARKET` | `qty` | `reduceOnly` |
| `STOP` / `TAKE_PROFIT` | `stopPrice`, `price`, `qty` | `workingType`, `reduceOnly` |
| `STOP_MARKET` / `TAKE_PROFIT_MARKET` | `stopPrice`, `qty` 或 `closePosition` | `workingType` |

**其他交易接口的约束**

| 接口 | 约束 |
| --- | --- |
| 调整杠杆 | 有持仓时允许，但调整后若保证金不足或跨到不允许的分层 → `LEVERAGE_TOO_HIGH` |
| 切换保证金模式 | 该币对**有持仓或挂单时禁止** → `MARGIN_MODE_LOCKED` |
| 切换持仓模式 | **有任何持仓或挂单时禁止** → `POSITION_MODE_LOCKED` |
| 逐仓减保证金 | 减完后保证金率不能 ≥ 100% → `MARGIN_WOULD_LIQUIDATE` |

### 排行榜

```
GET /leaderboard?period=daily|weekly|all&limit=100
→ [{ "rank": 1, "nickname": "0xAb...C3", "roi": "1.2340",
     "equity": "22340.00", "winRate": "0.6500", "tradeCount": 128 }]
```

无需鉴权；带 token 时额外返回 `myRank`。

### 账户重置

```
前提：距离上次重置 ≥ 24 小时
动作（一个事务）：
  1. 撤销所有挂单
  2. 按当前标记价平掉所有仓位（记为 realized PnL，走正常流水）
  3. walletBalance 设为 10,000
  4. 写一条 type = 'RESET' 的流水，记录重置前的权益
  5. lastResetAt = now
```

第 2 步为什么不直接清零而要走平仓：这样**资金流水始终自洽**——任意时刻的钱包余额都等于所有流水之和。这个不变式是排查账目问题的唯一抓手，不能为了省事破坏它。

> **已定（第 08 讲）**：引擎的 `resetAccount` 做第 1～4 步（撤单 `CANCELED`、按标记价平仓不收手续费、`REALIZED_PNL` 流水、`RESET` 流水差额补到目标金额，哪怕差额为 0 也写）；第 5 步和 24 小时冷却（`RESET_COOLING_DOWN`）由宿主查 `accounts.last_reset_at`，引擎不看钟。持仓模式和杠杆设置保留。
>
> **调杠杆 / 切保证金模式 / 切持仓模式 / 调逐仓保证金**（`POST /positions/leverage`、`/positions/margin-mode`、`/account/position-mode`、`/positions/isolated-margin`）的规则按币安核对，见 `07-binance-reference.md` 第 9 节，实现 `packages/engine/src/account-ops.ts`。要点：调杠杆时仓位和挂单冻结保证金一起跟着变；逐仓有仓位不能调低杠杆；调逐仓保证金按币安"最多可加 / 可减"公式限额，**不写流水**（逐仓保证金本来就在钱包余额里，缺口 #6）。

---

## 12. WebSocket 协议

```
wss://api.<域名>/ws
```

### 消息格式

客户端 → 服务端：

```jsonc
{ "op": "auth",  "token": "eyJ..." }
{ "op": "sub",   "channels": ["depth:BTCUSDT", "kline:BTCUSDT:1m", "ticker:BTCUSDT", "trade:BTCUSDT"] }
{ "op": "unsub", "channels": ["trade:BTCUSDT"] }
{ "op": "pong" }
```

服务端 → 客户端：

```jsonc
{ "ch": "depth:BTCUSDT", "ts": 1789344000000, "d": { "bids": [...], "asks": [...] } }
```

### 公共频道

| 频道 | 内容 | 频率 |
| --- | --- | --- |
| `ticker:<SYMBOL>` | 最新价、标记价、涨跌幅、资金费率 | 1s |
| `depth:<SYMBOL>` | 20 档盘口快照 | 100ms |
| `trade:<SYMBOL>` | 最新成交 | 实时 |
| `kline:<SYMBOL>:<interval>` | K 线更新 | 实时 |
| `market` | 行情服务状态（normal / degraded） | 状态变化时 |

### 私有频道（`auth` 后自动订阅，不用 sub）

| 频道 | 触发时机 | 载荷 |
| --- | --- | --- |
| `account` | 余额变动 | 钱包余额、可用余额、保证金率 |
| `position` | 仓位变化 | 完整仓位对象 |
| `order` | 订单状态变化 | 完整订单对象 |
| `fill` | 有成交 | 成交明细 |
| `liquidation` | 被强平 | 强平详情（前端弹窗告警） |
| `funding` | 资金费结算 | 结算明细 |

### 心跳与重连

```
服务端每 30s 发 { "op": "ping" }，客户端回 { "op": "pong" }
60s 无 pong → 服务端断开
```

**客户端重连后必须做的事**（漏了就会数据不一致）：

```
1. 重新 auth
2. 重新 sub 所有频道
3. REST 全量拉一次 /account、/account/positions、/account/orders?status=open
4. 用 REST 的结果覆盖本地状态
```

增量推送只在连接持续期间可信。**断过一次，就必须重新对齐。**

---

## 13. 错误码

`packages/shared/src/errors.ts` 的枚举必须和这张表一一对应。

### 认证

| 码 | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 缺 token 或 token 无效 |
| `TOKEN_EXPIRED` | 401 | token 过期，需重新登录 |
| `NONCE_INVALID` | 400 | nonce 不存在、已过期或已使用 |
| `SIGNATURE_INVALID` | 400 | 签名验证失败 |
| `EMAIL_CODE_INVALID` | 400 | 验证码不存在或不匹配 |
| `EMAIL_CODE_EXPIRED` | 400 | 验证码已过期或已使用 |
| `EMAIL_CODE_TOO_MANY_ATTEMPTS` | 429 | 同一条验证码错误次数超限，请重新请求 |
| `EMAIL_CODE_RATE_LIMITED` | 429 | 同一邮箱请求发码过于频繁 |
| `OAUTH_STATE_MISMATCH` | 400 | Google 回调的 state 与 cookie 不一致 |

### 下单（对应第 6 节校验链）

| 码 | HTTP | 说明 |
| --- | --- | --- |
| `SYMBOL_NOT_TRADING` | 400 | 币对不存在或未开放 |
| `MARKET_NOT_READY` | 503 | 行情未就绪，暂不接受下单 |
| `INVALID_PARAMS` | 400 | 参数组合非法 |
| `POSITION_SIDE_MISMATCH` | 400 | positionSide 与当前持仓模式不符 |
| `PRICE_FILTER` | 400 | 价格不是 tickSize 整数倍 |
| `LOT_SIZE` | 400 | 数量不是 stepSize 整数倍 |
| `MIN_NOTIONAL` | 400 | 名义价值低于下限 |
| `PERCENT_PRICE` | 400 | 委托价偏离标记价超过 ±5% |
| `REDUCE_ONLY_REJECTED` | 400 | 无对应仓位或数量超出 |
| `LEVERAGE_TOO_HIGH` | 400 | 当前杠杆在该名义价值分层下不被允许 |
| `INSUFFICIENT_MARGIN` | 400 | 可用余额不足 |
| `MARKET_ORDER_TOO_LARGE` | 400 | 市价单超出可见深度的一半 |
| `POST_ONLY_REJECTED` | 400 | GTX 单会立刻成交 |
| `TOO_MANY_ORDERS` | 429 | 挂单数超过 200 |
| `WOULD_IMMEDIATELY_TRIGGER` | 400 | 触发单的触发价下单时已经被穿过（第 09 讲加，币安 -2021） |

### 仓位与账户

| 码 | HTTP | 说明 |
| --- | --- | --- |
| `ORDER_NOT_FOUND` | 404 | 订单不存在或已终态 |
| `POSITION_NOT_FOUND` | 404 | 无对应仓位 |
| `MARGIN_MODE_LOCKED` | 409 | 有持仓/挂单，不能切换保证金模式 |
| `POSITION_MODE_LOCKED` | 409 | 有持仓/挂单，不能切换持仓模式 |
| `RESET_COOLING_DOWN` | 409 | 重置冷却中 |
| `MARGIN_WOULD_LIQUIDATE` | 400 | 减少逐仓保证金后会立刻触发强平 |

### 系统

| 码 | HTTP | 说明 |
| --- | --- | --- |
| `RATE_LIMITED` | 429 | 触发限流 |
| `INTERNAL_ERROR` | 500 | 内部错误 |
| `SERVICE_UNAVAILABLE` | 503 | 引擎未就绪（启动中或行情断开） |
