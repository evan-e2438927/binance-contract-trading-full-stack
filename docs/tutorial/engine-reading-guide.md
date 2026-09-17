# 引擎代码阅读指南

> 讲义 02、03 是"照着敲"的写法，代码块很长，读起来容易迷路。
> 这份文档反过来：**不贴大段代码，只讲清楚每个文件干了什么、彼此怎么配合**。读完再去看代码或讲义，会顺很多。
>
> 对应代码：`packages/engine/src`，截至第 05 讲（13 个测试文件、189 条测试全绿）。

---

## 0. 一句话

**引擎是一台"记账 + 算数"的机器：吃进一个事件，改自己内存里的账，吐出"改了什么"的清单。它自己不碰数据库、不上网、不看时钟。**

```
宿主（服务端）                        引擎（packages/engine）
─────────────                        ──────────────────────
币安推来行情      ──┐
用户下单/撤单      ──┼─► EngineInput ─► apply() ─► EngineEvent[] ─► 宿主写库、推前端
到点结算资金费     ──┘                   │
                                        └─ 内存里的账户/仓位/订单被修改
```

---

## 1. 先看清"现在做到哪了"

这是读不懂的最大原因：**很多代码是给后面几讲打的地基，现在还没被真正调用。**

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| 类型（输入/输出/领域对象） | ✅ 完整 | 12 种输入、9 种输出事件都定义好了 |
| `apply` 能处理的输入 | ⚠️ 6 种 | `markPrice` 存标记价并对这个币对上有仓位的账户跑风控扫描（第 07 讲）；`book` 存盘口并夹逼挂单排队位置、`trade` 存最新价并让挂单按排队成交（第 06 讲）；`registerAccount` 开户发钱；`placeOrder` 校验 + 成交或挂单（第 04、05、06 讲），触发单抛错"见第 09 讲"；`cancelOrder` 撤单（第 06 讲） |
| 其余 6 种输入（调杠杆、资金费……） | ❌ 直接抛错 | `apply.ts` 里的 `case` 列表，故意炸，提醒"还没实现" |
| 回滚机制（undo 日志） | ✅ 完整 | `journal.ts` |
| 计算公式 | ✅ 写好并测过 | `formulas.ts` / `position.ts` / `liquidation.ts`；第 04 讲的校验链用到了其中几个（可用余额、冻结保证金、分层查找），成交和强平还没用上 |
| 下单校验链 | ✅ 完整 | `validate-order.ts`，13 步，只读状态（第 04 讲） |
| 成交落账 | ✅ 完整 | `execute-order.ts`：逐档成交、改仓位、已实现盈亏、手续费、余额（第 05 讲）；挂单被行情成交（Maker）也走同一个 `applyFill`（第 06 讲） |
| 挂单排队 | ✅ 完整 | `queue.ts` 算排队位置，`resting-orders.ts` 把它接到 `book` / `trade` 输入上（第 06 讲） |
| 风控与强平 | ✅ 完整 | `risk.ts`：标记价更新、成交之后扫描，该强平的撤单 + 强平单吃盘口 + 破产价兜底 + 清算费（第 07 讲） |
| 测试脚手架（自动对账） | ✅ 完整 | `testing/` |

所以现在的引擎，**真正能"跑"的业务有四件：开户发 10,000 USDT、把不合格的下单拒掉、市价单和限价单成交落账、限价单挂着排队等行情成交（以及撤单）、爆仓强平**。资金费、调杠杆、触发单还没有，强平相关公式要等第 07 讲才会被 `apply` 串起来。

---

## 2. 读代码前必须懂的 3 个概念

### ① 所有钱、价格、数量都是 `bigint`，放大了 1 亿倍

来自 `packages/shared/src/fixed.ts`：

```ts
type Fixed = bigint;          // 1 单位 = 0.00000001
SCALE = 100_000_000n;         // 1.0 就是 100_000_000n

parse("50000")   // → 5_000_000_000_000n
format(x, 2)     // → "45180.72"
```

为什么：JS 的 `number` 算 `0.1 + 0.2` 会得到 `0.30000000000000004`，记账不能容忍。

**带来的后果**：不能直接写 `a * b`（会多放大一亿倍），必须用 `mul(a, b)`。而"最后一位小数往哪边舍"是规定好的：

