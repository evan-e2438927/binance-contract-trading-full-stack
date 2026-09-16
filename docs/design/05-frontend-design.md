# 05 · 前端子设计

> 范围：`apps/web`（Next.js 16 + React 19 + Tailwind 4 + shadcn/ui）
> 部署：Cloudflare Workers（`opennextjs-cloudflare`）
> 前置阅读：`02-architecture.md`（分层与精度）、`04-backend-design.md` 第 11–13 节（接口契约）

---

## 1. 页面与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页 | 简介 + 币对列表 + 登录入口（钱包 / 邮箱 / Google） |
| `/trade/[symbol]` | **交易主页面** | 全部交易功能都在这一页 |
| `/orders` | 历史 | 订单 / 成交 / 资金流水 / 资金费 四个 tab |
| `/leaderboard` | 排行榜 | 收益率榜 + 我的权益曲线 |
| `/rules` | 模拟规则说明 | 展示 `02-architecture.md` 第九节的失真点清单 |

`/rules` 不是可选项。用户迟早会问"为什么我的单没成交"，把规则摆出来比一次次解释便宜。

---

## 2. 交易页布局

币安式网格，桌面优先（≥1280px）：

```
┌─────────────────────────────────────────────────────────────────┐
│ 顶栏：Logo │ 币对切换 │ 最新价 涨跌 标记价 资金费/倒计时 │ 钱包 │
├──────────────────────────────┬──────────────┬───────────────────┤
│                              │              │                   │
│   K 线图                      │   盘口        │   下单面板         │
│   (lightweight-charts)       │   (20 档)     │   限价/市价/止盈止损│
│                              │              │                   │
│                              ├──────────────┤   杠杆滑块         │
│                              │              │   保证金模式        │
│                              │   最新成交    │   可用余额          │
│                              │              │   预估成本          │
├──────────────────────────────┴──────────────┤                   │
│  仓位 (2) │ 当前委托 (3) │ 历史委托 │ 成交     │                   │
│  ───────────────────────────────────────────  │                   │
│  表格区                                       │                   │
└─────────────────────────────────────────────┴───────────────────┘
```

**栅格**：`grid-template-columns: 1fr 320px 360px`，中栏和右栏固定宽。

**行情降级时**：顶栏下方插入一条黄色横幅"行情连接中断，撮合已暂停"，下单按钮禁用。

**窄屏（<1280px）**：下单面板折叠为底部抽屉，盘口和成交合并为一个可切换的 tab。不做手机端适配（第一版桌面优先）。

---

## 3. 组件树

```
app/trade/[symbol]/page.tsx
└── TradeLayout
    ├── TopBar
    │   ├── SymbolSwitcher          币对下拉 + 搜索
    │   ├── TickerStrip             最新价/涨跌/标记价/资金费倒计时
    │   └── LoginButton             登录（钱包/邮箱/Google）/ 账户菜单
    ├── MarketStatusBanner          行情降级横幅
    ├── ChartPanel
    │   ├── IntervalTabs            1m/5m/15m/1h/4h/1d
    │   └── CandleChart             lightweight-charts 封装
    ├── OrderBookPanel
    │   ├── OrderBookHeader         精度切换
    │   ├── AskRows                 卖盘 20 档（倒序）
    │   ├── SpreadRow               最新价 + 标记价
    │   └── BidRows                 买盘 20 档
    ├── RecentTrades                最新成交滚动列表
    ├── OrderFormPanel
    │   ├── MarginModeSelect        全仓/逐仓
    │   ├── LeverageSlider          1–125，受分层上限约束
    │   ├── OrderTypeTabs           限价 / 市价 / 止盈止损
    │   ├── PriceInput / QtyInput   带 tickSize / stepSize 对齐
    │   ├── QtySlider               按可用余额百分比
    │   ├── OrderOptions            reduceOnly / TIF / closePosition
    │   ├── CostPreview             预估成本 / 可开最大 / 预估强平价
    │   └── SubmitButtons           买入做多 / 卖出做空
    └── BottomTabs
        ├── PositionsTable          仓位（含一键平仓、调整保证金）
        ├── OpenOrdersTable         当前委托（含排队量列、撤单）
        ├── OrderHistoryTable
        └── FillsTable
```

