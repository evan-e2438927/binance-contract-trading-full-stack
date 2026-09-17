# 06 · 测试子设计

> 这个系统里只有一件事不能出错：**钱**。
> 所以测试策略不是"覆盖率多少"，而是"哪些错误必须在用户之前被发现"。

---

## 1. 测试分层与投入比例

```
                          ┌───────────────┐
                          │ 故障演练       │  手动，每个里程碑一次
                          │ 压测          │
                          ├───────────────┤
                          │ E2E (Playwright)│  少量，只覆盖主链路
                       ┌──┴───────────────┴──┐
                       │  集成测试            │  中等
                       │  （真库 + 假行情）     │
                 ┌─────┴──────────────────────┴─────┐
                 │  引擎单测 + 场景重放               │  ★ 大头
                 │  （纯函数，无 IO，毫秒级）          │
           ┌─────┴──────────────────────────────────┴─────┐
           │  不变式检查（每次 apply 之后自动跑）             │  贯穿
           └──────────────────────────────────────────────┘
```

**投入比例大约是 6 : 2 : 1 : 1**（引擎单测 : 集成 : E2E : 演练）。

为什么引擎单测占大头：它是唯一"算错就前功尽弃"的部分，而且因为是纯函数，**测试成本极低**——不用起数据库、不用连网络、毫秒级跑完。这是 `02-architecture.md` 里把引擎抽成零依赖包换来的最大红利。

### 工具

| 用途 | 工具 |
| --- | --- |
| 单测 / 集成 | Vitest |
| E2E | Playwright（仓库已配 Chromium） |
| 压测 | 自写脚本（Node，直接驱动引擎） |
| 数据库测试 | 本地 Supabase（Docker）或独立测试 schema |

---

## 2. 引擎单测：公式算例

`01-domain-knowledge.md` 和 `04-backend-design.md` 里的每个算例，**直接抄成测试用例**。

### 强平价（最关键的三条）

```ts
describe('liquidationPrice', () => {
  it('算例 A · 逐仓多头', () => {
    const p = position({ side: 'LONG', mode: 'ISOLATED', qty: '1', entry: '50000',
                         leverage: 10, isolatedMargin: '5000' })
    const liq = liquidationPrice(acc, p, ctx)
    expect(format(liq, 2)).toBe('45180.72')

    // ★ 反向验算：在强平价上，保证金余额必须等于维持保证金
    const equity = parse('5000') - (parse('50000') - liq)      // 180.72
    const mm = mul(liq, parse('0.004'))                        // 180.72
    expect(equity).toBe(mm)
  })

  it('算例 B · 逐仓空头', () => { /* 54780.88，同样反向验算 */ })
  it('算例 C · 全仓多头', () => { /* 40160.64，同样反向验算 */ })
})
```

**反向验算是这组测试的灵魂**。只断言 `45180.72` 的话，如果公式抄错了而你又把错的结果写进期望值，测试会一直绿。反向验算是独立于公式的第二条路径，两条路径对上才可信。

### 分层连续性

```ts
it('每对相邻层在边界上的维持保证金必须相等', () => {
  for (const [symbol, brackets] of allBrackets) {
    for (let i = 0; i < brackets.length - 1; i++) {
      const N = brackets[i].notionalCap
      const lower = mul(N, brackets[i].mmr)     - brackets[i].cum
      const upper = mul(N, brackets[i + 1].mmr) - brackets[i + 1].cum
      expect(lower, `${symbol} 第 ${i + 1} 层边界`).toBe(upper)
    }
  }
})
```

这条测试同时是**分层表的数据校验**——人工录入的 JSON 抄错了，这里就会红。

### 定标库边界

```ts
describe('fixed', () => {
  it.each([
    ['0',            0n],
    ['50000.25',     5000025000000n],
    ['-50000.25',    -5000025000000n],
    ['0.00000001',   1n],
    ['0.000000001',  0n],              // 超出 8 位被截断
    ['92233720368',  9223372036800000000n],   // 接近 int8 上限
  ])('parse(%s)', (input, expected) => expect(parse(input)).toBe(expected))

  it('手续费向上取整', () => expect(ceil8(parse('0.000000001'))).toBe(1n))
  it('已实现盈亏向下取整', () => expect(trunc8(parse('0.000000009'))).toBe(0n))
  it('买单价格向下对齐 tickSize', () =>
    expect(alignPrice(parse('50000.17'), parse('0.1'), 'BUY')).toBe(parse('50000.1')))
  it('卖单价格向上对齐 tickSize', () =>
    expect(alignPrice(parse('50000.17'), parse('0.1'), 'SELL')).toBe(parse('50000.2')))
})
```

---

## 3. 引擎场景重放：最有价值的一类测试

