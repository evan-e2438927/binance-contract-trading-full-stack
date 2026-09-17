# 02 · 系统架构设计（总纲）

> 这份文档定义**整个系统怎么切、各块怎么说话、全局规则是什么**。
> 每一块的内部细节在对应的子设计里，本文只到边界为止。

| 子设计 | 负责 |
| --- | --- |
| `03-database-design.md` | 表结构、索引、迁移、归档 |
| `04-backend-design.md` | 行情接入、撮合引擎、风控清算、接口实现 |
| `05-frontend-design.md` | 页面、组件、状态、实时更新 |
| `06-testing-design.md` | 测试分层、重放、不变式、压测与演练 |

---

## 一、架构全景

```
┌──────────────────────────────────────────────────────────┐
│  展现层  apps/web (Next.js)          → Cloudflare Workers │
│  交易页 / 历史页 / 排行榜                                  │
└───────────────┬──────────────────────────────────────────┘
                │  HTTPS (REST)  +  WSS (实时推送)
                ▼
┌──────────────────────────────────────────────────────────┐
│  服务层  apps/server (Hono, 常驻 Node 进程)      → VPS    │
│  ┌────────────┬─────────────┬──────────┬──────────────┐  │
│  │ REST 路由   │ WS 网关      │ 鉴权      │ 仓储层        │  │
│  └────────────┴─────────────┴──────────┴──────────────┘  │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │ 行情层 market/        │  │ 引擎宿主 engine-host/     │  │
│  │ 订阅币安、维护盘口     │─►│ 驱动引擎、落库、推送       │  │
│  └──────────┬───────────┘  └────────────┬─────────────┘  │
└─────────────┼──────────────────────────┼─────────────────┘
              │ WSS/HTTPS                │ 调用
              ▼                          ▼
    ┌──────────────────┐   ┌──────────────────────────────┐
    │ 币安公开接口       │   │ 引擎层 packages/engine        │
    │ fstream / fapi    │   │ 纯逻辑：撮合、风控、清算        │
    └──────────────────┘   │ 零依赖、零 IO、可确定性重放     │
                           └──────────────┬───────────────┘
                                          │ 只依赖
                                          ▼
                           ┌──────────────────────────────┐
                           │ packages/shared               │
                           │ 类型、枚举、错误码、定标换算     │
                           └──────────────────────────────┘

              ┌──────────────────────────────┐
              │ 存储  Supabase Postgres       │
              │ 账户、订单、成交、流水、快照     │
              └──────────────────────────────┘
```

---

## 二、分层与职责

### 四层

| 层 | 位置 | 职责 | 绝不做 |
| --- | --- | --- | --- |
| **引擎层** | `packages/engine` | 撮合判定、仓位计算、保证金、强平、资金费 | 不碰数据库、不碰网络、不看时钟 |
| **行情层** | `apps/server/src/market` | 订阅币安、维护盘口/标记价/K 线、分发事件 | 不含任何业务规则 |
| **服务层** | `apps/server` 其余 | 驱动引擎、持久化、鉴权、对外接口、实时推送 | 不重新实现引擎已有的计算 |
| **展现层** | `apps/web` | 渲染、交互、本地状态 | **不算钱**（强平价、保证金率等一律由服务端下发） |

### 依赖方向（单向，不许反）

```
web  ──►  shared
server ──►  engine ──►  shared
server ──►  db ──►  shared
```

`engine` 依赖 `db` 或 `server` 是**架构错误**，不是"暂时这样"。

### 为什么把引擎抽成独立包

撮合和风控是这个系统里**唯一"算错就前功尽弃"**的部分。抽出来，是为了强制它满足三个约束：

1. 不依赖数据库 —— 输入输出都是纯数据结构
2. 不依赖网络 —— 行情由调用方喂进来
3. 不调 `Date.now()`、不用随机数 —— 时间戳从输入里带

满足这三条后，**任何一次真实交易过程都能被录成一串输入事件，在测试里逐字重放并断言每一步的仓位和余额**。出 bug 时能精确复现，这是最值钱的性质。

