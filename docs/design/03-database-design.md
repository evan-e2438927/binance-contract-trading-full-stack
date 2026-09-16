# 03 · 数据库子设计

> 存储：Supabase Postgres ｜ ORM：Drizzle ｜ 位置：`packages/db/src/schema/`
> 所有金额/价格/数量列一律 `bigint`，存**定标 1e8 的整数**（见 `02-architecture.md` 第五节）。
> Drizzle 里用 `bigint(..., { mode: 'bigint' })`，读出来就是 JS `bigint`，和引擎类型直接对齐，中间不做转换。

---

## 一、表清单

14 张表，按用途分四组：

| 组 | 表 | 用途 | 写入频率 |
| --- | --- | --- | --- |
| **市场规格** | `symbols` | 币对规格（从币安 exchangeInfo 同步） | 每天一次 |
| | `leverage_brackets` | 杠杆分层表（人工维护） | 季度 |
| **账户** | `accounts` | 账户与钱包余额 | 每次资金变动 |
| | `identities` | 登录身份（钱包地址 / 邮箱 / Google），归属账户 | 每次注册 |
| | `auth_nonces` | 钱包登录的一次性挑战值 | 每次登录 |
| | `email_verification_codes` | 邮箱登录的一次性验证码 | 每次登录 |
| | `account_symbol_settings` | 每账户每币对的杠杆与保证金模式 | 低频 |
| **交易** | `positions` | 仓位 | 每次成交 |
| | `orders` | 订单 | 高频 |
| | `fills` | 成交明细（只追加） | 高频 |
| **账目** | `ledger_entries` | 资金流水（只追加，**账目唯一真相**） | 高频 |
| | `funding_payments` | 资金费结算明细 | 每 8 小时 |
| | `liquidations` | 强平记录 | 低频 |
| | `equity_snapshots` | 每日权益快照（排行榜/曲线） | 每天一次 |

### 实体关系

```
symbols ──1:N──► leverage_brackets

accounts ──1:N──► identities         应用层保证每个账户只挂一个身份，不做合并
         ├─1:N──► account_symbol_settings
         ├─1:N──► positions          唯一键 (accountId, symbol, positionSide)
         ├─1:N──► orders
         ├─1:N──► fills
         ├─1:N──► ledger_entries     ★ 余额的唯一真相
         ├─1:N──► funding_payments
         ├─1:N──► liquidations
         └─1:N──► equity_snapshots

orders ──1:N──► fills
```

---

## 二、枚举

```ts
// packages/db/src/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core'

export const chainEnum        = pgEnum('chain', ['evm', 'solana'])
export const authProviderEnum = pgEnum('auth_provider', ['wallet_evm', 'wallet_solana', 'email', 'google'])
export const positionModeEnum = pgEnum('position_mode', ['ONE_WAY', 'HEDGE'])
export const positionSideEnum = pgEnum('position_side', ['BOTH', 'LONG', 'SHORT'])
export const marginModeEnum   = pgEnum('margin_mode', ['CROSS', 'ISOLATED'])
export const orderSideEnum    = pgEnum('order_side', ['BUY', 'SELL'])
export const orderTypeEnum    = pgEnum('order_type', [
  'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET',
])
export const timeInForceEnum  = pgEnum('time_in_force', ['GTC', 'IOC', 'FOK', 'GTX'])
export const orderStatusEnum  = pgEnum('order_status', [
  'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED',
])
export const fillRoleEnum     = pgEnum('fill_role', ['MAKER', 'TAKER'])
export const workingTypeEnum  = pgEnum('working_type', ['MARK_PRICE', 'CONTRACT_PRICE'])
export const ledgerTypeEnum   = pgEnum('ledger_type', [
  'INITIAL',          // 开户发放
  'RESET',            // 账户重置
  'REALIZED_PNL',     // 平仓盈亏
  'FEE',              // 交易手续费
  'FUNDING',          // 资金费
  'LIQUIDATION',      // 强平结算
  'LIQUIDATION_FEE',  // 清算费
  'MARGIN_TRANSFER',  // 逐仓保证金划转
])
```