---

## 4. 状态管理

用 **Zustand**，分三个 store，职责不重叠。

```
stores/
├── market-store.ts     行情：盘口、最新成交、ticker、K 线（WS 推送驱动）
├── account-store.ts    账户：余额、仓位、订单（REST 首屏 + WS 增量）
└── ui-store.ts         界面：选中币对、周期、下单面板输入、精度设置
```

### 为什么不用 React Query 管行情

行情是**推送模型**，不是请求模型。React Query 的心智是"拉取 + 缓存 + 失效"，硬套在 WebSocket 推送上会打架：缓存键失效、重复拉取、状态双写。

分工：

| 数据 | 方案 |
| --- | --- |
| 行情（盘口/成交/K线/ticker） | WS 推送 → Zustand，不进 React Query |
| 账户实时数据（余额/仓位/订单） | REST 首屏 → Zustand，之后 WS 增量更新 |
| 历史数据（成交历史/流水/排行榜） | React Query（真正的请求-缓存场景） |

### market-store 的形状

```ts
interface MarketStore {
  status: 'normal' | 'degraded'
  books:    Record<string, OrderBook>     // symbol → 20 档
  tickers:  Record<string, Ticker>
  trades:   Record<string, Trade[]>       // 环形缓冲，只保留最近 50 条
  klines:   Record<string, Candle[]>      // key: `${symbol}:${interval}`

  applyDepth(symbol: string, book: OrderBook): void
  applyTrade(symbol: string, trade: Trade): void
  applyTicker(symbol: string, ticker: Ticker): void
  applyKline(key: string, candle: Candle): void
}
```

**订阅粒度**：组件用 selector 只订自己要的那一片，避免任何一条推送导致整页重渲染。

```ts
// ✅ 只在 BTCUSDT 盘口变化时重渲染
const book = useMarketStore(s => s.books['BTCUSDT'])

// ❌ 任何币对任何数据变化都重渲染
const { books } = useMarketStore()
```

### account-store 的形状

```ts
interface AccountStore {
  account:   AccountSummary | null
  positions: Position[]
  openOrders: Order[]

  hydrate(): Promise<void>                // REST 全量拉取，覆盖本地
  applyAccountUpdate(d: AccountSummary): void
  applyPositionUpdate(p: Position): void
  applyOrderUpdate(o: Order): void
  applyFill(f: Fill): void
}
```

`hydrate()` 是**对齐机制**，三种情况必须调用：

1. 登录成功后
2. **WebSocket 重连成功后**
3. 页面从后台切回前台（`visibilitychange`）超过 30 秒

第 2 条最容易漏。增量推送只在连接持续期间可信，断过一次就必须重新对齐。

---

## 5. WebSocket 客户端

`lib/ws-client.ts` —— 单例，全局一个连接。

### 职责

```ts
class WsClient {
  connect(): void
  disconnect(): void
  subscribe(channels: string[]): void
  unsubscribe(channels: string[]): void
  setToken(token: string | null): void     // 登录/登出时调用
  on(handler: (msg: ServerMessage) => void): () => void
}
```

### 连接生命周期

```
connect()
  │
  ├─ onopen → 有 token 则发 { op: 'auth' } → 发 { op: 'sub', channels: 当前订阅集 }
  │            └─► 触发 accountStore.hydrate()   ★ 关键
  │
  ├─ onmessage → 分发到对应 store
  │
  ├─ ping → 立刻回 pong
  │
  └─ onclose / onerror
       └─ 指数退避重连：1s → 2s → 4s → 8s → 16s → 30s（封顶）
          重连成功后回到 onopen 流程
```

**订阅集要在客户端内部维护一份**，重连后自动重新订阅，调用方不需要关心。

### 切换币对时