具体怎么测见 `06-testing-design.md`。

---

## 三、部署拓扑

```
                   ┌──────────────────┐
  用户浏览器 ──────►│ Cloudflare       │  apps/web
       │    HTTPS  │ Workers          │
       │           └──────────────────┘
       │
       │  WSS (实时) + HTTPS (下单/查询)
       ▼
  ┌─────────────────────────────┐        WSS        ┌─────────────────┐
  │ VPS（海外，可直连币安）       │◄──────────────────│ fstream.binance │
  │  apps/server                │       HTTPS       ├─────────────────┤
  │  常驻 Node 进程（单实例）     │──────────────────►│ fapi.binance    │
  └──────────────┬──────────────┘                   └─────────────────┘
                 │ Postgres (TLS)
                 ▼
        ┌────────────────────┐
        │ Supabase 云         │
        └────────────────────┘
```

### 为什么 server 不能放 Cloudflare Workers

脚手架默认用 `opennextjs-cloudflare` + Alchemy 把整个项目部署到 Workers。**web 可以，server 不行**，原因是硬性的：

| Workers 的限制 | 我们的需求 |
| --- | --- |
| 无常驻内存，每个请求是独立 isolate | 引擎要在内存里持续维护 20 个币对的盘口和所有挂单 |
| 无法主动发起出站长连接 WebSocket | 要一直连着币安的 WS |
| 无跨请求存活的定时器 | 资金费要按 UTC 整点定时结算 |

Durable Objects 理论上能顶一部分，但把引擎塞进 DO 会让第一版复杂度失控。

### VPS 要求

- 区域：**日本 / 新加坡 / 韩国**（延迟低且能直连币安）
- 起步配置：2 vCPU / 4 GB RAM / 40 GB SSD
- 独立域名 + TLS（浏览器的 WSS 要求 https 来源）
- 进程守护：`pm2` 或 systemd，配自动重启
- **上线前第一件事**：`curl -s https://fapi.binance.com/fapi/v1/time`，拿不到时间戳这台机器就不能用

---

## 四、三条关键数据流

理解这三条，就理解了整个系统的运转方式。

### 流 ① 行情：从币安到浏览器

```
币安 fstream
   │  @aggTrade / @depth20@100ms / @markPrice@1s / @kline
   ▼
market/binance-ws  ── 解析、校验 ──► 各 store 更新内存快照
   │                                      │
   │                                      ├──► WS 网关 ──► 浏览器（公共频道）
   │                                      │
   └──────────► engine-host ──► engine.apply({t:'trade'|'book'|'markPrice'})
                                   │
                                   └──► 可能产生成交/强平 → 走流 ③
```

**要点**：行情**只从一个地方进来**（服务端），前端拿到的和引擎用的是同一份数据。这样就不会出现"页面显示成交了但我的单没成交"。

### 流 ② 下单：从浏览器到引擎

```
浏览器下单面板
   │  POST /orders  { clientOrderId, symbol, side, type, price, qty, ... }
   ▼
REST 路由 ── JWT 鉴权 ──► 参数校验（zod）
   │
   ▼
engine-host ──► engine.apply({t:'placeOrder', ...})
                    │
                    ├─ 13 步下单校验链（见 04 文档）
                    ├─ 立刻成交？逐档吃单
                    └─ 挂单？计算初始排队位置
                    │
                    ▼
              EngineEvent[]
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
   persister（事务落库）      WS 网关（私有频道推送）
```

**要点**：引擎是同步纯函数，`apply()` 返回一个事件数组。宿主拿到后做两件事——**写库、推前端**。引擎自己什么都不干。

### 流 ③ 成交与强平：由行情驱动

```
收到 @aggTrade
   │
   ▼
engine.apply({t:'trade'})
   │
   ├─ 遍历该币对的所有挂单，消耗排队位置
   ├─ 产生成交 → 更新仓位、扣手续费、改余额
   └─ 受影响账户跑风控扫描
          │
          └─ 保证金率 ≥ 100%？→ 强平：撤单 → 按标记价平仓 → 收清算费
   │
   ▼
EngineEvent[] → 事务落库 + 推送（含强平通知）
```