因为引擎是纯函数，**一串输入事件就完整决定了输出**。任何交易过程都能录下来逐字重放。

### 形态

```ts
function replay(inputs: EngineInput[]): EngineEvent[] {
  const engine = createEngine(initialState)
  return inputs.flatMap(i => engine.apply(i))
}
```

### 场景一：拟真排队（抄 `04-backend-design.md` 5.5 节那张表）

```ts
it('限价买单按排队规则成交', () => {
  const engine = createEngine({ book: { bids: [{ price: '49900', qty: '3.0' }] } })

  engine.apply(placeLimit({ side: 'BUY', price: '49900', qty: '0.5' }))
  expect(order().queueAhead).toBe(parse('3.0'))

  engine.apply(trade({ price: '49900', qty: '1.2', buyerIsMaker: true }))
  expect(order().queueAhead).toBe(parse('1.8'))

  engine.apply(depth({ bids: [{ price: '49900', qty: '1.5' }] }))
  expect(order().queueAhead).toBe(parse('1.5'))        // ★ 总量夹逼

  engine.apply(trade({ price: '49900', qty: '0.8', buyerIsMaker: true }))
  expect(order().queueAhead).toBe(parse('0.7'))

  const events = engine.apply(trade({ price: '49900', qty: '2.0', buyerIsMaker: true }))
  const fill = events.find(e => e.t === 'fill')!.fill
  expect(fill.qty).toBe(parse('0.5'))
  expect(fill.price).toBe(parse('49900'))              // ★ 成交价是挂单价，不是行情价
  expect(fill.role).toBe('MAKER')
  expect(order().status).toBe('FILLED')
})
```

### 必须覆盖的场景清单

| 组 | 场景 | 关键断言 |
| --- | --- | --- |
| **排队** | 正常排队消耗 | queueAhead 逐步下降，成交价 = 挂单价 |
| | 价格穿透 | 剩余全部成交 |
| | 方向错误的成交流不推进队列 | 买单收到 `m=false` 的成交，queueAhead 不变 |
| | 撤单夹逼 | 盘口总量下降时 queueAhead 被夹 |
| | 价位从盘口消失 | queueAhead 归零 |
| | 挂单价优于最优价 | 初始 queueAhead = 0 |
| **市价** | 逐档吃单 | 均价 = 加权平均，有滑点 |
| | 吃穿 20 档 | 抛 `MARKET_ORDER_TOO_LARGE`，不产生成交 |
| **限价角色** | 穿透盘口的限价单 | 先 Taker 成交，剩余挂单 queueAhead = 0 |
| | GTX 会成交 | 下单时就会成交：拒单 `POST_ONLY_REJECTED`；触发单触发时才会成交：EXPIRED（已定，设计缺口 #13） |
| | IOC 部分成交 | 成交部分 + 剩余 EXPIRED |
| | FOK 不能全成 | 整单 EXPIRED，零成交 |
| **仓位** | 开仓 → 加仓 | 均价按数量加权 |
| | 减仓 | 均价不变，已实现盈亏正确 |
| | 反手（单向模式） | 先平后开，两段盈亏分别正确 |
| | 双向模式禁止反手 | 超出部分被拒 |
| **风控** | 价格走到强平价前一档 | 不强平 |
| | 价格触及强平价 | 强平，先撤单再平仓 |
| | 逐仓爆仓 | 只亏 isolatedMargin，钱包不倒扣 |
| | 全仓爆仓 | 余额归零，不为负 |
| **资金费** | 正费率多头付出 | 钱包余额减少，流水为负 |
| | 负费率多头收到 | 钱包余额增加 |
| | 结算后触发强平 | 扣费后保证金率过线 → 立刻强平 |
| | 结算时无仓位 | 不产生任何流水 |
| **触发单** | 四种触发方向 | 止损买/止损卖/止盈买/止盈卖各一条 |
| | 触发时保证金不足 | ~~EXPIRED~~ REJECTED，带原因（第 09 讲按币安条件单状态改） |
| | closePosition | 按当时全部仓位数量平 |
| **只减仓** | 无仓位时下只减仓单 | 拒绝 |
| | 仓位平完后残余只减仓单 | 自动撤销 |

**四种触发方向一条都不能少**。方向搞反是这类代码最常见的 bug，而且只有真实触发时才会暴露。

---

## 4. 不变式检查：把正确性变成机器的事

这是投入产出比最高的一项。

### 引擎层：每次 `apply()` 之后自动跑