```
unsubscribe(旧币对的 4 个频道)
subscribe(新币对的 4 个频道)
→ 同时用 REST 拉一次 /market/depth 和 /market/klines 填充首屏
```

不要只靠 WS 等第一条推送——盘口 100ms 一次还好，K 线可能要等一分钟才推一次，页面会空着。

---

## 6. 数据获取策略

### 交易页首屏

**六个请求并行发起**，不要串行：

```ts
const [symbols, depth, klines, account, positions, orders] = await Promise.allSettled([
  api.get('/market/symbols'),
  api.get(`/market/depth?symbol=${symbol}`),
  api.get(`/market/klines?symbol=${symbol}&interval=1m&limit=500`),
  // 下面三个需要登录，未登录时跳过
  api.get('/account'),
  api.get('/account/positions'),
  api.get('/account/orders?status=open'),
])
```

前三个**不依赖登录**，未登录用户也要能看行情——这是降低使用门槛的关键，让人先看到东西再决定要不要连钱包。

用 `allSettled` 而不是 `all`：账户接口失败不该让整个行情区空白。

### 更新来源对照表

| 数据 | 首屏 | 持续更新 |
| --- | --- | --- |
| 盘口 | REST `/market/depth` | WS `depth:<SYMBOL>` |
| 最新成交 | 无（等推送） | WS `trade:<SYMBOL>` |
| K 线 | REST `/market/klines` | WS `kline:<SYMBOL>:<interval>` |
| Ticker | REST `/market/ticker` | WS `ticker:<SYMBOL>` |
| 余额/保证金率 | REST `/account` | WS `account` |
| 仓位 | REST `/account/positions` | WS `position` |
| 挂单 | REST `/account/orders?status=open` | WS `order` |

---

## 7. 数值展示规范

### 一条硬规则：前端不算依赖账户全局状态的钱

| 数值 | 谁算 | 为什么 |
| --- | --- | --- |
| 强平价 | **服务端** | 依赖全账户仓位和余额；两处算法漂移会导致显示和执行不一致 |
| 保证金率 | **服务端** | 同上 |
| 可用余额 | **服务端** | 同上 |
| 未实现盈亏 / ROE | **服务端** | 依赖标记价和均价，服务端已经算过 |
| 下单预估成本 | 前端可算 | 只是 `价格 × 数量 ÷ 杠杆`，不依赖全局状态 |
| 盘口累计量条 | 前端可算 | 纯展示 |

前端能算的那两项，**必须用 `packages/shared` 的 `fixed` 函数算**，不许用原生浮点。`shared` 是同构包，前端也能 `import { mul, div, format } from '@.../shared'`，这样前后端用的是同一份实现，不会漂移。

### 格式化约定

```ts
// lib/format.ts
formatPrice(v: string, symbol: SymbolSpec): string   // 按 pricePrecision 补零
formatQty(v: string, symbol: SymbolSpec): string     // 按 quantityPrecision
formatUsdt(v: string): string                        // 千分位 + 2 位小数
formatPercent(v: string): string                     // "0.0234" → "+2.34%"
formatCountdown(ms: number): string                  // 资金费倒计时 "03:42:15"
```

**颜色约定**（币安习惯，中国区配色）：

| 含义 | 颜色 |
| --- | --- |
| 涨 / 买入 / 多头 | `#0ECB81` 绿 |
| 跌 / 卖出 / 空头 | `#F6465D` 红 |
| 中性 | `#848E9C` 灰 |

正负号必须显式：`+2.34%` / `-1.20%`，`+1,000.00` / `-1,000.00`。

---

## 8. 图表

**lightweight-charts**（TradingView 开源版）。

```ts
// components/chart/CandleChart.tsx
const chart = createChart(container, {
  layout: { background: { color: '#161A1E' }, textColor: '#848E9C' },
  grid: { vertLines: { color: '#2B3139' }, horzLines: { color: '#2B3139' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#2B3139' },
})

const candleSeries = chart.addCandlestickSeries({
  upColor: '#0ECB81', downColor: '#F6465D',
  borderVisible: false,
  wickUpColor: '#0ECB81', wickDownColor: '#F6465D',
})
```