**要点**：撮合不是定时轮询，是**行情事件驱动**。定时轮询会漏掉两次 tick 之间的价格穿透。

---

## 五、数值精度（全局横切规则）

### 问题

JavaScript 的 `number` 是 IEEE 754 双精度浮点，`0.1 + 0.2 === 0.30000000000000004`。

在这个系统里，这个误差长这样：用户开 20 倍杠杆，强平价算出来差 0.0001，他截图说"我明明没到强平价就爆了"。**没法解释，只能认错。**

### 方案：bigint 整数定标

**全程用 `bigint` 存放定标后的整数，SCALE = 10⁸。**

```ts
// packages/shared/src/fixed.ts
export const SCALE = 100_000_000n        // 1e8
export type Fixed = bigint               // 语义标记：定标后的整数

parse('50000.25')      // → 5000025000000n
format(5000025000000n) // → "50000.25000000"
mul(a, b)              // → a * b / SCALE
div(a, b)              // → a * SCALE / b
```

为什么是 8 位：币安的价格、数量精度最深就是 8 位小数，够用且不浪费。

为什么用 `bigint` 而不是 `decimal.js`：语言原生、无依赖、无对象分配开销。引擎一秒要跑上千次运算，这个差别是实的。代价是写法啰嗦（不能直接 `+ - * /`），但在一个"算错就完蛋"的模块里，**这个代价是该付的**——它逼你每一步都想清楚在做什么运算。

### 舍入规则（必须统一，否则对不上账）

| 场景 | 规则 | 理由 |
| --- | --- | --- |
| 价格对齐 `tickSize` | 买单**向下**、卖单**向上** | 保守，不凭空给用户更好的价 |
| 数量对齐 `stepSize` | **向下** | 不能超出用户想下的量 |
| 手续费 | **向上**到 8 位 | 和币安一致，摩擦成本不被低估 |
| 已实现盈亏 | **向下**（截断） | 保守 |
| 未实现盈亏 / 保证金 / 强平价 | **四舍五入**到 8 位 | 展示类数值，居中处理 |

这张表落成 `packages/shared` 的函数，**不许在业务代码里临时写舍入**。

### 三个边界的表示形式

| 位置 | 类型 |
| --- | --- |
| 引擎 / 服务层内部 | `bigint`（定标 1e8） |
| Postgres | `bigint`（int8） |
| JSON 传输 | **字符串**，如 `"50000.25"` |

JSON 必须用字符串：`JSON.stringify` 处理不了 `bigint` 会直接抛错，转 `number` 又把精度问题带回前端。**统一在序列化边界上做转换。**

Postgres `bigint` 上限 9.22×10¹⁸ ÷ 1e8 ≈ **922 亿**，模拟账户够用。

### 命名防呆

定标数值不加后缀、类型标 `Fixed`；**非定标数值必须加 `Num` 后缀**。

```ts
const price: Fixed = parse('50000.25')   // bigint
const leverageNum: number = 10           // 普通数字
```

看到没有 `Num` 后缀的数值变量，默认它是 `bigint`。

---

## 六、跨层契约

### ① 引擎 ↔ 宿主

> 以 `packages/engine/src/types.ts` 为准。下面三段是从那里复制过来的，改契约先改代码再同步这里。

引擎由 `createEngine(config: EngineConfig, initial?: EngineSnapshot)` 创建，`config` 包含币对规格、分层表、费率和限额（宿主启动时从数据库读出来一次性喂进去；分层表每日同步有变化时，由宿主热加载——在第 11 讲接入之前需重启生效，见第九节 #9）。对外接口：