| 函数 | 舍入方式 | 用在哪 |
| --- | --- | --- |
| `mul` / `div` | 截断 | 中间步骤、已实现盈亏、资金费 |
| `mulCeil` | 向上 | 手续费（宁可多收一点点，不能少算成本） |
| `mulRound` / `divRound` | 四舍五入 | 未实现盈亏、保证金、强平价、均价 |

看到代码里 `mul` 和 `mulRound` 混着用，不是写乱了，是**故意按这张表选的**。

**命名防呆**：`leverageNum`、`bracketNum`、`maxOpenOrdersNum` 带 `Num` 后缀的是**普通整数**（10 倍杠杆就是 `10`），不是放大过的 `bigint`。

### ② 输入 → 事件，而且必须"确定"

同样的状态 + 同样的输入，永远得到同样的输出。所以：

- 时间戳从输入里带进来（每个输入都有 `ts`），引擎不调 `Date.now()`
- 订单 id 由宿主生成后放进 `placeOrder` 输入，引擎不生成随机 id

好处：线上出了问题，把输入序列捞出来在测试里重放，每一步都能复现。`purity.test.ts` 专门扫源码，谁写了 `Date.now()`、`Math.random()`、`console.log`、`import db` 就红。

### ③ 两种错误，处理方式相反

| 类型 | 例子 | 引擎怎么做 |
| --- | --- | --- |
| **业务拒绝** | 余额不够、价格没对齐 | 返回一个 `{ t: "rejected" }` 事件，正常流程，推给用户看 |
| **程序错误** | 未知币对、同一账户注册两次 | `throw new Error`——说明宿主接线写错了，越早炸越好 |

---

## 3. 文件地图

```
packages/engine/src
├── index.ts            对外只导出 createEngine 和类型
├── types.ts            ★ 契约：配置、领域对象、输入、输出、Engine 接口
│
├── create-engine.ts    组装：把下面几块拼成一个 Engine 对象
├── state.ts            内存里放什么、怎么导出快照/载入快照
├── journal.ts          undo 日志：修改状态的唯一入口 + 回滚
├── apply.ts            总调度：按输入类型分派（目前实现了行情、开户、下单拒单）
│
├── formulas.ts         公式：名义价值、保证金、盈亏、可用余额、手续费、资金费
├── position.ts         公式：加仓均价、减仓盈亏、反手拆分
├── liquidation.ts      公式：分层查找、维持保证金、保证金率、强平价
├── validate-order.ts   第 04 讲：下单校验链 13 步（只读状态，不改任何东西）
├── execute-order.ts    第 05 讲：成交落账（executeOrder 下单即成交，applyFill 一笔落账）
│
├── purity.test.ts      扫源码，禁止时钟/随机/IO
└── testing/
    ├── fixtures.ts     测试用的固定配置（BTCUSDT 示例分层表）
    ├── harness.ts      包一层引擎：每次 apply 后自动对账 + 回滚自检
    └── invariants.ts   8 条"永远必须成立"的规则
```

**依赖关系**（箭头 = import）：

```
create-engine ─► apply ─► journal ─► state ─► types
                    └────────────────► state

formulas / position / liquidation ─► shared（只依赖定标库，不碰 state）

apply ─► validate-order ─► formulas / liquidation / state（只读）
apply ─► execute-order ─► position / formulas / journal（改状态）

testing/harness ─► create-engine
testing/invariants ─► formulas
```

分成两组看就清楚了：

- **"引擎机器"组**：`create-engine` → `apply` → `journal` → `state`。管"状态怎么存、怎么改、怎么撤销"
- **"计算器"组**：`formulas` / `position` / `liquidation`。纯函数，给数字、还数字，完全不知道引擎的存在

**建议阅读顺序**：`types.ts`（只看输入/输出那两段）→ 第 4 节的走读 → `state.ts` → `journal.ts` → `apply.ts` → `create-engine.ts` → 三个公式文件（配着各自的 `.test.ts` 看，测试里就是算例）→ `testing/`。

---

## 4. 跟着一次"开户"走完全程

这是目前唯一完整跑通的业务，把它走一遍，"引擎机器"组的四个文件就全串起来了。

宿主代码大概长这样：