### 三条要点

1. **首屏用 `setData()` 灌历史，之后用 `update()` 增量**。每次推送都 `setData()` 会导致整图重绘，视觉上会闪。

2. **在图上画仓位线和强平线**，用 `createPriceLine()`：

```ts
candleSeries.createPriceLine({ price: 50000, color: '#0ECB81', title: '开仓价 1.0' })
candleSeries.createPriceLine({ price: 45180.72, color: '#F6465D', title: '强平价' })
```

这是交易页最有用的一个细节——用户不用在表格和图之间来回看。

3. **图表实例在 `useEffect` 里创建，卸载时 `chart.remove()`**。切币对时不要销毁重建整个图表，只 `setData()` 换数据，否则每次切换都有明显白屏。

---

## 9. 盘口组件：性能是主要问题

盘口 100ms 更新一次，40 行（20 买 + 20 卖）。做不好会让整页掉帧。

### 三个措施

**① 更新节流到 requestAnimationFrame**

WS 100ms 推一次，但浏览器不一定按这个节奏渲染。用 rAF 合并：

```ts
let pending: OrderBook | null = null
let scheduled = false

function applyDepth(book: OrderBook) {
  pending = book
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    useMarketStore.setState({ books: { ...books, [symbol]: pending! } })
    scheduled = false
  })
}
```

**② 行组件 `memo` + 稳定 key**

用**价格**做 key，不要用数组下标。价格档位在相邻两帧之间大部分是不变的，用价格做 key 能让 React 复用绝大多数 DOM 节点。

```tsx
const BookRow = memo(function BookRow({ price, qty, total, maxTotal, side }: Props) { ... })

{book.asks.map(l => <BookRow key={l.price} {...l} />)}
```

**③ 累计量背景条用 CSS 变量，不要重算 style 对象**

```tsx
<div className="book-row" style={{ '--pct': `${pct}%` } as CSSProperties}>
```

```css
.book-row::before {
  content: ''; position: absolute; inset: 0 0 0 auto;
  width: var(--pct); background: var(--depth-bar-color);
}
```

### 交互

- **点击某一档价格** → 填入下单面板的价格输入框
- **点击某一档数量** → 填入该档及以上的累计数量
- **精度切换**（0.1 / 1 / 10）→ 前端聚合档位，不额外请求

---

## 10. 下单面板

最复杂的组件，也是出 bug 最多的地方。

### 输入校验（前端做一遍，服务端还会再做一遍）

| 输入 | 前端校验 |
| --- | --- |
| 价格 | 对齐 `tickSize`（失焦时自动吸附），偏离标记价 ±5% 时给黄色警告 |
| 数量 | 对齐 `stepSize`，不小于 `minQty`，名义价值不小于 `minNotional` |
| 杠杆 | 滑块上限 = 当前名义价值所在分层的 `maxLeverage` |

**前端校验只为即时反馈，不是安全边界。** 服务端的 13 步校验链才是。

### 预估区

```
预估成本      2,495.00 USDT      （价格 × 数量 ÷ 杠杆 + 预估手续费）
可开最大      1.234 BTC          （服务端下发的可用余额换算）
预估强平价    45,180.72          （★ 调用服务端，见下）
```

**预估强平价怎么来**：加一个接口

```
POST /orders/preview
body: { symbol, side, positionSide, price, qty, leverage, marginMode }
→ { cost, maxQty, estimatedLiqPrice, estimatedMarginRatio, warnings: [] }
```

前端对输入做 **300ms debounce** 后调用。不在前端算的理由见第 7 节。

300ms 的延迟在这里可以接受：用户改数量时看到成本立刻变（前端算），强平价慢半拍出现（服务端算），体感是顺的。

### 下单按钮

```
未登录     → "登录"
行情降级   → 禁用 + "行情中断，暂停交易"
校验不通过 → 禁用 + 具体原因
正常       → "买入/做多"（绿） "卖出/做空"（红）
```