```ts
/**
 * 宿主的调用协议：
 *
 *   const events = engine.apply(input)
 *   try { persist(events); engine.commit() } catch { engine.rollback() }
 *
 * 每次 apply 之后必须恰好调一次 commit() 或 rollback()，否则下一次 apply 直接抛错。
 */
export interface Engine {
  /**
   * 同步、确定性：同样的状态 + 同样的输入，永远得到同样的事件。
   * 抛出程序错误时，本次改动已自动撤销，不需要（也不能）再调 rollback()。
   */
  apply(input: EngineInput): EngineEvent[];
  /** 宿主落库成功后调用：本次 apply 的改动生效。代价 O(1)。 */
  commit(): void;
  /**
   * 宿主落库失败后调用：账户类状态回到本次 apply 之前，行情类状态不动。
   * 代价 O(本次改动的对象数)，和账户总数无关。
   */
  rollback(): void;
  /** 返回深拷贝，调用方怎么改都影响不到引擎。代价 O(全体账户)——只用于重启恢复、测试、排查，不要每次 apply 都调。 */
  snapshot(): EngineSnapshot;
  /** 用快照整体替换账户类状态，行情状态保持不变。有未结算的 apply 时抛错。 */
  restore(snapshot: EngineSnapshot): void;
}
```

`commit()` / `rollback()` 的设计理由见第七节"回滚怎么做"。

**输入事件**（全部由宿主构造，时间戳从外面带；订单 id 由宿主生成放进 `placeOrder`，引擎不生成随机 id）：

```ts
export type EngineInput =
  // —— 行情（来自行情层） ——
  | { t: "book"; symbol: string; bids: Level[]; asks: Level[]; ts: number }
  | { t: "trade"; symbol: string; price: Fixed; qty: Fixed; buyerIsMaker: boolean; ts: number }
  | {
      t: "markPrice";
      symbol: string;
      markPrice: Fixed;
      fundingRate: Fixed;
      nextFundingTs: number;
      ts: number;
    }
  | { t: "settleFunding"; symbol: string; rate: Fixed; markPrice: Fixed; ts: number }
  // —— 账户（来自鉴权/账户接口） ——
  | {
      t: "registerAccount";
      accountId: string;
      walletBalance: Fixed; // 开户发放的初始资金，引擎会为它产出一条 INITIAL 流水
      positionMode: PositionMode;
      ts: number;
    }
  | { t: "resetAccount"; accountId: string; walletBalance: Fixed; ts: number }
  | { t: "setPositionMode"; accountId: string; mode: PositionMode; ts: number }
  // —— 交易（来自交易接口） ——
  | { t: "placeOrder"; accountId: string; orderId: string; req: PlaceOrderRequest; ts: number }
  | { t: "cancelOrder"; accountId: string; orderId: string; ts: number }
  | { t: "setLeverage"; accountId: string; symbol: string; leverageNum: number; ts: number }
  | { t: "setMarginMode"; accountId: string; symbol: string; mode: MarginMode; ts: number }
  | {
      t: "adjustIsolatedMargin";
      accountId: string;
      symbol: string;
      positionSide: PositionSide;
      delta: Fixed; // 正数划入，负数划出
      ts: number;
    };
```

**输出事件**（宿主负责落库和推送）：

```ts
/** 流水关联的业务对象，对应 ledger_entries 的 ref_type / ref_id。 */
export interface LedgerRef {
  type: "fill" | "funding" | "liquidation";
  id: string;
}

export type EngineEvent =
  | { t: "orderUpdate"; order: Order }
  | { t: "fill"; fill: Fill }
  | { t: "positionUpdate"; position: Position }
  | { t: "settingUpdate"; setting: AccountSymbolSetting }
  | { t: "positionModeUpdate"; accountId: string; positionMode: PositionMode; ts: number }
  | {
      // ★ 唯一能改余额的事件。宿主把它落成一条 ledger_entries，balanceAfter = walletBalance
      t: "balanceUpdate";
      accountId: string;
      walletBalance: Fixed; // 变动之后的余额
      delta: Fixed; // 有符号的变动量
      reason: LedgerType;
      symbol: string | null;
      ref: LedgerRef | null;
      ts: number;
    }
  | { t: "liquidation"; record: LiquidationRecord }
  | { t: "fundingPaid"; payment: FundingPayment }
  | {
      t: "rejected";
      accountId: string;
      input: EngineInputType; // 被拒绝的是哪种输入
      clientOrderId: string | null; // 只有 placeOrder 被拒时才有
      orderId: string | null;
      code: ErrorCode;
      message: string; // 给用户直接看的中文
      ts: number;
    };
```