```ts
// test/setup.ts
afterEach(() => {
  const s = engine.snapshot()

  // ① 钱包余额 == 所有资金流水之和
  for (const acc of s.accounts) {
    expect(acc.walletBalance).toBe(sum(s.ledger.filter(l => l.accountId === acc.id).map(l => l.amount)))
  }
  // ② 仓位数量非负
  for (const p of s.positions) expect(p.qty >= 0n).toBe(true)
  // ③ 可用余额非负（可以等于 0，绝不能为负）
  for (const acc of s.accounts) expect(availableBalance(acc, s) >= 0n).toBe(true)
  // ④ FILLED 的订单，executedQty == qty
  for (const o of s.orders) if (o.status === 'FILLED') expect(o.executedQty).toBe(o.qty)
  // ⑤ 任何订单 executedQty <= qty
  for (const o of s.orders) expect(o.executedQty <= o.qty).toBe(true)
  // ⑥ 冻结保证金总额 == 所有未完成非只减仓单的 frozenMargin 之和
  // ⑦ queueAhead >= 0
  for (const o of s.orders) expect(o.queueAhead >= 0n).toBe(true)
})
```

> **已定（设计缺口 #19，第 07 讲）**：③ 不是任何时刻都成立——标记价不利变动会让全仓仓位的可用余额在强平之前就变负（强平线是维持保证金，不是可用余额），币安也一样。实现改成"一次成功的下单不会把可用余额从非负变成负数"，只在那种 `apply` 之后检查下单账户。另加 ⑨：每次 `apply` 之后不能留下"权益 ≤ 维持保证金"却没被强平的仓位。见 `packages/engine/src/testing/invariants.ts`。

**第 ① 条是最有价值的**。它把"账目对不对"从一个靠人眼检查的问题变成一个机器每次都跑的断言。任何一个漏写流水的分支，都会在下一次测试里立刻红。

### 数据库层：每小时对账任务

```sql
SELECT a.id, a.wallet_balance, l.s AS ledger_sum, a.wallet_balance - l.s AS diff
FROM accounts a
JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l
  ON l.account_id = a.id
WHERE a.wallet_balance <> l.s;
```

返回非空行 → 告警。

引擎层的不变式在开发期抓 bug，数据库层的对账在生产期兜底——**两层都要有**，因为生产环境会出现测试里没有的并发和故障组合。

---

## 5. 集成测试

范围：**真数据库 + 假行情 + 真引擎宿主**。不连币安。

### 假行情注入

把 `market/*` 的 store 换成可编程的假实现：

```ts
const feed = createFakeFeed()
feed.setBook('BTCUSDT', { bids: [...], asks: [...] })
feed.setMarkPrice('BTCUSDT', '50000')
feed.emitTrade('BTCUSDT', { price: '49900', qty: '1.2', buyerIsMaker: true })
```

**不要在集成测试里连真币安**：行情不可控，测试会随机红，而随机红的测试很快就会被所有人忽略。

### 必须覆盖的

| 场景 | 验证什么 |
| --- | --- |
| 下单 → 成交 → 落库 | 一笔成交的 5 条记录（fill / order / position / balance / ledger）全部写入且在一个事务里 |
| 落库失败回滚 | 故意让数据库报错，内存状态必须回滚，不能出现"内存成交了库里没有" |
| 重启恢复 | 关掉宿主重建，仓位/挂单/余额和关掉之前一致 |
| 重启后 queueAhead 重置 | 不复用旧值，按当前盘口重新估算 |
| 重启后补强平 | 停机期间价格暴跌，恢复后立刻强平 |
| 资金费重复触发 | 定时器重复执行时，`funding_uq` 唯一约束挡住第二次 |
| 下单幂等 | 同一 `clientOrderId` 提交两次，只产生一张单 |
| 钱包验签 | 正确签名通过；篡改 message 被拒；nonce 复用被拒；过期 nonce 被拒 |
| 邮箱验证码 | 正确验证码通过；错误码计入 attempts；超 5 次作废；过期码被拒；同一账户三种登录方式各自独立，不互相合并 |

**"落库失败回滚"这条最容易被跳过，但它是最危险的路径**。内存是权威，如果落库失败而内存不回滚，重启后用户的钱就凭空变了。

---

## 6. E2E 测试

Playwright，**只覆盖主链路**，不追求覆盖率。E2E 贵且脆，多了会拖慢所有人。

### 五条

| # | 链路 | 断言 |
| --- | --- | --- |
| 1 | 未登录访问交易页 | K 线、盘口、成交都有数据在跳 |
| 2 | 连接钱包登录 | 签名后显示余额 10,000 USDT |
| 2b | 邮箱验证码登录 | 输入验证码后显示余额 10,000 USDT，账户与钱包登录相互独立 |
| 3 | 市价开仓 | 仓位表出现一行，数字与服务端返回一致 |
| 4 | 限价挂单 | 当前委托出现一行，**"前方排队"列有值** |
| 5 | 撤单 | 挂单消失，可用余额恢复 |