**提交后立刻禁用按钮**，直到服务端响应。`clientOrderId` 由前端生成（`c-{timestamp}-{seq}`），失败重试用同一个 id，服务端保证幂等。

### 双向持仓模式下

面板顶部多一个"开仓/平仓"切换，决定 `positionSide` 怎么填：

| 界面操作 | side | positionSide |
| --- | --- | --- |
| 开多 | BUY | LONG |
| 平多 | SELL | LONG |
| 开空 | SELL | SHORT |
| 平空 | BUY | SHORT |

这张表直接抄 `01-domain-knowledge.md` 第十节，**不要自己推**，推错是最常见的 bug。

---

## 11. 表格区

### 仓位表

| 列 | 说明 |
| --- | --- |
| 币对 / 方向 | 多头绿、空头红 |
| 数量 | |
| 开仓均价 / 标记价 | |
| 未实现盈亏 (ROE%) | 服务端下发，随标记价推送实时变 |
| 保证金 | 逐仓显示 `isolatedMargin` 并带"调整"按钮 |
| **强平价** | 服务端下发 |
| 操作 | 市价平仓 / 限价平仓 / 设置止盈止损 |

### 当前委托表

| 列 | 说明 |
| --- | --- |
| 时间 / 币对 / 类型 / 方向 | |
| 价格 / 数量 / 已成交 | |
| **前方排队** | ★ `queueAhead`，带"约"字表示估算 |
| 触发条件 | 触发单显示 `stopPrice` 和触发方向 |
| 操作 | 撤单 |

**"前方排队"这一列是这个产品的signature**。别的模拟盘没有，它让用户直观理解"为什么价格到了我的单还没成交"。旁边放一个 `?` 图标，点开跳到 `/rules` 的对应段落。

`queueEstimated = true` 时显示为 `≈3.0 BTC` 并加一个浅色提示"该价位超出可见 20 档，为估算值"。

---

## 12. 登录

`LoginButton` 点开是一个弹窗，三个 tab：**钱包 / 邮箱 / Google**。三条路径最后都落到同一个 `token`，存法、恢复法、登出法完全一样——差异只在"怎么拿到 token"这一步。

### 12.1 钱包登录

| 链 | 方案 |
| --- | --- |
| EVM | `wagmi` + `RainbowKit`（MetaMask、OKX、WalletConnect…） |
| Solana | `@solana/wallet-adapter-react` + `wallet-adapter-react-ui`（Phantom、OKX…） |

两套 Provider 都挂在根布局上，"钱包" tab 里让用户先选链再选钱包。

```
1. 用户选链 → 选钱包 → 拿到 address
2. POST /auth/nonce { address, chain } → 拿到 message
3. 请求签名：
   EVM    → signMessageAsync({ message })
   Solana → signMessage(new TextEncoder().encode(message))
4. POST /auth/verify { address, chain, nonce, signature } → 拿到 token
5. 存 token（见 12.4）
```

### 12.2 邮箱登录

```
1. 输入邮箱 → POST /auth/email/code { email }
2. 输入框旁边出现 60 秒倒计时的"重新发送"，倒计时结束前按钮禁用（服务端也有同样的频率限制，前端这层只是省一次无效请求）
3. 输入 6 位验证码 → POST /auth/email/verify { email, code } → 拿到 token
4. 存 token（见 12.4）
```

验证码输错要显示剩余可尝试次数（服务端 5 次后作废），不要只报"验证码错误"让用户瞎试。

### 12.3 Google 登录

这一步是整页跳转，不是弹窗里的 API 调用：

```
1. 点"使用 Google 登录" → location.href = '/auth/google'（整页跳转，走浏览器原生 OAuth 流程）
2. Google 授权后跳回 /auth/google/callback（服务端），再 302 重定向回前端 /login/callback#token=xxx
3. /login/callback 页面：从 location.hash 取 token，取到后立刻用 history.replaceState 清掉 hash（避免 token 留在浏览器历史/地址栏里）
4. 存 token（见 12.4）→ 跳回登录前的页面
```