```ts
const engine = createEngine(config);

const events = engine.apply({
  t: "registerAccount", accountId: "acc-1",
  walletBalance: parse("10000"), positionMode: "ONE_WAY", ts: 1789344000000,
});

try { 写数据库(events); engine.commit(); }
catch { engine.rollback(); }
```

**第 1 步 · `createEngine(config)`**（`create-engine.ts`）
调 `createState(config)` 建一个空的内存状态。启动时顺便检查：每个币对都必须有杠杆分层表，没有就直接抛错（算不出维持保证金，等到下单才发现就晚了）。分层表按上限从小到大排好序。

**第 2 步 · `engine.apply(input)`**（`create-engine.ts:13`）
```
beginJournal(state)          ← 开一本空白的 undo 日志
try   applyInput(state, input)
catch rollbackJournal(state); throw   ← 中途抛错就先把改了一半的撤掉
```

**第 3 步 · `applyInput` 分派**（`apply.ts:14`）
一个大 `switch`，`registerAccount` 走到 `registerAccount()` 函数：
1. 账户已存在？抛错（程序错误）
2. 余额为负？抛错
3. `putAccount(state, {...})` 存进内存
4. 返回一个 `balanceUpdate` 事件，`reason: "INITIAL"`，`delta: 10000`

**第 4 步 · `putAccount` 做了两件事**（`journal.ts:55`）
1. `record()`：在日志里记下"`acc-1` 这个键**修改前**是什么"——这里是 `undefined`（之前不存在）
2. 把新对象 `Object.freeze` 冻住后放进 `state.accounts`

**第 5a 步 · 宿主写库成功 → `commit()`**
把日志扔掉，`state.journal = null`。改动正式生效。

**第 5b 步 · 宿主写库失败 → `rollback()`**
遍历日志：`acc-1` 修改前是 `undefined` → 从 Map 里删掉它。内存回到 apply 之前，和数据库一致。

**协议**：每次 `apply` 之后必须恰好调一次 `commit` 或 `rollback`，否则下一次 `apply` 在 `beginJournal` 里就抛错。

---

## 5. 每个文件在干什么

### `types.ts` —— 契约（321 行，但大部分是字段注释）

分四段，**第一次读只看第 3、4 段**：

1. **配置** `EngineConfig`：币对规格、分层表、费率、限额。宿主启动时从数据库读出来一次性给引擎
2. **领域对象**：`Account`、`Position`、`Order`、`Fill`……每个都和一张数据库表对应
3. **输入** `EngineInput`：12 种，用 `t` 字段区分（行情 4 种、账户 3 种、交易 5 种）
4. **输出** `EngineEvent`：9 种。重点记住 **`balanceUpdate` 是唯一能改钱包余额的事件**，每一条都会落成一条流水

`Engine` 接口只有 5 个方法：`apply` / `commit` / `rollback` / `snapshot` / `restore`。

### `state.ts` —— 内存里放什么

内存状态分两类，**待遇不同**：

| 类别 | 内容 | 进快照？ | 能回滚？ |
| --- | --- | --- | --- |
| 账户类 | `accounts` `settings` `positions` `orders` | ✅ | ✅ |
| 行情类 | `books`（盘口）`marks`（标记价）`lastPrices` | ❌ | ❌ |

为什么行情不回滚：行情是外部事实，写库失败不代表币安的价格没变。重启后重新订阅就有了。

几个细节：

- 都用 `Map`，因为撮合时要按 id 高频查找
- 仓位的键是 `"账户|币对|方向"`（`positionKey`），同一账户同一币对在双向模式下可以有多头、空头两个仓位
- `orders` 里**只放没完成的订单**，成交完/撤掉的发出事件后就移除
- 账户类 Map 的类型是 `ReadonlyMap`——**故意的**，让你没法直接 `.set()`，必须走 `journal.ts`
- `snapshot()` 用 `structuredClone` 深拷贝，代价是全体账户，只用于重启恢复和测试

### `journal.ts` —— 回滚是怎么做到的

**要解决的问题**：宿主写库失败，内存得撤回去。最笨的办法是每次 apply 前拍个全量快照，但账户一多每次都拷贝几万个对象，扛不住。

**做法**：只记"这次改了哪几个键、它们改之前是什么"。