钱包签名在 E2E 里用**注入的测试钱包**（`window.ethereum` mock），不要真的弹 MetaMask。

---

## 7. 压测

目标不是追求多高的 QPS，是**知道自己的边界在哪**。

### 脚本形态

直接驱动引擎，不走 HTTP —— 我们要测的是引擎，不是网络栈。

```ts
// scripts/bench-engine.ts
const engine = createEngine(seedState({ accounts: 100, ordersPerAccount: 10 }))

const trades = loadRecordedTrades('BTCUSDT', 60_000)   // 一分钟的真实成交流
const t0 = performance.now()
for (const tr of trades) engine.apply(tr)
const t1 = performance.now()

console.log(`${trades.length} 笔成交，耗时 ${t1 - t0}ms，平均 ${(t1 - t0) / trades.length}ms/笔`)
console.log(`内存 ${process.memoryUsage().heapUsed / 1e6}MB`)
```

### 要测出来的三个数

| 指标 | 怎么测 | 参考目标 |
| --- | --- | --- |
| 单轮撮合耗时 | 100 账户 × 1000 挂单，喂一笔 aggTrade | < 5ms |
| 常驻内存 | 20 币对盘口 + 1000 挂单 + 100 账户 | < 500MB |
| 吞吐 | 一分钟真实成交流重放 | 能跟上实时（重放耗时 < 60s） |

**先录一段真实行情存成文件**（跑一个小脚本连币安 WS 录 10 分钟），之后所有压测都用同一份数据。用随机数据压测出来的结论不可信——真实成交流的分布和随机分布差很远。

---

## 8. 故障演练

每个里程碑结束时手动跑一遍。**这是把"能跑"变成"验证过"的唯一方式。**

| # | 演练 | 操作 | 期望 |
| --- | --- | --- | --- |
| 1 | 行情断线 | 防火墙屏蔽 `fstream.binance.com` 30 秒 | 前端出黄条、撮合暂停、恢复后自动重连、不补算成交 |
| 2 | 进程被杀 | `kill -9` server | pm2 自动重启；仓位/挂单/余额恢复；queueAhead 按当前盘口重估 |
| 3 | 停机期间暴跌 | 停 server → 用假行情把标记价压到强平价以下 → 启动 | 启动后立刻补强平，有 liquidation 记录 |
| 4 | 数据库断连 | 断开 Supabase 连接 30 秒 | 拒绝新下单（`SERVICE_UNAVAILABLE`），不出现"内存成交了库里没有" |
| 5 | 前端断网 | DevTools 离线 30 秒 | WS 重连后 `hydrate()` 被调用，账户数据与服务端一致 |
| 6 | 资金费+强平叠加 | 造一个资金费扣完就爆的仓位，等整点 | 扣费后立刻强平，两条流水顺序正确 |
| 7 | 时钟跳变 | 改系统时间跨过资金费结算点 | 不重复结算（唯一约束生效） |

演练结果记在 `docs/design/ops-drills.md`，每次记：**实际观察到什么**，不要只写"通过"。

---

## 9. CI

```yaml
# 每次 push
- pnpm check-types      # 类型检查
- pnpm test             # 单测 + 集成（用 CI 里的测试库）
# 分层表的结构与连续性校验由 packages/db 的单测覆盖（pnpm test 已包含）。
# verify:brackets 要调币安签名接口，不进 CI，上线前和怀疑数据时手动跑。
```

E2E 和压测**不进每次 push 的 CI**（太慢），改成：

- E2E：每晚定时跑一次
- 压测：每个里程碑手动跑，结果记进文档

### 一条建议

**先写不变式检查，再写第一行业务代码。**

它几乎不花时间（第 4 节那七条断言，一个小时能写完），但从第一天起就在替你盯着最危险的那类错误。等到发现账目对不上再回头加，那时候要排查的历史数据已经是一团乱麻。

---

## 10. 测试数据

### 固定装置（fixtures）

```
packages/engine/test/fixtures/
├── symbols.ts              BTCUSDT / ETHUSDT 的规格
├── brackets.ts             两个币对的完整分层表
├── accounts.ts             几个典型账户状态（空仓、单仓、多仓、濒临爆仓）
└── recorded/
    ├── btcusdt-10min.json  真实录制的 10 分钟行情流（压测和重放共用）
    └── liquidation.json    一段真实的暴跌行情（测强平）
```

**录制脚本**：

```ts
// scripts/record-feed.ts
// 连币安 WS，把 aggTrade / depth / markPrice 按时间顺序写成 JSONL
// 用法：pnpm record:feed BTCUSDT 600   （录 10 分钟）
```

录一段真实的暴跌行情很值得——强平路径是最难造数据的，有真实行情就能反复重放。