不要尝试在弹窗里用 `window.open` + `postMessage` 做这个流程——整页跳转是 OAuth 的标准做法，浏览器弹窗拦截和第三方 cookie 限制会让弹窗方案在部分浏览器上直接失效。

### 12.4 存 token / 登录态恢复 / 登出

**存 token**（三种登录方式共用）：

```
存 localStorage → wsClient.setToken(token) → accountStore.hydrate()
```

**登录态恢复**：页面加载时读 localStorage 的 token，调 `GET /auth/me` 验证。

- 401 → 清 token，回到未登录态，**不要自动弹钱包签名或跳 Google**（用户会以为被钓鱼）
- 200 → 恢复登录态，`hydrate()`

**登出**：清 token、清 `account-store`、`wsClient.setToken(null)`。如果是钱包登录，**不要调用钱包的 disconnect**——那是用户和钱包之间的事，我们只管自己的会话；邮箱/Google 登录本来就没有对应的"断开"概念，登出就是清本地状态。

---

## 13. 错误处理

### 三种错误，三种呈现

| 类型 | 例子 | 呈现 |
| --- | --- | --- |
| **表单校验** | 数量低于最小值 | 输入框下方红字，按钮禁用 |
| **业务拒绝** | `INSUFFICIENT_MARGIN` | Toast（sonner），显示服务端的中文 `message` |
| **系统异常** | 500 / 网络失败 | Toast + "重试"按钮 |

服务端的 `error.message` 已经是给用户看的中文，**前端直接显示，不做二次翻译，也不要拼接自己的措辞**。翻译表维护在两处一定会漂移。

### 强平通知

收到 WS `liquidation` 频道消息 → **弹一个 Dialog**，不是 Toast。

```
⚠️ 仓位已被强制平仓

BTCUSDT 多头 1.0 BTC
开仓价 50,000.00 → 强平价 45,180.72
已实现亏损 -4,819.28 USDT
清算费 -225.90 USDT

[ 查看详情 ]  [ 我知道了 ]
```

这是用户最需要理解的一件事，不能一闪而过。详情页展示 `marginBalanceBefore` 和 `maintMarginAt`，把"为什么被平"说清楚。

---

## 14. 主题

只做暗色（决策定稿）。Token 定义在 `packages/ui/src/styles/globals.css`：

```css
:root {
  --bg-base:      #0B0E11;   /* 页面底 */
  --bg-surface:   #161A1E;   /* 卡片 */
  --bg-elevated:  #1E2329;   /* 悬浮/输入框 */
  --border:       #2B3139;
  --text-primary: #EAECEF;
  --text-secondary:#848E9C;
  --up:           #0ECB81;
  --down:         #F6465D;
  --accent:       #F0B90B;   /* 主按钮/强调 */
  --warn-bg:      #3A2E12;
}
```

**字号**：交易数据用等宽数字（`font-variant-numeric: tabular-nums`），否则盘口数字跳动时会左右抖。这个细节不做，整个页面的专业感会掉一档。

---

## 15. 交付检查清单

前端做完后，逐条验：

- [ ] 未登录也能看行情（K 线、盘口、成交都正常跳动）
- [ ] 切币对不白屏，图表不重建
- [ ] 盘口连续跳动 5 分钟，页面不掉帧（DevTools Performance 看）
- [ ] 数字不左右抖（tabular-nums 生效）
- [ ] 断网 30 秒：出黄条 → 恢复后自动重连 → 账户数据重新对齐
- [ ] 刷新页面登录态保持，不弹签名
- [ ] 挂单列表能看到"前方排队"并随行情下降
- [ ] 下单失败时 Toast 显示服务端的中文原因
- [ ] 强平时弹 Dialog 而不是 Toast
- [ ] 所有金额显示带千分位和正负号
- [ ] 强平价、保证金率、可用余额全部来自服务端，前端没有本地计算