枚举值和币安保持一致的拼写，这样对照文档和排查问题时不用做心智翻译。

---

## 三、市场规格

### `symbols`

```ts
export const symbols = pgTable('symbols', {
  symbol:            text('symbol').primaryKey(),        // 'BTCUSDT'
  baseAsset:         text('base_asset').notNull(),       // 'BTC'
  quoteAsset:        text('quote_asset').notNull(),      // 'USDT'
  status:            text('status').notNull(),           // 'TRADING' / 'SETTLING' ...
  pricePrecision:    integer('price_precision').notNull(),
  quantityPrecision: integer('quantity_precision').notNull(),
  tickSize:          bigint('tick_size',    { mode: 'bigint' }).notNull(),
  stepSize:          bigint('step_size',    { mode: 'bigint' }).notNull(),
  minQty:            bigint('min_qty',      { mode: 'bigint' }).notNull(),
  minNotional:       bigint('min_notional', { mode: 'bigint' }).notNull(),
  enabled:           boolean('enabled').notNull().default(false),  // 我们是否开放
  sortOrder:         integer('sort_order').notNull().default(0),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`enabled` 和 `sortOrder` 是我们自己的字段。同步脚本把币安全部币对写进来，但只有 `enabled = true` 的 20 个真正对外开放。**加币对只改一行数据，不用发版。**

### `leverage_brackets`

```ts
export const leverageBrackets = pgTable('leverage_brackets', {
  id:             uuid('id').primaryKey().defaultRandom(),
  symbol:         text('symbol').notNull().references(() => symbols.symbol),
  bracket:        integer('bracket').notNull(),          // 层号，从 1 开始
  notionalFloor:  bigint('notional_floor', { mode: 'bigint' }).notNull(),
  notionalCap:    bigint('notional_cap',   { mode: 'bigint' }).notNull(),
  maxLeverage:    integer('max_leverage').notNull(),
  mmr:            bigint('mmr', { mode: 'bigint' }).notNull(),  // 0.4% → 400000n
  cum:            bigint('cum', { mode: 'bigint' }).notNull(),  // 速算额
}, (t) => [
  uniqueIndex('lb_symbol_bracket_uq').on(t.symbol, t.bracket),
  index('lb_symbol_cap_idx').on(t.symbol, t.notionalCap),
])
```

**`mmr` 也走定标 1e8**：0.4% = 0.004 → `400000n`。不要用 float 存比例，否则精度问题从这里溜进强平价计算。

> **必须配一个校验脚本**：对每个币对，遍历相邻两层的边界名义价值 N，断言
> `N × mmr_低层 − cum_低层 === N × mmr_高层 − cum_高层`。
> 不相等说明表抄错了。这个脚本进 CI，每次改分层表都跑。

---

## 四、账户

### `accounts`

```ts
export const accounts = pgTable('accounts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  walletBalance: bigint('wallet_balance', { mode: 'bigint' }).notNull().default(0n),
  positionMode:  positionModeEnum('position_mode').notNull().default('ONE_WAY'),
  lastResetAt:   timestamp('last_reset_at', { withTimezone: true }),
  nickname:      text('nickname'),               // 排行榜显示名，默认脱敏地址/邮箱
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:    timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`accounts` 本身**不记录任何登录方式**，只管交易相关的状态（余额、持仓模式、昵称）。登录身份（钱包地址 / 邮箱 / Google）全部挪到下面的 `identities` 表——这样以后再加一种登录方式，不用碰这张核心表，也不用给它加新的可空列。

### `identities`

```ts
export const identities = pgTable('identities', {
  id:         uuid('id').primaryKey().defaultRandom(),
  accountId:  uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  provider:   authProviderEnum('provider').notNull(),
  providerId: text('provider_id').notNull(),
  // wallet_evm    → 小写地址
  // wallet_solana → base58 原样
  // email         → 小写邮箱
  // google        → Google 的 sub（用户唯一 id，不用 email，因为 email 可换绑）
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('identities_provider_uq').on(t.provider, t.providerId),
  index('identities_account_idx').on(t.accountId),
])
```

`(provider, providerId)` 唯一：一个身份只能对应一个账户。**应用层规定每个账户永远只挂一个身份**——注册时一起创建，之后不提供"再绑定一个身份"或"合并账户"的功能。同一个人用 MetaMask 和 Phantom 登录，或者钱包和邮箱各登录一次，会各自得到一个独立账户——这是 `00-overview.md` "跨身份账户合并"那条决定的直接延伸，**是有意的**，不是遗漏。

### `auth_nonces`

```ts
export const authNonces = pgTable('auth_nonces', {
  id:        uuid('id').primaryKey().defaultRandom(),
  address:   text('address').notNull(),
  chain:     chainEnum('chain').notNull(),
  nonce:     text('nonce').notNull(),
  message:   text('message').notNull(),   // ★ 完整的待签名文本，验签时按原文比对
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt:    timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('nonces_addr_idx').on(t.chain, t.address),
  index('nonces_expires_idx').on(t.expiresAt),
])
```

`message` 字段存完整原文是**安全要点**：验签必须用服务端存的这份原文，不能用客户端回传的文本，否则攻击者可以让你去验一段他自己构造的内容。

有效期 5 分钟，用过即废（`usedAt` 非空就拒绝）。过期记录每天清一次。

### `email_verification_codes`

```ts
export const emailVerificationCodes = pgTable('email_verification_codes', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull(),
  codeHash:  text('code_hash').notNull(),   // sha256(6 位验证码)，不存明文
  attempts:  integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt:    timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('email_codes_email_idx').on(t.email),
  index('email_codes_expires_idx').on(t.expiresAt),
])
```

和 `auth_nonces` 同一个模式：一次性、有效期、用过即废。区别是这里存的是**哈希**而不是原文——验证码只有 6 位数字，泄库后被拿去暴力撞库的风险比钱包签名 nonce 高得多，哈希后即使数据库被拖也不能直接拿去登录。`attempts` 到 5 次这条记录直接作废，防止在有效期内枚举。

有效期 5 分钟；同一邮箱 60 秒内不能重复请求发码，防止被刷。

### `account_symbol_settings`

```ts
export const accountSymbolSettings = pgTable('account_symbol_settings', {
  accountId:  uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:     text('symbol').notNull().references(() => symbols.symbol),
  leverage:   integer('leverage').notNull().default(20),
  marginMode: marginModeEnum('margin_mode').notNull().default('CROSS'),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.accountId, t.symbol] }),
])
```

没有记录时用默认值（20x、全仓），**不需要开户时预创建 20 条**。

---

## 五、交易

### `positions`

```ts
export const positions = pgTable('positions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  accountId:      uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:         text('symbol').notNull().references(() => symbols.symbol),
  positionSide:   positionSideEnum('position_side').notNull(),
  marginMode:     marginModeEnum('margin_mode').notNull(),
  leverage:       integer('leverage').notNull(),
  qty:            bigint('qty',             { mode: 'bigint' }).notNull().default(0n),
  entryPrice:     bigint('entry_price',     { mode: 'bigint' }).notNull().default(0n),
  isolatedMargin: bigint('isolated_margin', { mode: 'bigint' }).notNull().default(0n),
  openedAt:       timestamp('opened_at',  { withTimezone: true }),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('pos_acc_sym_side_uq').on(t.accountId, t.symbol, t.positionSide),
  index('pos_symbol_open_idx').on(t.symbol).where(sql`qty > 0`),
])
```

**两个设计点**：

1. **平仓后行不删除**（`qty = 0` 保留）。删了之后切换持仓模式、查历史都要处理"不存在"的分支，留着更简单。
2. **`qty` 恒为非负**，方向完全由 `positionSide` 决定。负数在 bigint 运算里到处要判符号，容易在某个分支漏掉。
3. `pos_symbol_open_idx` 是**部分索引**，只索引 `qty > 0` 的行。资金费结算和强平扫描都要按币对捞活跃仓位，这个索引直接决定那两个高频操作的性能。

### `orders`

```ts
export const orders = pgTable('orders', {
  id:             uuid('id').primaryKey().defaultRandom(),
  clientOrderId:  text('client_order_id').notNull(),
  accountId:      uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:         text('symbol').notNull().references(() => symbols.symbol),
  side:           orderSideEnum('side').notNull(),
  positionSide:   positionSideEnum('position_side').notNull(),
  type:           orderTypeEnum('type').notNull(),
  timeInForce:    timeInForceEnum('time_in_force').notNull().default('GTC'),
  price:          bigint('price',      { mode: 'bigint' }),   // 市价单为 null
  stopPrice:      bigint('stop_price', { mode: 'bigint' }),   // 触发单的触发价
  workingType:    workingTypeEnum('working_type').notNull().default('MARK_PRICE'),
  qty:            bigint('qty',          { mode: 'bigint' }).notNull(),
  executedQty:    bigint('executed_qty', { mode: 'bigint' }).notNull().default(0n),
  avgPrice:       bigint('avg_price',    { mode: 'bigint' }).notNull().default(0n),
  reduceOnly:     boolean('reduce_only').notNull().default(false),
  closePosition:  boolean('close_position').notNull().default(false),
  status:         orderStatusEnum('status').notNull().default('NEW'),
  triggered:      boolean('triggered').notNull().default(false),
  queueAhead:     bigint('queue_ahead', { mode: 'bigint' }).notNull().default(0n),
  queueEstimated: boolean('queue_estimated').notNull().default(false),
  frozenMargin:   bigint('frozen_margin', { mode: 'bigint' }).notNull().default(0n),
  rejectReason:   text('reject_reason'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('orders_acc_client_uq').on(t.accountId, t.clientOrderId),
  index('orders_open_idx').on(t.symbol, t.status).where(sql`status IN ('NEW','PARTIALLY_FILLED')`),
  index('orders_acc_created_idx').on(t.accountId, t.createdAt.desc()),
])
```

**三个设计点**：

1. `queueAhead` / `queueEstimated` 是拟真撮合的状态，跟着订单一起持久化。重启时不直接复用旧值（见 `02-architecture.md` 第七节），但保留它们对排查问题很有用。
2. `orders_acc_client_uq` 保证下单接口**幂等**：前端重试同一个 `clientOrderId` 不会重复下单。
3. `orders_open_idx` 也是部分索引，理由同 `positions`。

### `fills`

```ts
export const fills = pgTable('fills', {
  id:            uuid('id').primaryKey().defaultRandom(),
  orderId:       uuid('order_id').notNull().references(() => orders.id),
  accountId:     uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:        text('symbol').notNull(),
  side:          orderSideEnum('side').notNull(),
  positionSide:  positionSideEnum('position_side').notNull(),
  price:         bigint('price', { mode: 'bigint' }).notNull(),
  qty:           bigint('qty',   { mode: 'bigint' }).notNull(),
  role:          fillRoleEnum('role').notNull(),
  fee:           bigint('fee',          { mode: 'bigint' }).notNull(),
  realizedPnl:   bigint('realized_pnl', { mode: 'bigint' }).notNull().default(0n),
  isLiquidation: boolean('is_liquidation').notNull().default(false),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('fills_acc_created_idx').on(t.accountId, t.createdAt.desc()),
  index('fills_order_idx').on(t.orderId),
])
```

**只追加，永不更新。**

---

## 六、账目

### `ledger_entries` —— 账目的唯一真相

```ts
export const ledgerEntries = pgTable('ledger_entries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  accountId:    uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  type:         ledgerTypeEnum('type').notNull(),
  symbol:       text('symbol'),                   // 与币对无关的流水为 null
  amount:       bigint('amount',        { mode: 'bigint' }).notNull(),  // 有符号
  balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
  refType:      text('ref_type'),                 // 'fill' / 'funding' / 'liquidation'
  refId:        uuid('ref_id'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ledger_acc_created_idx').on(t.accountId, t.createdAt.desc()),
  index('ledger_acc_type_idx').on(t.accountId, t.type),
])
```

**要守住的不变式**：

```sql
-- 任何账户，任何时刻，这个查询都必须返回 0 行
SELECT a.id, a.wallet_balance, l.s AS ledger_sum
FROM accounts a
JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l
  ON l.account_id = a.id
WHERE a.wallet_balance <> l.s;
```

做成**每小时跑一次的对账任务**，不一致立刻告警。

这是整个系统里最值得投入的一个检查——它把"钱算错了"从一个用户投诉问题变成一个**自动发现**的问题。

`balanceAfter` 冗余存了每笔之后的余额：查流水页不用累加，排查断点也容易。

### `funding_payments`

```ts
export const fundingPayments = pgTable('funding_payments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  accountId:    uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:       text('symbol').notNull(),
  positionSide: positionSideEnum('position_side').notNull(),
  fundingRate:  bigint('funding_rate', { mode: 'bigint' }).notNull(),
  markPrice:    bigint('mark_price',   { mode: 'bigint' }).notNull(),
  notional:     bigint('notional',     { mode: 'bigint' }).notNull(),
  amount:       bigint('amount',       { mode: 'bigint' }).notNull(),  // 有符号：付出为负
  settledAt:    timestamp('settled_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('funding_acc_settled_idx').on(t.accountId, t.settledAt.desc()),
  uniqueIndex('funding_uq').on(t.accountId, t.symbol, t.positionSide, t.settledAt),
])
```

`funding_uq` 是**防重复结算**的保险：定时器如果因重启而重复触发，唯一约束会挡住第二次写入。

### `liquidations`

```ts
export const liquidations = pgTable('liquidations', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  accountId:           uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  symbol:              text('symbol').notNull(),
  positionSide:        positionSideEnum('position_side').notNull(),
  marginMode:          marginModeEnum('margin_mode').notNull(),
  qty:                 bigint('qty',             { mode: 'bigint' }).notNull(),
  entryPrice:          bigint('entry_price',     { mode: 'bigint' }).notNull(),
  markPrice:           bigint('mark_price',      { mode: 'bigint' }).notNull(),
  realizedPnl:         bigint('realized_pnl',    { mode: 'bigint' }).notNull(),
  liquidationFee:      bigint('liquidation_fee', { mode: 'bigint' }).notNull(),
  marginBalanceBefore: bigint('margin_balance_before', { mode: 'bigint' }).notNull(),
  maintMarginAt:       bigint('maint_margin_at',       { mode: 'bigint' }).notNull(),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('liq_acc_created_idx').on(t.accountId, t.createdAt.desc()),
])
```

`marginBalanceBefore` 和 `maintMarginAt` 是**取证字段**：用户说"我不该被强平"时，把这两个数摆出来就能说清楚。别省。

### `equity_snapshots`

```ts
export const equitySnapshots = pgTable('equity_snapshots', {
  id:            uuid('id').primaryKey().defaultRandom(),
  accountId:     uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  snapDate:      date('snap_date').notNull(),        // UTC 日期
  equity:        bigint('equity',         { mode: 'bigint' }).notNull(), // 钱包余额 + 未实现盈亏
  walletBalance: bigint('wallet_balance', { mode: 'bigint' }).notNull(),
  cumulativePnl: bigint('cumulative_pnl', { mode: 'bigint' }).notNull(), // 自上次重置以来
  roi:           bigint('roi', { mode: 'bigint' }).notNull(),            // 收益率，定标 1e8
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('equity_acc_date_uq').on(t.accountId, t.snapDate),
  index('equity_date_roi_idx').on(t.snapDate, t.roi.desc()),
])
```

排行榜就是 `WHERE snap_date = today ORDER BY roi DESC LIMIT 100`，走 `equity_date_roi_idx` 一个索引搞定。

---

## 七、索引策略

只列真正被高频路径用到的：

| 索引 | 服务的查询 | 频率 |
| --- | --- | --- |
| `pos_symbol_open_idx`（部分） | 资金费结算、强平扫描按币对捞活跃仓位 | 每秒 |
| `orders_open_idx`（部分） | 引擎恢复、按币对捞未完成挂单 | 启动 + 每秒 |
| `identities_provider_uq` | 登录查身份 → 查账户 | 登录时 |
| `orders_acc_client_uq` | 下单幂等检查 | 每次下单 |
| `ledger_acc_created_idx` | 资金流水分页 | 用户触发 |
| `fills_acc_created_idx` | 成交历史分页 | 用户触发 |
| `equity_date_roi_idx` | 排行榜 | 用户触发 |

**两个部分索引是关键**。`positions` 和 `orders` 里绝大多数行都是已关闭/已完成的死数据，全表索引会随时间线性膨胀；部分索引的大小只和"当前活跃数量"成正比——那个数是有上限的。

---

## 八、归档策略

`fills` 和 `ledger_entries` 会持续增长：

```
1. 两张表按月做 Postgres 原生分区（PARTITION BY RANGE (created_at)）
2. 每月 1 日创建下个月的分区
3. 超过 90 天的分区 detach 后导出为 Parquet 存对象存储，再 drop
4. 用户查 90 天以前的历史：界面提示"仅保留最近 90 天"，第一版不做冷数据查询
```

**第一版可以先不分区**，但建表时就要留好口子——主键用 `(id, created_at)`：

```sql
PRIMARY KEY (id, created_at)
```

这样后续加分区不需要重建主键，不用停机。

---

## 九、迁移与种子

### 迁移流程（沿用脚手架）

```bash
pnpm run db:generate   # 从 schema 生成迁移 SQL
pnpm run db:migrate    # 应用迁移
pnpm run db:push       # 开发期直接推（不生成迁移文件）
pnpm run db:studio     # 可视化查看
```

**约定**：开发期用 `db:push` 快速迭代；schema 稳定后用 `db:generate` + `db:migrate`，迁移文件进版本库。

### 需要的脚本

| 脚本 | 做什么 | 何时跑 |
| --- | --- | --- |
| `seed:symbols` | 拉 `GET /fapi/v1/exchangeInfo`，写入/更新 `symbols`，按配置置 `enabled` | 每日定时 + 手动 |
| `seed:brackets` | 从仓库里的 JSON 导入 `leverage_brackets` | 手动，改表后 |
| `verify:brackets` | 分层连续性校验（见第三节） | CI + 每次导入后 |
| `reconcile:ledger` | 跑第六节的对账 SQL | 每小时定时 |
| `snapshot:equity` | 每日 UTC 00:00 写权益快照 | 定时 |
| `clean:nonces` | 清理过期 nonce | 每日 |

`seed:brackets` 的数据源是 `packages/db/src/seed/leverage-brackets.json`：**人工维护、进版本库、改动可追溯**。

> ⚠️ 分层表的数字必须从币安页面人工核对，**不要让 AI 凭记忆生成**。生成错了会导致所有强平价系统性偏差，而且很难被发现——`verify:brackets` 只能查出内部不连续，查不出整体抄错了一档。

---

## 十、给 `04-backend-design.md` 的接口约定

仓储层封装所有 Drizzle 查询，业务代码不直接写 SQL。要暴露的方法大致是：

```ts
// packages/db 或 apps/server/src/db
interface Repos {
  // 启动恢复
  loadActivePositions(): Promise<Position[]>
  loadOpenOrders(): Promise<Order[]>
  loadAccounts(ids: string[]): Promise<Account[]>

  // 市场规格（启动时全量加载进内存）
  loadEnabledSymbols(): Promise<SymbolSpec[]>
  loadBrackets(): Promise<Map<string, LeverageBracket[]>>

  // 事务写入：一笔成交的全部变更
  persistTradeBatch(events: EngineEvent[]): Promise<void>

  // 异步批量：纯挂单状态
  persistOrderUpdates(orders: Order[]): Promise<void>

  // 账户
  findOrCreateAccount(chain: Chain, address: string): Promise<{ account: Account; isNew: boolean }>
  resetAccount(accountId: string): Promise<void>

  // 查询（分页用游标，不用 offset）
  listFills(accountId: string, cursor?: string, limit?: number): Promise<Page<Fill>>
  listLedger(accountId: string, cursor?: string, limit?: number): Promise<Page<LedgerEntry>>
  // ...
}
```

`persistTradeBatch` 是最关键的一个：它必须把一笔成交带来的 `fill` + `orderUpdate` + `positionUpdate` + `balanceUpdate` + `ledger` **放在一个事务里**，要么全成要么全不成。