### ② 服务层 ↔ 前端

- **REST**：请求/响应体用 zod schema 定义在 `packages/shared`，前后端共用同一份类型
- **WebSocket**：公共频道（行情）+ 私有频道（账户），协议见 `04-backend-design.md`
- **统一响应包络**：

```jsonc
{ "ok": true,  "data": { /* ... */ } }
{ "ok": false, "error": { "code": "INSUFFICIENT_MARGIN", "message": "可用余额不足，需要 5025.00 USDT，当前 3200.00 USDT" } }
```

`message` 是**给用户直接看的中文**，前端不做二次翻译。

### ③ 服务层 ↔ 数据库

仓储层封装所有 Drizzle 查询，业务代码不直接写 SQL。

**一条硬规则**：任何资金变动必须写 `ledger_entries`，且这个不变式恒成立——

```
accounts.wallet_balance === SUM(ledger_entries.amount) WHERE account_id = ?
```

---

## 七、状态归属与持久化

### 谁是权威

**内存是权威，数据库是为了重启能恢复和查历史。**

| 数据 | 内存 | 数据库 | 说明 |
| --- | --- | --- | --- |
| 盘口 20 档 | ✅ | ❌ | 100ms 刷新，落库没意义 |
| 标记价 / 资金费率 | ✅ | ❌ | 同上 |
| K 线缓存 | ✅ | ❌ | 要历史走币安 REST |
| 账户余额 | ✅ | ✅ | 内存权威，变动同步写库 |
| 仓位 | ✅ | ✅ | 同上 |
| 未完成订单 | ✅ | ✅ | 同上 |
| 订单排队位置 | ✅ | ✅ | 随订单落库，重启要用 |
| 成交记录 | ❌ | ✅ | 只追加 |
| 资金流水 | ❌ | ✅ | 只追加 |
| 每日权益快照 | ❌ | ✅ | 定时任务写 |

### 内存规模：有上界，不随运行时间增长

会无限增长的东西（成交、流水、终态订单、权益快照）**一律不进内存**。内存里只有"当前活着的"状态，大小只取决于账户数：

| 状态 | 单条估算 | 上界由什么保证 |
| --- | --- | --- |
| 账户 | ~1 KB | 注册数 |
| 杠杆设置 | ~0.2 KB | 每账户 ≤ 币对数（20） |
| 仓位 | ~0.5 KB | 每账户 ≤ 币对数 × 2（双向持仓） |
| 未完成订单 | ~0.5 KB | 每账户每币对 ≤ 200（下单校验链第 13 步 `TOO_MANY_ORDERS`，2026-09-17 按币安 `MAX_NUM_ORDERS` 改为按币对计数），即每账户 ≤ 20 × 200 = 4,000 |
| 盘口 / 标记价 / 最新价 | 几十 KB 合计 | 20 个币对 × 20 档，固定 |

粗算：1 万个账户、人均 5 个仓位 + 10 张挂单 + 20 条设置 ≈ **125 MB**；按上界（每人 40 仓位 + 4,000 挂单）算约 2 GB 每万户——上界仍然有限，但挂单上界已不是主要约束，实际规模取决于人均挂单数。单实例模拟盘不会先撞内存墙。

两条必须守住的规则，否则上界就不成立：

1. **终态订单必须移出内存**——引擎不变式 ⑧ 盯着。
2. **挂单数上限必须在引擎里校验**，不能只靠前端或路由层。

真正先到的瓶颈是 CPU 和 GC，而其中最容易踩的是下面"回滚怎么做"那一条。

### 落库时机

引擎返回的事件数组，宿主按类型分流：