```
apply 前:   positions = { A: 旧A, B: 旧B }
apply 中:   改了 A、新增了 C
日志:       { A: 旧A, C: undefined }
rollback:   A 放回 旧A；C 删掉        ← 只动 2 个键，和账户总数无关
```

两个规则：
- 同一个键只记**第一次**（要回到 apply 之前，不是回到上一步）
- `undefined` 表示"原来不存在"，回滚时删除

**怎么保证每一处修改都进了日志**？三道防线：
1. **编译期**：`state` 上的 Map 是只读类型，想改只能调 `putAccount` / `putPosition` / `putOrder` / `removePosition` / `removeOrder` 等
2. **运行期**：存进去的对象被 `Object.freeze`，谁绕过类型原地改字段，当场 `TypeError`
3. **测试期**：测试脚手架每次 apply 后都真的 rollback 一次，比对是否完全回到原样（见第 6 节）

为什么"冻结"这么重要：日志里存的是旧对象的**引用**不是拷贝。如果允许原地改 `account.walletBalance = x`，旧对象本身就被改了，回滚回去的也是错的值。

### `apply.ts` —— 调度中心

目前就是一个 `switch`：
- `book` → 存盘口
- `markPrice` → 存标记价和资金费率
- `trade` → 存最新成交价
- `registerAccount` → 开户（见第 4 节）
- `placeOrder` → 先查订单 id 是否重复，再调 `validateOrder`；被拒返回 `rejected` 事件，通过交给 `executeOrder` 成交
- 其余 7 种 → `throw "还没实现"`

代码里 `// 模块 06：...` 这样的注释标出了以后要往哪里填逻辑。末尾的 `assertNever` 是 TypeScript 技巧：以后在 `types.ts` 里加了新输入类型却忘了在这里处理，编译就会报错。

### `formulas.ts` —— 基础公式

每个函数只算一步，参数全部由调用方传进来，不查 state。拿 BTCUSDT、价格 50,000 举例：

| 函数 | 公式 | 例子 |
| --- | --- | --- |
| `notional` | 数量 × 价格 | 1 BTC → 50,000 |
| `initialMargin` | 名义价值 ÷ 杠杆 | 10x → 5,000 |
| `unrealizedPnl` | 多：(标记价 − 开仓价) × 数量；空：反过来 | 标记价 52,000 的多头 → +2,000 |
| `marginBalance` | 钱包余额 + 全部浮盈浮亏 | |
| `availableBalance` | 钱包 + 全仓浮盈亏 − 全仓起始保证金 − 逐仓保证金 − 挂单冻结 | 最容易算错的一个 |
| `frozenMargin` | 起始保证金 + 按 Taker 费率预留手续费；只减仓单为 0 | 10x 挂 1 BTC → 5,000 + 25 = 5,025 |
| `fee` | 名义价值 × 费率（向上取整） | Taker 0.05% → 25；Maker 0.02% → 10 |
| `fundingFee` | 名义价值 × 费率；费率为正时多头付、空头收 | 费率 0.01% → 多头 −5，空头 +5 |

**一个重要的设计决定**（讲义里叫"设计缺口 #6"）：**开逐仓不改钱包余额**。逐仓保证金只是把钱从"可用"标成"锁定"，体现在 `availableBalance` 的减项里。钱包余额只有手续费、已实现盈亏、资金费、强平这几种情况才动。

### `position.ts` —— 仓位怎么变

只管"算数"，不管"这笔成交算加仓还是减仓"（那是第 05 讲撮合的事）。

| 函数 | 场景 | 例子 |
| --- | --- | --- |
| `addToPosition` | 同方向加仓，重算加权均价 | 1 BTC @ 50,000 + 1 BTC @ 52,000 → 2 BTC @ 51,000 |
| `reducePosition` | 反方向减仓，均价**不变**，算已实现盈亏和释放的逐仓保证金 | 2 BTC @ 51,000 卖 1 @ 53,000 → 盈 2,000，剩 1 BTC 均价仍 51,000 |
| `splitReverseFill` | 单向模式下成交量超过持仓（反手） | 持多 1 BTC，卖 3 BTC → 先平 1，再开空 2 |

`reducePosition` 有个小心思：全部平仓时直接释放全部逐仓保证金，不走除法——避免在最常见的"全平"场景因为截断漏掉几分钱。

### `liquidation.ts` —— 强平相关

| 函数 | 干什么 |
| --- | --- |
| `findBracket` | 按名义价值找所在分层（分层表已按上限排序，找第一个装得下的） |
| `maintMargin` | 维持保证金 = 名义价值 × 维持保证金率 − 速算额 |
| `marginRatio` | 维持保证金 ÷ 保证金余额，≥ 100% 就该强平；余额 ≤ 0 时直接返回 100%（不做除以零） |
| `liquidationPrice` | 币安通用强平价公式 |

**强平价算例 A**（逐仓做多 1 BTC @ 50,000，逐仓保证金 5,000，第 1 层 mmr 0.4%）：

```
分子 = 逐仓保证金 − 数量×开仓价 = 5,000 − 50,000     = −45,000
分母 = 数量×mmr   − 数量        = 0.004 − 1         = −0.996
强平价 = −45,000 ÷ −0.996                            = 45,180.72
```

验算：价格跌到 45,180.72 时，保证金余额 = 5,000 − 4,819.28 = 180.72；维持保证金 = 45,180.72 × 0.4% ≈ 180.72。两者相等，正好触线。测试里每个算例都做了这个反算。

另外两个算例：B 逐仓做空 → 54,780.88；C 全仓做多、钱包 10,000 → 40,160.64（全仓拿整个钱包兜底，所以强平价比逐仓更远）。

强平价**不对齐 tickSize**：它是一个风控阈值，不是要挂到盘口的委托价。

---

### `validate-order.ts` —— 这张单能不能下（第 04 讲新增）

一个长函数 `validateOrder()`，从上往下 13 步，每步前面有 ①～⑬ 的编号注释。**只读 state，不调任何 `put*`**——所以不进 undo 日志，被拒的单不留痕迹。

| 结果 | 谁接着处理 |
| --- | --- |
| `{ ok: false, code, message }` | `apply.ts` 的 `placeOrder` 包成一条 `rejected` 事件返回 |
| `{ ok: true, order }` | `executeOrder` 拿它去成交（第 05 讲） |

读的时候抓住三件事：

1. **第 9 步（杠杆分层）必须在第 10 步（余额）前面**——否则杠杆不允许时会误报"余额不足"
2. **第 9、10 步只看 `openQty`**：平仓部分只会释放保证金，不需要检查
3. **单向模式下仓位在引擎里存成 `LONG` / `SHORT`**，订单上才是 `BOTH`（设计缺口 #12）

决定和理由的完整对照表在讲义 `04-order-validation.md` 第 5 节。

### `execute-order.ts` —— 下了单之后发生什么（第 05 讲新增）

两个主函数：

| 函数 | 干什么 |
| --- | --- |
| `executeOrder` | 校验通过的订单下单那一刻能成交多少就成交多少：市价单逐档吃；限价单先判断会不会立刻成交，穿透的部分成交，IOC 剩余过期、FOK 不够就整单过期、GTC 剩余挂单（排队位置 0） |
| `applyFill` | 一笔成交落账：先平仓（算已实现盈亏、释放逐仓保证金）→ 再开仓（加权均价）→ 收手续费 → 发 `balanceUpdate`。第 06 讲 Maker 成交也用它 |

另外：`executeOrder` 里不穿透盘口的 GTC / GTX 限价单估算排队位置后挂进挂单簿（第 06 讲）。

读的时候抓住三件事：

1. **钱包余额只通过 `balanceUpdate` 改**：一笔成交最多两条，`REALIZED_PNL` 在前、`FEE` 在后
2. **只减仓类订单成交时截断到剩余仓位**；仓位平完后，同方向残余的只减仓挂单自动撤销
3. **盘口快照不被修改**：模拟用户之间共享流动性（已知失真点 #2）

事件顺序：`orderUpdate` 在最前（数据库外键要先写订单），然后每笔成交的 `fill` → `positionUpdate` → `balanceUpdate`。

### `queue.ts` + `resting-orders.ts` —— 挂着的单怎么成交（第 06 讲新增）

`queue.ts` 只算数，三个纯函数；`resting-orders.ts` 把它们接到输入上、改状态、发事件。