```
【同步写，一个事务】
  balanceUpdate + fill + orderUpdate + positionUpdate + ledger
  → 一笔成交的所有变更，要么全成要么全不成
  → 写失败则回滚内存状态并告警

【异步批量写（攒 200ms 或 50 条）】
  纯挂单状态变化（下单成功、撤单）
  → 不涉及资金，晚一点没有正确性问题

【定时写】
  每日 UTC 00:00 的权益快照
```

### 回滚怎么做

"写失败则回滚内存"有一个看似顺手、实际会拖垮性能的写法：

```ts
// ❌ 每次 apply 前对整个引擎拍快照
const before = engine.snapshot()        // structuredClone 全部账户、仓位、挂单
const events = engine.apply(input)
try { await persist(events) } catch { engine.restore(before) }
```

`snapshot()` 的代价是 **O(全体账户)**，而一次 `apply` 通常只碰到几个账户。1 万个账户时每笔成交都要深拷贝上百 MB 临时对象，`aggTrade` 一密集，进程大部分时间在做 GC。

推荐做法是 **undo 日志（只记被改动的对象的旧值）**：

```
apply(input)
  → 修改 accounts / settings / positions / orders 中某个键之前，
    先把这个键的旧值（不存在则记"不存在"）存进本次 apply 的日志
  → 同一个键在一次 apply 里只记第一次
宿主落库成功 → engine.commit()     丢弃日志
宿主落库失败 → engine.rollback()   日志里每个键恢复成旧值（旧值是"不存在"就删掉），行情类状态不动
```

因为每个键只记第一次的旧值，恢复时和顺序无关。

代价变成 **O(本次改动的对象数)**，和总账户数无关。

- `snapshot()` / `restore()` 保留，用于重启恢复、测试和人工排查，**不用于每次 apply 的回滚**。
- 每次 `apply` 之后必须恰好调一次 `commit()` 或 `rollback()`：上一次没结算就再 `apply`、没有待结算时调 `commit`/`rollback`、有待结算时 `restore`，都抛程序错误。宿主单线程顺序处理输入，这条天然满足。
- 纯挂单变化走异步批量写：宿主 `apply` 之后直接 `commit()`，之后批量写失败**不回滚内存**，只重试和告警（它们本来就允许晚写，丢了也只是挂单状态，见下面的取舍）。
- `apply` 自己抛出程序错误时，引擎已经自动撤销本次改动，宿主不需要也不能再调 `rollback()`。一次 `apply` 要么完整生效，要么什么都没发生。
- 行情类状态不进日志：币安的价格不会因为我们写库失败就倒退。
- 怎么保证"每一处修改都进了日志"：账户类 Map 在类型上是只读的，只能通过 `putAccount` / `putOrder` 等函数改；存进去的对象被冻结，原地改运行时直接抛错；测试脚手架在每次 `apply` 之后都做一次"回滚后必须和 apply 前一致"的自检。

> 已实现：`packages/engine/src/journal.ts`，讲解见教程第 02 讲第 7 节。

> **必须承认的取舍**：单实例 + "内存权威、事务落库"，在进程被 `kill -9` 的瞬间，最后一批异步写可能丢。丢的只是挂单状态（可重新下单恢复），资金类走同步事务不会丢。第一版接受这个风险。要做多实例就必须引入事件溯源或 Redis，那是另一套架构。

### 重启恢复

```
1. 读账户余额、仓位、未完成订单 → 内存
2. 排队位置的处理：
   ⚠️ 不能直接用库里的旧值——停机期间盘口早变了
   → 重置为"当前该价位的挂单总量"（保守：假设自己排在最后）
3. 用当前标记价重算所有仓位的未实现盈亏和强平价
4. 立刻跑一轮全账户风控扫描：停机期间已经该强平的，现在补上
```

第 4 步很重要：如果服务停了 10 分钟而价格暴跌，恢复后必须按**当前标记价**判定强平，不能装作无事发生。

### 行情断线时

- 引擎**暂停**处理拟真成交（没有行情就不该凭空成交）
- 前端推 `{ t: 'marketStatus', status: 'degraded' }`，界面顶部出黄条
- 恢复后**不补算**断线期间的成交