| 输入 | 函数 | 干什么 |
| --- | --- | --- |
| `placeOrder`（不穿透） | `estimateQueueAhead` | 挂单价在自己这侧盘口里：正好有这一档 → 前方是这一档的量；可见范围内没有这一档 → 0；比 20 档还深 → 用最深档兜底，标记估算 |
| `book` | `reconcileBook` → `reconcileQueue` | 这一档总量比前方少了就夹下来；可见范围内这一档没了 → 0；掉出视野 → 不动。**不发事件** |
| `trade` | `matchTrade` → `consumeQueue` → `applyFill` | 看 `m` 判断吃的是哪一侧；价格穿过挂单价 → 剩余全成交；正好在挂单价 → 先消耗前方的量。成交价永远是挂单价，角色 `MAKER` |
| `cancelOrder` | `cancelOrder` | 移出内存、发 `CANCELED`；不存在 / 已结束 / 不是自己的一律 `ORDER_NOT_FOUND` |

读的时候抓住三件事：

1. **`m = true` 推进买单，`m = false` 推进卖单**，弄反了挂单会在完全不该成交的时候成交
2. **所有推断往保守倒**：撤单默认在我后面、看不见的不归零——宁可成交慢，不能比真实交易所更容易成交（失真点 #3）
3. **`trade.qty` 是币安推送的 `nq`**（不含 RPI 订单），和 depth 流同口径

### `risk.ts` —— 爆仓（第 07 讲新增）

| 函数 | 干什么 |
| --- | --- |
| `riskScan` | 对一批账户扫描：先逐仓（每个仓位：逐仓保证金 + 浮盈亏 ≤ 维持保证金？），再全仓（整户：钱包 − 逐仓保证金 + 全仓浮盈亏 ≤ 全仓维持保证金之和？） |
| `liquidatePosition` | 平掉一个仓位：算破产价 → 强平单逐档吃盘口（比破产价差的不吃）→ 剩余按破产价平 → 收 Taker 手续费、再收清算费（都封顶到剩余资产）→ 发事件 |

谁调它：`apply.ts` 里 `markPrice` 之后（这个币对上有仓位的账户）、`trade` 和 `placeOrder` 产生成交之后（有成交的账户）。

读的时候抓住三件事：

1. **全仓钱包要减逐仓保证金**：逐仓保证金留在钱包里（缺口 #6），全仓判定时不减就会拿别人的钱给全仓兜底
2. **破产价是限价**：强平单只吃比破产价好的档位，所以用户最多亏光这个仓位能动用的资产，钱包永远不会变负
3. **强平会产出一张 `LIQUIDATION` 订单**：事件顺序是 失效的挂单 → 强平单 → 成交 → 仓位 → 强平记录 → `LIQUIDATION` / `FEE` / `LIQUIDATION_FEE` 流水

## 6. 测试是怎么保护这些代码的

### `testing/harness.ts` —— 每次 apply 都自动体检

测试里不直接用 `createEngine`，而是用 `createTestEngine`。它的 `apply` 会做这些事：

```
1. 拍快照 before
2. 真正 apply
3. 拍快照 after
4. rollback → 快照必须和 before 一模一样    ← 抓"有修改绕过了 journal"
5. restore(after) 把结果装回去
6. 累加每个账户所有 balanceUpdate 的 delta
7. 跑 9 条不变式
```

效果：**任何一个测试里的任何一次 apply，都顺带验证了回滚和对账**。写新功能时不用记得"要测回滚"，忘了也会被抓。

### `testing/invariants.ts` —— 9 条铁律

| # | 规则 | 抓什么 bug |
| --- | --- | --- |
| ① | 钱包余额 = 该账户所有流水之和 | 改了余额没发 `balanceUpdate` |
| ② | 仓位数量 ≥ 0 | 减仓减过头 |
| ③ | 下单成功后可用余额 ≥ 0（下单前本来就非负时） | 保证金没校验就开仓 |
| ④ | 状态 FILLED 的订单必须全部成交 | 状态机写错 |
| ⑤ | 成交量 ≤ 委托量 | 超额成交 |
| ⑥ | 只减仓/全部平仓单冻结保证金为 0 | 冻结算错 |
| ⑦ | 排队位置 ≥ 0 | 队列扣过头 |
| ⑧ | 内存里只有未完成订单 | 终态订单没清理 |
| ⑨ | 没有该强平没强平的仓位 | 漏了风控扫描、判定条件写错 |

从第 05 讲开始 `apply` 会真的创建仓位、挂单、改余额，这些不变式开始真正起作用：`execute-order.test.ts` 的每一次 `apply` 都被它们检查过。第 07 讲把 ③ 收窄成只在下单成功后检查（价格不利变动让可用余额变负是正常的，缺口 #19），新增 ⑨。

### `testing/fixtures.ts` —— 固定的测试数据

用的是设计文档里那张**示例**分层表，**故意不用**数据库里从币安同步的真实表——币安会调表（BTCUSDT 第 1 层上限已经从 50,000 变成 300,000），测试跟着真实数据走，币安一调表就全红。

### `purity.test.ts` —— 源码扫描

用正则扫所有非测试源码，禁止出现：`Date.now(`、`new Date(`、`Math.random(`、`crypto.randomUUID(`、`console.`、`setTimeout(`、`setInterval(`、`node:` 模块、`drizzle-orm`、`pg`、`@.../db`。

---

## 7. 名词对照

| 代码里 | 中文 | 一句话解释 |
| --- | --- | --- |
| `walletBalance` | 钱包余额 | 已经结算的钱，只有流水能改 |
| `marginBalance` | 保证金余额 | 钱包余额 + 浮盈浮亏 |
| `availableBalance` | 可用余额 | 还能拿来开新仓的钱 |
| `notional` | 名义价值 | 数量 × 价格，仓位"有多大" |
| `initialMargin` | 起始保证金 | 开仓要押的钱 = 名义价值 ÷ 杠杆 |
| `maintMargin` | 维持保证金 | 最低要保住的钱，跌破就强平 |
| `mmr` | 维持保证金率 | 分层表里的比例 |
| `cum` | 速算额 | 分层表里让各层衔接连续的修正值 |
| `bracket` | 杠杆分层 | 仓位越大，允许的杠杆越低、mmr 越高 |
| `isolatedMargin` | 逐仓保证金 | 锁在单个仓位里的钱，亏完只亏这部分 |
| `CROSS` / `ISOLATED` | 全仓 / 逐仓 | 全仓拿整个账户兜底 |
| `ONE_WAY` / `HEDGE` | 单向 / 双向持仓 | 单向时仓位方向是 `BOTH` |
| `MAKER` / `TAKER` | 挂单方 / 吃单方 | 手续费率不同 |
| `reduceOnly` | 只减仓 | 这张单只能让仓位变小 |
| `queueAhead` | 排队位置 | 限价单前面还排着多少量（第 06 讲拟真撮合用） |
| `markPrice` | 标记价 | 算盈亏和强平用的价格，不是最新成交价 |
| `journal` | undo 日志 | 本次 apply 改动前的旧值 |
| `snapshot` / `restore` | 快照 / 恢复 | 全量导出 / 全量载入账户类状态 |

---

## 8. 读的时候注意到的一个小问题

`shared` 里的 `mul` 是 bigint 除法，**向 0 截断**，不是向下取整。`position.ts` 注释说已实现盈亏"向下截断（保守）"：

- 盈利时（正数）：向 0 = 向下，少算一点盈利，确实保守 ✅
- 亏损时（负数）：向 0 = 往上，**少算了一点亏损**，和"保守"的意图相反

差距最多 0.00000001 USDT。**第 05 讲已经改掉**：`packages/shared` 加了 `mulFloor`（朝负无穷），`reducePosition` 改用它，亏损时多算不少算。

---

## 读完可以自测

1. 为什么引擎里不能写 `Date.now()`？时间从哪来？
2. 用户余额不够下单，和宿主传了一个不存在的币对，引擎的处理有什么不同？
3. 想改一个仓位的数量，为什么不能写 `state.positions.get(key)!.qty = x`？会在哪一层被拦住？
4. 写库失败调 `rollback()`，盘口数据会被撤回吗？为什么？
5. 开逐仓仓位时，钱包余额会变吗？
6. 现在调 `engine.apply({ t: "placeOrder", ... })` 会发生什么？分"校验不通过"、"市价单"、"不穿透盘口的 GTC 限价单"三种情况回答。