最后一条是原则问题：这是模拟盘，诚实地告诉用户"这段时间没撮合"，比伪造一段历史好。

---

## 八、关键架构决策记录

把"为什么这么定"留在纸上，避免半年后有人以为是随手写的。

| # | 决策 | 放弃的方案 | 理由 |
| --- | --- | --- | --- |
| A1 | 引擎抽成零依赖纯函数包 | 引擎直接读写数据库 | 换来确定性重放测试，这是正确性的唯一抓手 |
| A2 | 全程 bigint 定标 1e8 | float / decimal.js | float 会让强平价出错；decimal.js 有性能开销 |
| A3 | 行情服务端统一订阅再转发 | 前端直连币安 | 避免前端和引擎看到两份数据 |
| A4 | 内存权威 + 事务落库，单实例 | 每次读写走数据库 / 引入 Redis | 引擎每秒上千次读写，走库不可能；Redis 对单实例是过度设计 |
| A5 | server 独立 VPS，web 留 Workers | 全部上 Workers | Workers 没有常驻内存和出站长连接 |
| A6 | 深度用 20 档快照流 | 全量增量深度 | 增量要处理 out-of-sync 和快照对齐，收益不成正比 |
| A7 | 吃穿 20 档直接拒单 | 按最后一档 + 滑点惩罚成交 | 惩罚系数是拍脑袋的，用户一研究就露馅 |
| A8 | 跨层杠杆超限拒单 | 学币安自动降杠杆 | 自动降杠杆会悄悄改用户的强平价。（2026-09-17 核对：币安下单时同样直接拒单，错误码 `-2027 MAX_LEVERAGE_RATIO`（"Exceeded the maximum allowable position at current leverage."），并不会自动降杠杆，拒单和币安一致） |
| A9 | 前端不算任何钱 | 前端本地算强平价做即时反馈 | 两处算法一旦漂移，用户看到的和实际执行的不一样 |
| A10 | 账户重置走正常平仓流程 | 直接把余额设回 10000 | 保住"余额 == 流水之和"这个不变式 |

---

## 九、已知失真点

模拟盘和真实交易一定有差距。下面是**明确知道并选择接受**的差距。这份清单要同步做成产品页面上的"模拟规则说明"。

| # | 失真 | 影响 | 为什么接受 |
| --- | --- | --- | --- |
| 1 | 我们的单不进入真实盘口，不产生市场冲击 | 再大的单也不推动价格，只有逐档吃单的静态滑点 | 建市场影响模型是研究课题不是产品 |
| 2 | 多个模拟用户可同时吃掉同一档流动性 | 十个人同时市价买，都能按同一个价成交 | 要做流动性竞争得引入全局流动性账本 |
| 3 | 排队位置是估算的 | 靠"成交消耗 + 总量夹逼"推断，不是真实 FIFO | 币安不公开队列内部，任何人都只能估算 |
| 4 | 深度只有 20 档 | 超过一半深度的市价单被拒 | 拒单比编价格诚实 |
| 5 | 不做保险基金和 ADL | 极端行情下不会被自动减仓 | 工程量翻倍 |
| 6 | 穿仓不追偿 | 全仓爆仓后余额归零，不变成负债 | 模拟盘让用户背债没有意义 |
| 7 | 行情断线期间暂停撮合 | 这段时间的价格变动不产生成交 | 不伪造历史 |
| 8 | 挂单冻结保证金比币安保守 | 同时挂对敲单时占用资金更多 | 方向保守，不会超额开仓 |
| 9 | 杠杆分层表每日同步一次 | 币安盘中调表，最多滞后到次日 UTC 00:05；引擎热加载接入前还要等 server 重启 | 调表是低频事件，日级同步足够；同步失败保留旧表而不是猜 |
| 10 | 跨层杠杆超限拒单而非自动降杠杆 | ~~和币安行为不同~~ 经核对和币安一致（`-2027`），**不算失真**，保留编号只为不打乱引用 | 见 A8 |

> 这不是免责声明，是设计约束。**后续任何改动如果会让某一条变得更不诚实，就不该做**，即使"体验更好"。
