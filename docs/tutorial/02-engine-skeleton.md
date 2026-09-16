# 02 · 搭建教程：引擎骨架与测试脚手架

> 这一讲一个公式都不写。
> 但后面 03–09 七讲都是往这个骨架里填逻辑：输入输出长什么样、内存状态怎么放、每次调用之后怎么自动对账——这三件事定错了，后面每一讲都要返工。

**这一讲结束时你会有什么**：

- `packages/engine` 包
- 完整的输入/输出事件类型（引擎和服务端之间的契约）
- 一个最小可运行的引擎：能接收行情、能开户
- 一个测试脚手架：每次 `apply` 之后**自动**检查账目，改了余额没写流水会立刻红
- 一个纯净性守卫：谁往引擎里写了 `Date.now()` 就红

**先读**：

- `docs/design/02-architecture.md` 第二节"为什么把引擎抽成独立包"、第六节"跨层契约"、第七节"状态归属"
- `docs/design/06-testing-design.md` 第 3 节"场景重放"、第 4 节"不变式检查"

**本讲共 7 节，最后是 20 条测试。**

---

## 第 1 节：引擎长什么样

### 概念：一个吃事件、吐事件的状态机

```
                 ┌──────────────────────┐
EngineInput ───► │       apply()        │ ───► EngineEvent[]
（发生了什么）   │                      │      （因此改变了什么）
                 │  EngineState（内存）  │
                 └──────────────────────┘
```

外面发生的一切——币安推来一笔成交、用户下了一张单、到了资金费结算时间——都会被宿主翻译成一个 `EngineInput` 喂进来。引擎更新自己的内存状态，然后返回一串 `EngineEvent` 告诉宿主"因此发生了这些变化"。宿主拿着这些事件去写数据库、推前端。**引擎自己不写库、不推送、不打日志。**

### 三条契约

**① 同步、确定性。** 同样的状态 + 同样的输入，永远得到同样的事件。所以引擎里不能读时钟、不能用随机数——**时间戳从输入带进来，订单 id 也由宿主生成后放进输入**。

为什么这么较真：线上出了"我明明没到强平价就爆了"这种事，你可以把那个账户的输入序列从日志里捞出来，在测试里一个字不差地重放，看到每一步的仓位和余额。**能重放，bug 就能复现；不能重放，你只能猜。**

**② 不做任何 IO。** 数据库、网络、文件系统，一概不碰。引擎只负责"说"发生了什么。

**③ 两类错误分开处理。**

| 类型 | 例子 | 怎么处理 |
| --- | --- | --- |
| 业务拒绝 | 余额不够、价格没对齐 tickSize | 返回 `{ t: "rejected" }` 事件，**不抛异常** |
| 程序错误 | 宿主传了一个不存在的币对、同一个账户注册两次 | **直接抛 Error**——这说明接线写错了，越早炸越好 |

分开的原因：业务拒绝是正常流程，要推给用户看；程序错误不该发生，悄悄吞掉比报错危险得多。

---

## 第 2 节：包骨架

创建 `packages/engine/package.json`。注意 `dependencies` 里只有 `shared`——这就是 `CLAUDE.md` 里"`engine ──► shared`，不许依赖 `db` 或 `server`"在包层面的落地：

```json
{
  "name": "@binance-contract-trading-full-stack/engine",
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    },
    "./*": {
      "default": "./src/*.ts"
    }
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@binance-contract-trading-full-stack/shared": "workspace:*"
  },
  "devDependencies": {
    "@binance-contract-trading-full-stack/config": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  }
}
```

`exports` 里的 `"./*"` 让服务端之后可以写 `import { createTestEngine } from "@binance-contract-trading-full-stack/engine/testing/harness"`——第 11 讲的集成测试会复用这一讲写的测试脚手架。

创建 `packages/engine/tsconfig.json`：

```json
{
  "extends": "@binance-contract-trading-full-stack/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  }
}
```

创建 `packages/engine/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

装依赖，把新包接进 workspace：

```bash
pnpm install
```

**检查点 2**：`pnpm install` 没报错即可。这时 `src/` 还是空的，跑 `check-types` 会报"找不到输入文件"，是正常的，下一节就有文件了。

---

## 第 3 节：类型——先把契约定死

### 概念：`types.ts` 分四块

| 块 | 内容 | 谁提供 |
| --- | --- | --- |
| 配置 | 币对规格、分层表、费率、限额 | 宿主启动时从数据库读出来，一次性喂给引擎 |
| 领域对象 | 账户、仓位、订单、成交…… | 引擎内存里的状态 |
| 输入事件 `EngineInput` | 发生了什么 | 行情层 / 接口层 → 宿主 → 引擎 |
| 输出事件 `EngineEvent` | 因此改变了什么 | 引擎 → 宿主 → 数据库 + 前端 |

### 对设计文档的四处补充

照着 `02-architecture.md` 第六节写类型时，会发现契约有缺口。不补的话，后面几讲会在具体实现时被迫临时决定，而临时决定最容易出错。这里一次定下来：

| # | 设计文档里 | 问题 | 本讲的决定 |
| --- | --- | --- | --- |
| 1 | `EngineInput` 只有 8 种 | 新用户开户、账户重置、切持仓模式、调逐仓保证金，这些都会改引擎状态，却没有对应的输入——**不走输入就无法重放** | 新增 `registerAccount` `resetAccount` `setPositionMode` `adjustIsolatedMargin` |
| 2 | `placeOrder` 没有订单 id | 引擎不能用随机数，那订单 id 从哪来？ | 宿主生成 uuid，放进 `placeOrder.orderId` |
| 3 | `rejected` 只带 `clientOrderId` | 撤单被拒时根本没有 `clientOrderId`，推送也不知道该推给哪个账户 | 带上 `accountId`、被拒的输入类型、`orderId`、`ts` |
| 4 | `liquidation` 带 `positions[]`，`fundingPaid` 只有金额 | 字段和 `liquidations` / `funding_payments` 表对不上，宿主落库时凑不齐列 | 改成和表一一对应的 `LiquidationRecord` / `FundingPayment` |

另外还加了两个输出事件 `settingUpdate` 和 `positionModeUpdate`：调杠杆、切模式要落到 `account_symbol_settings` 表和 `accounts.position_mode` 列，原来的事件里没有能承载它们的。**注意没有加"通用的 accountUpdate"**——那样的事件迟早会被人拿去改余额，绕过流水。改余额只有 `balanceUpdate` 一条路。

这四处改动在第 7 节回写到设计文档。

### 动手：`types.ts`

创建 `packages/engine/src/types.ts`：

```ts
import type {
  ErrorCode,
  FillRole,
  Fixed,
  LedgerType,
  MarginMode,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionMode,
  PositionSide,
  TimeInForce,
  WorkingType,
} from "@binance-contract-trading-full-stack/shared";

// ─────────────────────────────────────────────────────────────
// 配置：宿主启动时从数据库读出来，一次性喂给引擎
// ─────────────────────────────────────────────────────────────

/** 币对规格，对应 symbols 表里引擎用得到的那几列。 */
export interface SymbolSpec {
  symbol: string;
  status: string; // 币安状态，'TRADING' 才允许下单（校验链第 1 步）
  enabled: boolean; // 我们是否对用户开放
  tickSize: Fixed; // 价格最小变动单位
  stepSize: Fixed; // 数量最小变动单位
  minQty: Fixed; // 最小下单数量
  minNotional: Fixed; // 最小下单名义价值
}

/**
 * 杠杆分层的一层，对应 leverage_brackets 表。
 * 注意命名：表里是 bracket / maxLeverage，引擎里加了 Num 后缀——
 * 它们是普通整数，不是定标值（CLAUDE.md "命名防呆"）。
 */
export interface LeverageBracket {
  bracketNum: number; // 层号，从 1 开始
  notionalFloor: Fixed; // 这一层名义价值下限
  notionalCap: Fixed; // 这一层名义价值上限
  maxLeverageNum: number; // 这一层允许的最大杠杆
  mmr: Fixed; // 维持保证金率，0.4% → parse("0.004")
  cum: Fixed; // 速算额：维持保证金 = 名义价值 × mmr − cum
}

/** 费率，全部定标 1e8：0.02% → parse("0.0002")。 */
export interface FeeConfig {
  makerFeeRate: Fixed; // 挂单方手续费率
  takerFeeRate: Fixed; // 吃单方手续费率
  liquidationFeeRate: Fixed; // 强平清算费率（设计文档第 8 节：0.5%）
}

/** 下单校验链里那几个"拍板的数字"，集中放这里而不是散落在代码里。 */
export interface LimitConfig {
  maxOpenOrdersNum: number; // 每个账户最多挂单数（校验链第 13 步：200）
  percentPriceLimit: Fixed; // 委托价偏离标记价上限（校验链第 7 步：±5%）
  marketDepthRatio: Fixed; // 市价单最多吃掉可见深度的比例（校验链第 11 步：50%）
}

export interface EngineConfig {
  symbols: SymbolSpec[];
  brackets: Record<string, LeverageBracket[]>; // symbol → 该币对的分层表
  fees: FeeConfig;
  limits: LimitConfig;
}

// ─────────────────────────────────────────────────────────────
// 领域对象：引擎内存里的状态
// ─────────────────────────────────────────────────────────────

/** 盘口的一档。 */
export interface Level {
  price: Fixed;
  qty: Fixed;
}

/** 账户——引擎只关心交易相关状态，不知道用户是用钱包还是邮箱登录的。 */
export interface Account {
  id: string;
  walletBalance: Fixed; // 已结算的钱，只有带流水的事件才能改它
  positionMode: PositionMode;
}

/** 每账户每币对的杠杆与保证金模式，对应 account_symbol_settings 表。没有记录 = 默认值。 */
export interface AccountSymbolSetting {
  accountId: string;
  symbol: string;
  leverageNum: number;
  marginMode: MarginMode;
}

export interface Position {
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  marginMode: MarginMode;
  leverageNum: number;
  qty: Fixed; // 恒为非负，方向完全由 positionSide 决定
  entryPrice: Fixed; // 加权平均开仓价
  isolatedMargin: Fixed; // 仅逐仓有意义
  openedAt: number; // 本轮开仓的时间戳（毫秒）
  updatedAt: number;
}

export interface Order {
  id: string; // 由宿主生成后通过 placeOrder 输入带进来，引擎不生成随机 id
  clientOrderId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  type: OrderType;
  timeInForce: TimeInForce;
  price: Fixed | null; // 市价单为 null
  stopPrice: Fixed | null; // 非触发单为 null
  workingType: WorkingType;
  qty: Fixed;
  executedQty: Fixed;
  avgPrice: Fixed;
  reduceOnly: boolean;
  closePosition: boolean;
  status: OrderStatus;
  triggered: boolean;
  queueAhead: Fixed; // 拟真排队：前方还剩多少量
  queueEstimated: boolean;
  frozenMargin: Fixed; // 这张挂单冻结的保证金
  rejectReason: string | null; // EXPIRED/REJECTED 时的原因
  createdAt: number;
  updatedAt: number;
}

/**
 * 一笔成交。id 是引擎内确定性生成的字符串（如 `${orderId}:1`），
 * 不是数据库的 uuid——落库时由宿主转换（模块 11）。
 */
export interface Fill {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  price: Fixed; // 实际成交价
  qty: Fixed; // 这一笔成交的数量
  role: FillRole;
  fee: Fixed; // 向上取整（mulCeil）
  realizedPnl: Fixed; // 开仓/加仓为 0
  isLiquidation: boolean;
  ts: number;
}

/** 一次资金费结算，字段和 funding_payments 表一一对应。 */
export interface FundingPayment {
  id: string;
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  fundingRate: Fixed;
  markPrice: Fixed;
  notional: Fixed;
  amount: Fixed; // 有符号：付出为负
  ts: number;
}

/** 一次强平，字段和 liquidations 表一一对应。 */
export interface LiquidationRecord {
  id: string;
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  marginMode: MarginMode;
  qty: Fixed;
  entryPrice: Fixed;
  markPrice: Fixed;
  realizedPnl: Fixed;
  liquidationFee: Fixed;
  marginBalanceBefore: Fixed; // 取证：强平前一刻的保证金余额
  maintMarginAt: Fixed; // 取证：强平前一刻的维持保证金
  ts: number;
}

/** 下单请求，字段对应 04-backend-design.md 第 11 节 POST /orders 的请求体（已转成定标值）。 */
export interface PlaceOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  type: OrderType;
  timeInForce?: TimeInForce;
  price?: Fixed;
  stopPrice?: Fixed;
  workingType?: WorkingType;
  qty?: Fixed; // closePosition 时可以不传
  reduceOnly?: boolean;
  closePosition?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 输入事件：引擎世界里发生的一切，都必须是这里的某一种
// ─────────────────────────────────────────────────────────────

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

export type EngineInputType = EngineInput["t"];

// ─────────────────────────────────────────────────────────────
// 输出事件：宿主拿去落库和推送，引擎自己什么都不做
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 快照与引擎接口
// ─────────────────────────────────────────────────────────────

/**
 * 引擎的账户类状态。行情（盘口、标记价、最新价）不进快照——宿主重启后会重新订阅，
 * 回滚时行情也不需要回滚。
 * orders 只有未完成订单：终态订单发出 orderUpdate 之后就从内存里移除。
 */
export interface EngineSnapshot {
  accounts: Account[];
  settings: AccountSymbolSetting[];
  positions: Position[];
  orders: Order[];
}

export interface Engine {
  /** 同步、确定性：同样的状态 + 同样的输入，永远得到同样的事件。 */
  apply(input: EngineInput): EngineEvent[];
  /** 返回深拷贝，调用方怎么改都影响不到引擎。 */
  snapshot(): EngineSnapshot;
  /** 用快照整体替换账户类状态，行情状态保持不变。 */
  restore(snapshot: EngineSnapshot): void;
}
```

几个值得停下来想一想的地方：

- **`Position.leverageNum` 带 `Num` 后缀，数据库列叫 `leverage`**。数据库和引擎是两个世界，引擎内部严格执行"非定标数值加 `Num`"，由宿主在边界上做字段映射。
- **`Fill.id` 是字符串不是 uuid**。引擎不能生成随机 uuid，但可以用 `${orderId}:1` 这种确定性规则。数据库那边怎么转，是第 11 讲的事，在总览的"设计缺口"里记着。
- **`EngineSnapshot.orders` 只有未完成订单**。设计文档第七节说内存只存未完成订单，终态订单发出 `orderUpdate` 后就移出内存。第 6 节的不变式会盯着这一点。

### 动手：测试夹具

类型定下来之后，先准备一份测试专用的引擎配置。

**这里有一个重要决定：测试夹具不读你第 01 讲用 `fetch:brackets` 拉下来的真实分层表。** 你拉下来的 BTCUSDT 第 1 层上限是 300,000 / 150x，而设计文档所有算例（强平价 45,180.72 等）都基于文档里那张示例表（第 1 层 50,000 / 125x）。测试如果读真实数据：

1. 文档算例对不上，你没法拿文档验证自己的公式
2. 币安哪天调表，测试莫名其妙全红——而你的代码根本没改

**测试要测的是"公式对不对"，不是"币安今天的数据是什么"**，所以夹具冻结在文档那张表上。

创建 `packages/engine/src/testing/fixtures.ts`：

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";
import type { EngineConfig, EngineInput, LeverageBracket, SymbolSpec } from "../types";

/**
 * 测试专用的冻结配置。
 *
 * ⚠️ 故意不读 packages/db 里 fetch:brackets 拉下来的真实分层表：
 * 币安会调表（BTCUSDT 第 1 层上限已经从文档里的 50,000 变成了 300,000），
 * 测试如果跟着真实数据走，币安一调表就全红，而且红得毫无意义。
 * 这里用的是 01-domain-knowledge.md 里那张示例表——所有文档算例都基于它。
 */
export const BTCUSDT: SymbolSpec = {
  symbol: "BTCUSDT",
  status: "TRADING",
  enabled: true,
  tickSize: parse("0.1"),
  stepSize: parse("0.001"),
  minQty: parse("0.001"),
  minNotional: parse("5"),
};

function bracket(
  bracketNum: number,
  floor: string,
  cap: string,
  maxLeverageNum: number,
  mmr: string,
  cum: string,
): LeverageBracket {
  return {
    bracketNum,
    notionalFloor: parse(floor),
    notionalCap: parse(cap),
    maxLeverageNum,
    mmr: parse(mmr),
    cum: parse(cum),
  };
}

export const BTCUSDT_BRACKETS: LeverageBracket[] = [
  bracket(1, "0", "50000", 125, "0.004", "0"),
  bracket(2, "50000", "600000", 100, "0.005", "50"),
  bracket(3, "600000", "3000000", 50, "0.01", "3050"),
  bracket(4, "3000000", "12000000", 20, "0.025", "48050"),
  bracket(5, "12000000", "70000000", 10, "0.05", "348050"),
  bracket(6, "70000000", "100000000", 5, "0.1", "3848050"),
  bracket(7, "100000000", "230000000", 4, "0.125", "6348050"),
  bracket(8, "230000000", "480000000", 3, "0.15", "12098050"),
  bracket(9, "480000000", "600000000", 2, "0.25", "60098050"),
  bracket(10, "600000000", "800000000", 1, "0.5", "210098050"),
];

/** 每次调用返回一份新对象，测试之间互不污染。 */
export function testConfig(): EngineConfig {
  return {
    symbols: [BTCUSDT],
    brackets: { BTCUSDT: BTCUSDT_BRACKETS },
    fees: {
      makerFeeRate: parse("0.0002"),
      takerFeeRate: parse("0.0005"),
      liquidationFeeRate: parse("0.005"),
    },
    limits: {
      maxOpenOrdersNum: 200,
      percentPriceLimit: parse("0.05"),
      marketDepthRatio: parse("0.5"),
    },
  };
}

/** 一个固定的起始时间戳，测试里的时间都从它往后推。 */
export const T0 = 1_789_344_000_000;

export function registerAccountInput(
  accountId: string,
  walletBalance = "10000",
  ts = T0,
): Extract<EngineInput, { t: "registerAccount" }> {
  return { t: "registerAccount", accountId, walletBalance: parse(walletBalance), positionMode: "ONE_WAY", ts };
}
```

夹具自己也要测——夹具抄错了一个数，第 03 讲所有强平价测试都会建立在错数字上。创建 `packages/engine/src/testing/fixtures.test.ts`：

```ts
import { mul } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { BTCUSDT_BRACKETS } from "./fixtures";

describe("测试夹具", () => {
  // 夹具本身抄错了，后面所有强平价测试都会建立在错数字上，所以夹具也要测
  it("BTCUSDT 分层表：相邻层首尾相接，边界上维持保证金相等", () => {
    for (let i = 0; i < BTCUSDT_BRACKETS.length - 1; i++) {
      const lower = BTCUSDT_BRACKETS[i]!;
      const upper = BTCUSDT_BRACKETS[i + 1]!;
      const n = lower.notionalCap;

      expect(upper.notionalFloor, `第 ${upper.bracketNum} 层下限`).toBe(lower.notionalCap);
      expect(mul(n, lower.mmr) - lower.cum, `第 ${lower.bracketNum}/${upper.bracketNum} 层边界`).toBe(
        mul(n, upper.mmr) - upper.cum,
      );
    }
  });
});
```

### 动手：纯净性守卫

现在 `src/` 里有源码文件了，把守卫装上。它扫描 `src/` 下所有非测试的 `.ts` 文件，任何一个出现被禁止的写法就红。

创建 `packages/engine/src/purity.test.ts`：

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = import.meta.dirname;

// 每一条都对应 CLAUDE.md 硬约束 #2 里的一项禁令
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bDate\.now\(/, // 时钟：时间戳必须从 EngineInput.ts 带进来
  /\bnew Date\(/, // 同上，new Date() 也是读时钟
  /\bMath\.random\(/, // 随机数：同一串输入必须得到同一串输出
  /\bcrypto\.randomUUID\(/, // 同上，订单 id 由宿主生成后放进输入
  /\bconsole\./, // 日志是宿主的事
  /\bsetTimeout\(/, // 定时器：资金费的定时在宿主层
  /\bsetInterval\(/,
  /from\s+["']node:/, // 任何 Node 内置模块（fs/net/crypto…）
  /from\s+["']drizzle-orm/, // 数据库
  /from\s+["']pg["']/,
  /from\s+["']@binance-contract-trading-full-stack\/db/, // 依赖方向：engine 不许依赖 db
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("引擎纯净性（CLAUDE.md 硬约束 #2）", () => {
  it("源码里没有时钟、随机数、IO、日志，也没有反向依赖", () => {
    const files = collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${file} 命中禁止模式 ${pattern}`).toBe(false);
      }
    }
  });
});
```

两个细节：

- 测试文件本身（`.test.ts`）不扫——守卫自己就要 `import "node:fs"`
- `expect(files.length).toBeGreaterThan(0)` 防的是一种很隐蔽的失效：路径写错导致一个文件都没扫到，守卫永远绿，但什么都没守住

**检查点 3**：

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run check-types
pnpm --filter @binance-contract-trading-full-stack/engine run test
```

预期 2 条测试通过。

**练习（请务必做一次）**：往 `fixtures.ts` 末尾临时加一行 `export const leak = () => Date.now();`，再跑测试，确认守卫变红并告诉你是哪个文件、哪条规则。然后删掉这行。**一个你没见过它报错的检查，你没理由相信它。**

```bash
git add packages/engine/package.json packages/engine/tsconfig.json packages/engine/vitest.config.ts \
  packages/engine/src/types.ts packages/engine/src/purity.test.ts \
  packages/engine/src/testing/fixtures.ts packages/engine/src/testing/fixtures.test.ts pnpm-lock.yaml
git commit -m "feat(engine): 包骨架、跨层契约类型、测试夹具与纯净性守卫"
```

---

## 第 4 节：内存状态——`state.ts`

### 概念：两类状态，待遇不同

| 类别 | 内容 | 进快照？ | 为什么 |
| --- | --- | --- | --- |
| 账户类 | 账户、杠杆设置、仓位、未完成订单 | ✅ | 这是"钱"，宿主落库失败时要能整体回滚到调用前 |
| 行情类 | 盘口、标记价、最新价 | ❌ | 重启后重新订阅就有了；回滚时行情不该跟着回滚——币安的价格不会因为我们写库失败就倒退 |

**为什么用 `Map` 不用数组**：撮合时要高频地"按订单 id 找订单"、"按账户+币对+方向找仓位"，数组每次都要遍历。仓位的键用 `accountId|symbol|positionSide` 拼出来，一个仓位一个键，天然对应数据库那个唯一索引 `pos_acc_sym_side_uq`。

**为什么快照要深拷贝**：宿主拿到快照后如果改了里面的对象（哪怕是无意的），不能影响引擎。反过来 `restore` 进来的对象，调用方之后再改，也不能影响引擎。`structuredClone` 原生支持 `bigint`，一行搞定。

### 动手

创建 `packages/engine/src/state.ts`：

```ts
import type { Fixed, PositionSide } from "@binance-contract-trading-full-stack/shared";
import type {
  Account,
  AccountSymbolSetting,
  EngineConfig,
  EngineSnapshot,
  LeverageBracket,
  Level,
  Order,
  Position,
  SymbolSpec,
} from "./types";

export interface BookState {
  bids: Level[]; // 价格降序，bids[0] 是买一
  asks: Level[]; // 价格升序，asks[0] 是卖一
  ts: number;
}

export interface MarkState {
  markPrice: Fixed;
  fundingRate: Fixed;
  nextFundingTs: number;
  ts: number;
}

/**
 * 引擎的全部内存状态。只在引擎包内部流通，对外只暴露 EngineSnapshot。
 * 用 Map 而不是数组：撮合时要按 id / 仓位键高频查找。
 */
export interface EngineState {
  readonly config: EngineConfig;
  readonly symbols: Map<string, SymbolSpec>;
  readonly brackets: Map<string, LeverageBracket[]>; // 按 notionalCap 升序

  // —— 账户类状态：进快照、可回滚 ——
  readonly accounts: Map<string, Account>;
  readonly settings: Map<string, AccountSymbolSetting>; // key: settingKey()
  readonly positions: Map<string, Position>; // key: positionKey()
  readonly orders: Map<string, Order>; // 只放未完成订单

  // —— 行情类状态：不进快照 ——
  readonly books: Map<string, BookState>;
  readonly marks: Map<string, MarkState>;
  readonly lastPrices: Map<string, Fixed>;
}

export function settingKey(accountId: string, symbol: string): string {
  return `${accountId}|${symbol}`;
}

export function positionKey(accountId: string, symbol: string, positionSide: PositionSide): string {
  return `${accountId}|${symbol}|${positionSide}`;
}

export function createState(config: EngineConfig): EngineState {
  const symbols = new Map<string, SymbolSpec>();
  const brackets = new Map<string, LeverageBracket[]>();

  for (const spec of config.symbols) {
    const list = config.brackets[spec.symbol];
    // 没有分层表就算不出维持保证金，这是宿主接线的错，启动时就该炸，而不是等第一笔单
    if (!list || list.length === 0) {
      throw new Error(`币对 ${spec.symbol} 没有杠杆分层表，引擎无法计算维持保证金`);
    }
    symbols.set(spec.symbol, spec);
    brackets.set(
      spec.symbol,
      [...list].sort((a, b) => (a.notionalCap < b.notionalCap ? -1 : a.notionalCap > b.notionalCap ? 1 : 0)),
    );
  }

  return {
    config,
    symbols,
    brackets,
    accounts: new Map(),
    settings: new Map(),
    positions: new Map(),
    orders: new Map(),
    books: new Map(),
    marks: new Map(),
    lastPrices: new Map(),
  };
}

export function requireSymbol(state: EngineState, symbol: string): SymbolSpec {
  const spec = state.symbols.get(symbol);
  if (!spec) {
    throw new Error(`未知币对 ${symbol}：引擎配置里没有它的规格`);
  }
  return spec;
}

/** 深拷贝导出。structuredClone 原生支持 bigint。 */
export function toSnapshot(state: EngineState): EngineSnapshot {
  return structuredClone({
    accounts: [...state.accounts.values()],
    settings: [...state.settings.values()],
    positions: [...state.positions.values()],
    orders: [...state.orders.values()],
  });
}

/** 用快照整体替换账户类状态。行情类状态（books/marks/lastPrices）保持不动。 */
export function loadSnapshot(state: EngineState, snapshot: EngineSnapshot): void {
  const copy = structuredClone(snapshot);

  // 先全部校验，再动状态——校验到一半抛错时不能留下半新半旧的状态
  for (const s of copy.settings) requireSymbol(state, s.symbol);
  for (const p of copy.positions) requireSymbol(state, p.symbol);
  for (const o of copy.orders) requireSymbol(state, o.symbol);

  state.accounts.clear();
  state.settings.clear();
  state.positions.clear();
  state.orders.clear();

  for (const a of copy.accounts) state.accounts.set(a.id, a);
  for (const s of copy.settings) state.settings.set(settingKey(s.accountId, s.symbol), s);
  for (const p of copy.positions) state.positions.set(positionKey(p.accountId, p.symbol, p.positionSide), p);
  for (const o of copy.orders) state.orders.set(o.id, o);
}
```

`loadSnapshot` 里"先全部校验，再动状态"这个顺序值得记住：如果边校验边写，第三个仓位校验失败时，前两个已经写进去了，引擎就处在一个半新半旧的状态里——这正是回滚要防的东西。

创建 `packages/engine/src/state.test.ts`：

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createState, loadSnapshot, toSnapshot } from "./state";
import { BTCUSDT_BRACKETS, testConfig } from "./testing/fixtures";
import type { EngineSnapshot } from "./types";

function snapshotWithOneAccount(balance: string): EngineSnapshot {
  return {
    accounts: [{ id: "acc-1", walletBalance: parse(balance), positionMode: "ONE_WAY" }],
    settings: [],
    positions: [],
    orders: [],
  };
}

describe("createState", () => {
  it("某个币对没有分层表时，启动就报错", () => {
    const config = testConfig();
    config.brackets = {};
    expect(() => createState(config)).toThrow(/没有杠杆分层表/);
  });

  it("分层表按 notionalCap 升序整理，不依赖宿主传进来的顺序", () => {
    const config = testConfig();
    config.brackets = { BTCUSDT: [...BTCUSDT_BRACKETS].reverse() };
    const state = createState(config);
    const caps = state.brackets.get("BTCUSDT")!.map((b) => b.notionalCap);
    expect(caps).toEqual([...caps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe("快照", () => {
  it("toSnapshot 是深拷贝：改返回值影响不到引擎", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));

    const snap = toSnapshot(state);
    snap.accounts[0]!.walletBalance = 0n;

    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });

  it("loadSnapshot 也是深拷贝：之后改传进去的对象，影响不到引擎", () => {
    const state = createState(testConfig());
    const snap = snapshotWithOneAccount("10000");
    loadSnapshot(state, snap);

    snap.accounts[0]!.walletBalance = 0n;

    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });

  it("loadSnapshot 整体替换账户类状态，但保留行情状态", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));
    state.lastPrices.set("BTCUSDT", parse("50000"));

    loadSnapshot(state, {
      accounts: [{ id: "acc-2", walletBalance: parse("500"), positionMode: "HEDGE" }],
      settings: [],
      positions: [],
      orders: [],
    });

    expect([...state.accounts.keys()]).toEqual(["acc-2"]);
    expect(state.lastPrices.get("BTCUSDT")).toBe(parse("50000"));
  });

  it("快照里出现未知币对时拒绝加载，并且不留下半新半旧的状态", () => {
    const state = createState(testConfig());
    loadSnapshot(state, snapshotWithOneAccount("10000"));

    const bad: EngineSnapshot = {
      ...snapshotWithOneAccount("1"),
      settings: [{ accountId: "acc-1", symbol: "DOGEUSDT", leverageNum: 20, marginMode: "CROSS" }],
    };

    expect(() => loadSnapshot(state, bad)).toThrow(/未知币对 DOGEUSDT/);
    expect(state.accounts.get("acc-1")!.walletBalance).toBe(parse("10000"));
  });
});
```

最后一条测试就是在验证"先校验再动状态"：坏快照被拒之后，引擎里还是原来那个 10000 的账户，而不是被替换成余额 1 的新账户。

**检查点 4**：测试应该是 8 条通过。

```bash
git add packages/engine/src/state.ts packages/engine/src/state.test.ts
git commit -m "feat(engine): 内存状态与快照（深拷贝、先校验后替换）"
```

---

## 第 5 节：`apply` 与 `createEngine`

### 概念

`apply` 就是一个大 `switch`，按输入类型分派。这一讲只实现四种输入：

| 输入 | 这一讲做什么 | 后续哪一讲补全 |
| --- | --- | --- |
| `book` | 存盘口快照 | 06：夹逼挂单排队位置 |
| `markPrice` | 存标记价、资金费率 | 07/09：风控扫描、触发单检查 |
| `trade` | 存最新价 | 06：消耗挂单队列产生成交 |
| `registerAccount` | 开户，发一条 `INITIAL` 流水 | —— |

其余八种输入，这一讲**明确抛错**，而不是返回空数组。区别很大：返回 `[]` 的话，某天宿主已经接好了下单接口、引擎这边还没实现，用户下单会"成功"但什么都没发生，而且没人知道。抛错的话，第一次调用就会在日志里炸出来。**悄悄什么都不做，比报错危险得多。**

**开户为什么要走引擎**：看上去开户只是"建个账户、余额设成 10000"，宿主直接写数据库就行了。但那样就多了一条"不经过 `balanceUpdate` 改余额"的路。**全系统只允许一条路改余额**——引擎发 `balanceUpdate`、宿主落成一条流水。只要这条路是唯一的，`walletBalance === SUM(ledger)` 就不可能被破坏；多一条路，就多一个可能漏写流水的地方。

`switch` 末尾的 `assertNever` 是 TypeScript 的穷尽检查：以后在 `EngineInput` 里新增一种输入却忘了在这里处理，**编译就会报错**，不用等到运行时。

### 动手

创建 `packages/engine/src/apply.ts`：

```ts
import { requireSymbol, type EngineState } from "./state";
import type { EngineEvent, EngineInput } from "./types";

type InputOf<T extends EngineInput["t"]> = Extract<EngineInput, { t: T }>;

/**
 * 引擎的总入口：按输入类型分派。
 *
 * 两类错误要分清：
 * - 业务拒绝（余额不够、价格不对齐……）→ 返回 { t: "rejected" } 事件，不抛异常
 * - 程序错误（宿主传了未知币对、重复注册账户……）→ 直接抛 Error，说明接线有 bug
 */
export function applyInput(state: EngineState, input: EngineInput): EngineEvent[] {
  switch (input.t) {
    case "book":
      return applyBook(state, input);
    case "markPrice":
      return applyMarkPrice(state, input);
    case "trade":
      return applyTrade(state, input);
    case "registerAccount":
      return registerAccount(state, input);

    // 下面这些在后续模块里逐个实现。没实现就明确地炸，而不是悄悄返回 []——
    // 悄悄什么都不做，比报错更难发现。
    case "placeOrder":
    case "cancelOrder":
    case "settleFunding":
    case "setLeverage":
    case "setMarginMode":
    case "setPositionMode":
    case "adjustIsolatedMargin":
    case "resetAccount":
      throw new Error(`引擎还没有实现输入 "${input.t}"，按 docs/tutorial/README.md 的模块顺序补齐`);

    default:
      return assertNever(input);
  }
}

function applyBook(state: EngineState, input: InputOf<"book">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.books.set(input.symbol, {
    bids: input.bids.map((l) => ({ ...l })),
    asks: input.asks.map((l) => ({ ...l })),
    ts: input.ts,
  });
  // 模块 06：盘口更新后要夹逼所有挂单的 queueAhead
  return [];
}

function applyMarkPrice(state: EngineState, input: InputOf<"markPrice">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.marks.set(input.symbol, {
    markPrice: input.markPrice,
    fundingRate: input.fundingRate,
    nextFundingTs: input.nextFundingTs,
    ts: input.ts,
  });
  // 模块 07/09：标记价更新后要检查触发单、跑风控扫描
  return [];
}

function applyTrade(state: EngineState, input: InputOf<"trade">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.lastPrices.set(input.symbol, input.price);
  // 模块 06：用成交流消耗挂单的排队位置
  return [];
}

function registerAccount(state: EngineState, input: InputOf<"registerAccount">): EngineEvent[] {
  if (state.accounts.has(input.accountId)) {
    throw new Error(`账户 ${input.accountId} 已经在引擎里了，重复注册说明宿主有 bug`);
  }
  if (input.walletBalance < 0n) {
    throw new Error(`初始余额不能为负：${input.walletBalance}`);
  }

  state.accounts.set(input.accountId, {
    id: input.accountId,
    walletBalance: input.walletBalance,
    positionMode: input.positionMode,
  });

  // 开户发钱也走 balanceUpdate：全系统只有这一条路能改余额，所以流水永远不会漏
  return [
    {
      t: "balanceUpdate",
      accountId: input.accountId,
      walletBalance: input.walletBalance,
      delta: input.walletBalance,
      reason: "INITIAL",
      symbol: null,
      ref: null,
      ts: input.ts,
    },
  ];
}

function assertNever(value: never): never {
  throw new Error(`未知的引擎输入类型：${String((value as { t?: unknown }).t)}`);
}
```

`applyBook` 里 `input.bids.map((l) => ({ ...l }))` 是在存拷贝：宿主传进来的数组之后如果被复用或修改（行情层为了省内存很可能这么干），不能影响引擎里存的盘口。

创建 `packages/engine/src/create-engine.ts`——它只是把 `state` 和 `apply` 包成对外的 `Engine` 接口：

```ts
import { applyInput } from "./apply";
import { createState, loadSnapshot, toSnapshot } from "./state";
import type { Engine, EngineConfig, EngineSnapshot } from "./types";

export function createEngine(config: EngineConfig, initial?: EngineSnapshot): Engine {
  const state = createState(config);
  if (initial) {
    loadSnapshot(state, initial);
  }

  return {
    apply: (input) => applyInput(state, input),
    snapshot: () => toSnapshot(state),
    restore: (snapshot) => loadSnapshot(state, snapshot),
  };
}
```

创建 `packages/engine/src/index.ts`。注意没有导出 `state.ts`——`EngineState` 是引擎内部的东西，外面只该看到 `Engine` 接口和 `EngineSnapshot`：

```ts
export * from "./create-engine";
export * from "./types";
```

创建 `packages/engine/src/apply.test.ts`：

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { applyInput } from "./apply";
import { createState } from "./state";
import { T0, registerAccountInput, testConfig } from "./testing/fixtures";

describe("registerAccount", () => {
  it("开户产出一条 INITIAL 的 balanceUpdate，并把账户放进内存", () => {
    const state = createState(testConfig());

    const events = applyInput(state, registerAccountInput("acc-1", "10000"));

    expect(events).toEqual([
      {
        t: "balanceUpdate",
        accountId: "acc-1",
        walletBalance: parse("10000"),
        delta: parse("10000"),
        reason: "INITIAL",
        symbol: null,
        ref: null,
        ts: T0,
      },
    ]);
    expect(state.accounts.get("acc-1")).toEqual({
      id: "acc-1",
      walletBalance: parse("10000"),
      positionMode: "ONE_WAY",
    });
  });

  it("重复注册是宿主的 bug，直接抛错", () => {
    const state = createState(testConfig());
    applyInput(state, registerAccountInput("acc-1"));
    expect(() => applyInput(state, registerAccountInput("acc-1"))).toThrow(/已经在引擎里了/);
  });

  it("初始余额为负时抛错", () => {
    const state = createState(testConfig());
    expect(() => applyInput(state, registerAccountInput("acc-1", "-1"))).toThrow(/不能为负/);
  });
});

describe("行情输入", () => {
  it("book 覆盖该币对的盘口快照", () => {
    const state = createState(testConfig());
    const bids = [{ price: parse("49999.9"), qty: parse("1.5") }];
    const asks = [{ price: parse("50000"), qty: parse("2") }];

    const events = applyInput(state, { t: "book", symbol: "BTCUSDT", bids, asks, ts: T0 });

    expect(events).toEqual([]);
    expect(state.books.get("BTCUSDT")).toEqual({ bids, asks, ts: T0 });
  });

  it("book 存的是拷贝：宿主之后改自己的数组，影响不到引擎", () => {
    const state = createState(testConfig());
    const bids = [{ price: parse("49999.9"), qty: parse("1.5") }];
    applyInput(state, { t: "book", symbol: "BTCUSDT", bids, asks: [], ts: T0 });

    bids[0]!.qty = 0n;

    expect(state.books.get("BTCUSDT")!.bids[0]!.qty).toBe(parse("1.5"));
  });

  it("markPrice 更新标记价、资金费率和下次结算时间", () => {
    const state = createState(testConfig());
    applyInput(state, {
      t: "markPrice",
      symbol: "BTCUSDT",
      markPrice: parse("50010"),
      fundingRate: parse("0.0001"),
      nextFundingTs: T0 + 3_600_000,
      ts: T0,
    });

    expect(state.marks.get("BTCUSDT")).toEqual({
      markPrice: parse("50010"),
      fundingRate: parse("0.0001"),
      nextFundingTs: T0 + 3_600_000,
      ts: T0,
    });
  });

  it("trade 更新最新价", () => {
    const state = createState(testConfig());
    applyInput(state, {
      t: "trade",
      symbol: "BTCUSDT",
      price: parse("50001.2"),
      qty: parse("0.3"),
      buyerIsMaker: false,
      ts: T0,
    });
    expect(state.lastPrices.get("BTCUSDT")).toBe(parse("50001.2"));
  });

  it("未知币对是宿主接线错误，直接抛错", () => {
    const state = createState(testConfig());
    expect(() =>
      applyInput(state, { t: "book", symbol: "DOGEUSDT", bids: [], asks: [], ts: T0 }),
    ).toThrow(/未知币对 DOGEUSDT/);
  });
});

describe("尚未实现的输入", () => {
  it("明确抛错，而不是悄悄返回空数组", () => {
    const state = createState(testConfig());
    expect(() =>
      applyInput(state, { t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T0 }),
    ).toThrow(/还没有实现输入 "cancelOrder"/);
  });
});
```

这组测试直接调 `applyInput` 并检查 `state` 内部，而不是通过 `createEngine` 的公开接口——因为盘口、标记价不进快照，从外面看不到。**单元测试可以看内部，公开接口只给宿主用。**

**检查点 5**：测试应该是 17 条通过。再做一个小实验：在 `types.ts` 的 `EngineInput` 里随便加一种 `| { t: "foo"; ts: number }`，跑 `check-types`，确认 `apply.ts` 的 `assertNever(input)` 那一行报错。然后删掉。

```bash
git add packages/engine/src/apply.ts packages/engine/src/apply.test.ts \
  packages/engine/src/create-engine.ts packages/engine/src/index.ts
git commit -m "feat(engine): apply 分派、开户走 balanceUpdate、createEngine"
```

---

## 第 6 节：测试脚手架——让不变式自动跑

### 概念：为什么要"自动"

`06-testing-design.md` 第 4 节列了 7 条不变式，其中第 ① 条最值钱：**钱包余额 == 该账户所有流水之和**。

如果只在几个特定测试里手动断言它，那么第 07 讲写强平时漏写了清算费的流水，而你恰好没在那个测试里断言余额——bug 就溜过去了。**让它在每一次 `apply` 之后自动跑**，任何一个测试、任何一个分支漏写流水，都会当场红。

### 一个实现上的问题：引擎里没有流水

`02-architecture.md` 第七节规定资金流水**只在数据库里，不在内存里**。那不变式 ① 的"流水之和"从哪来？

答案：**从事件里累加**。引擎每改一次余额都会发一条 `balanceUpdate`，带着 `delta`。测试脚手架把每个账户的 `delta` 累加起来，就是"数据库里那个 `SUM(ledger_entries.amount)` 将会是多少"。然后拿它和引擎快照里的 `walletBalance` 比。

这比直接在引擎里存一份流水更好：它检查的正是宿主真正会落库的那串事件。

脚手架还额外检查了一件事：**每一条 `balanceUpdate` 声称的变动后余额，必须等于累加到这一条为止的总和**。这对应数据库里每条流水的 `balanceAfter` 都要自洽——不能只在最后对总账，中间某一条写错了也要抓出来。

### 动手

创建 `packages/engine/src/testing/invariants.ts`：

```ts
import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import type { EngineEvent, EngineSnapshot } from "../types";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

function fail(rule: string, detail: string): never {
  throw new InvariantError(`不变式 ${rule} 被破坏：${detail}`);
}

/**
 * 06-testing-design.md 第 4 节的引擎层不变式，每次 apply 之后自动跑。
 *
 * ③ 可用余额非负、⑥ 冻结保证金总额，要等模块 03 写出公式之后才能加进来。
 * ⑧ 是我们自己加的：内存里只能有未完成订单。
 */
export function checkInvariants(
  snapshot: EngineSnapshot,
  events: readonly EngineEvent[],
  ledgerSums: ReadonlyMap<string, Fixed>,
): void {
  // ① 钱包余额 == 该账户所有 balanceUpdate 的 delta 之和
  //    引擎内存里不存流水（02-architecture.md 第七节），所以"流水之和"由测试脚手架从事件里累加
  for (const acc of snapshot.accounts) {
    const sum = ledgerSums.get(acc.id) ?? 0n;
    if (acc.walletBalance !== sum) {
      fail("①", `账户 ${acc.id} walletBalance=${acc.walletBalance}，但流水之和=${sum}`);
    }
  }

  // ② 仓位数量非负
  for (const p of snapshot.positions) {
    if (p.qty < 0n) {
      fail("②", `仓位 ${p.accountId}/${p.symbol}/${p.positionSide} qty=${p.qty}`);
    }
  }

  // 终态订单已经从内存移除，只能在本次事件里看到它们，所以两处合起来检查
  const updatedOrders = events.flatMap((e) => (e.t === "orderUpdate" ? [e.order] : []));
  for (const o of [...snapshot.orders, ...updatedOrders]) {
    // ⑤ 成交量不超过委托量
    if (o.executedQty > o.qty) {
      fail("⑤", `订单 ${o.id} executedQty=${o.executedQty} > qty=${o.qty}`);
    }
    // ④ FILLED 的订单必须全部成交
    if (o.status === "FILLED" && o.executedQty !== o.qty) {
      fail("④", `订单 ${o.id} 状态 FILLED 但 executedQty=${o.executedQty} ≠ qty=${o.qty}`);
    }
    // ⑦ 排队位置非负
    if (o.queueAhead < 0n) {
      fail("⑦", `订单 ${o.id} queueAhead=${o.queueAhead}`);
    }
  }

  // ⑧ 内存里只能有未完成订单
  for (const o of snapshot.orders) {
    if (o.status !== "NEW" && o.status !== "PARTIALLY_FILLED") {
      fail("⑧", `订单 ${o.id} 状态是 ${o.status}，终态订单不应该留在引擎内存里`);
    }
  }
}
```

注意"④ FILLED 的订单必须全部成交"为什么要把**事件里的订单**也拿来查：一张单变成 FILLED 的那一刻，它发出 `orderUpdate` 然后就从内存里移走了，快照里再也看不到它。只查快照，这条不变式永远不会被触发。

创建 `packages/engine/src/testing/harness.ts`：

```ts
import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import { createEngine } from "../create-engine";
import type { Engine, EngineConfig, EngineEvent, EngineInput } from "../types";
import { InvariantError, checkInvariants } from "./invariants";

export interface TestEngine {
  /** 被包裹的真实引擎。测试"不变式会不会被抓到"时，可以绕过脚手架直接调它。 */
  readonly engine: Engine;
  /** 从创建到现在的全部输出事件，按顺序。 */
  readonly events: readonly EngineEvent[];
  /** 调用引擎，然后自动检查全部不变式。任何一条被破坏都会抛 InvariantError。 */
  apply(input: EngineInput): EngineEvent[];
  /** 该账户所有 balanceUpdate 的 delta 之和，相当于数据库里的 SUM(ledger_entries.amount)。 */
  ledgerSum(accountId: string): Fixed;
}

export function createTestEngine(config: EngineConfig): TestEngine {
  const engine = createEngine(config);
  const events: EngineEvent[] = [];
  const ledgerSums = new Map<string, Fixed>();

  return {
    engine,
    events,
    apply(input) {
      const out = engine.apply(input);

      for (const event of out) {
        events.push(event);
        if (event.t !== "balanceUpdate") continue;

        const sum = (ledgerSums.get(event.accountId) ?? 0n) + event.delta;
        ledgerSums.set(event.accountId, sum);
        // 每条流水的 balanceAfter 也要自洽，不能只在最后对总账
        if (event.walletBalance !== sum) {
          throw new InvariantError(
            `不变式 ① 被破坏：balanceUpdate 声称余额 ${event.walletBalance}，但流水累加是 ${sum}`,
          );
        }
      }

      checkInvariants(engine.snapshot(), out, ledgerSums);
      return out;
    },
    ledgerSum(accountId) {
      return ledgerSums.get(accountId) ?? 0n;
    },
  };
}
```

**从第 03 讲开始，所有引擎测试都通过 `createTestEngine` 来调引擎**，不变式就自动覆盖了每一个测试。

### 动手：测试测试器

不变式检查如果永远不报错，它就只是一段让人安心的摆设。所以要**故意制造坏状态**，确认它真的会响。

创建 `packages/engine/src/testing/harness.test.ts`：

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import type { Order } from "../types";
import { T0, registerAccountInput, testConfig } from "./fixtures";
import { createTestEngine } from "./harness";
import { InvariantError } from "./invariants";

function filledOrder(): Order {
  return {
    id: "o-1",
    clientOrderId: "c-1",
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    timeInForce: "GTC",
    price: parse("50000"),
    stopPrice: null,
    workingType: "MARK_PRICE",
    qty: parse("1"),
    executedQty: parse("1"),
    avgPrice: parse("50000"),
    reduceOnly: false,
    closePosition: false,
    status: "FILLED",
    triggered: false,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n,
    rejectReason: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

describe("测试脚手架", () => {
  it("正常流程下不变式全部通过，并累加流水", () => {
    const te = createTestEngine(testConfig());

    te.apply(registerAccountInput("acc-1", "10000"));
    te.apply(registerAccountInput("acc-2", "500"));

    expect(te.ledgerSum("acc-1")).toBe(parse("10000"));
    expect(te.ledgerSum("acc-2")).toBe(parse("500"));
    expect(te.events).toHaveLength(2);
  });

  // ↓ 下面两条在"测试测试器"：故意制造坏状态，确认不变式真的会响。
  //   不变式检查如果永远不报错，它就只是一段让人安心的摆设。

  it("余额被改了但没有对应流水 → 下一次 apply 抛出不变式 ①", () => {
    const te = createTestEngine(testConfig());
    te.apply(registerAccountInput("acc-1", "10000"));

    // 绕过脚手架，直接把余额改成 20000，模拟"改了余额没写流水"的 bug
    const snap = te.engine.snapshot();
    snap.accounts[0]!.walletBalance = parse("20000");
    te.engine.restore(snap);

    const next = { t: "trade", symbol: "BTCUSDT", price: parse("50000"), qty: parse("1"), buyerIsMaker: true, ts: T0 } as const;
    expect(() => te.apply(next)).toThrow(InvariantError);
    expect(() => te.apply(next)).toThrow(/不变式 ①/);
  });

  it("终态订单留在内存里 → 抛出不变式 ⑧", () => {
    const te = createTestEngine(testConfig());
    te.apply(registerAccountInput("acc-1", "10000"));

    const snap = te.engine.snapshot();
    snap.orders.push(filledOrder());
    te.engine.restore(snap);

    expect(() =>
      te.apply({ t: "trade", symbol: "BTCUSDT", price: parse("50000"), qty: parse("1"), buyerIsMaker: true, ts: T0 }),
    ).toThrow(/不变式 ⑧/);
  });
});
```

第二条测试模拟的正是 `CLAUDE.md` 提交前自检第 3 条"改了余额但没写流水"：余额从 10000 被改成 20000，但没有任何 `balanceUpdate`。下一次随便喂一个输入，不变式 ① 立刻报出来，还告诉你差了多少。

**检查点 6**：

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run check-types
pnpm --filter @binance-contract-trading-full-stack/engine run test
```

预期 **5 个测试文件、20 条测试全部通过**。

```bash
git add packages/engine/src/testing/invariants.ts packages/engine/src/testing/harness.ts \
  packages/engine/src/testing/harness.test.ts
git commit -m "feat(engine): 不变式自动检查脚手架（含测试测试器）"
```

---

## 第 7 节：把契约改动回写设计文档

第 3 节对 `02-architecture.md` 第六节的契约做了四处补充。**代码和设计文档不一致，下一个读文档的人（包括以后的你）就会照着旧契约写代码。**

打开 `docs/design/02-architecture.md` 第六节"① 引擎 ↔ 宿主"，改三处：

1. **`Engine` 接口**下面补一句：引擎由 `createEngine(config: EngineConfig, initial?: EngineSnapshot)` 创建，`config` 包含币对规格、分层表、费率和限额。
2. **`EngineInput`** 的代码块：
   - 新增 `registerAccount` / `resetAccount` / `setPositionMode` / `adjustIsolatedMargin` 四种
   - `placeOrder` 加上 `orderId: string`，并注明"由宿主生成，引擎不生成随机 id"
3. **`EngineEvent`** 的代码块：
   - `balanceUpdate` 补上 `symbol` / `ref` / `ts`
   - `liquidation` 改成 `{ t: 'liquidation'; record: LiquidationRecord }`，`fundingPaid` 改成 `{ t: 'fundingPaid'; payment: FundingPayment }`
   - `rejected` 补上 `accountId` / `input` / `orderId` / `ts`，`clientOrderId` 改成可空
   - 新增 `settingUpdate` / `positionModeUpdate`

最省事的写法：直接把 `packages/engine/src/types.ts` 里 `EngineInput` 和 `EngineEvent` 两段复制过去，然后在代码块上方加一行 `> 以 packages/engine/src/types.ts 为准`。

```bash
git add docs/design/02-architecture.md
git commit -m "docs(design): 引擎契约回写——开户/重置等输入、订单 id 来源、事件字段对齐数据库"
```

---

## 验收清单

- [ ] `pnpm --filter @binance-contract-trading-full-stack/engine run check-types` 通过
- [ ] `pnpm --filter @binance-contract-trading-full-stack/engine run test`：5 个文件、20 条测试全部通过
- [ ] 做过第 3 节的练习：塞进 `Date.now()` 后纯净性守卫变红
- [ ] 做过第 5 节的练习：`EngineInput` 加一种新输入后 `assertNever` 编译报错
- [ ] `packages/engine/package.json` 的 `dependencies` 里只有 `shared`
- [ ] `02-architecture.md` 第六节已回写

全部打勾之后，告诉我"第 02 讲做完了"。我会读你实际写出来的代码，然后写第 03 讲——**计算公式**：保证金、可用余额、维持保证金、强平价。那一讲会第一次用上 `createTestEngine`，也会把这一讲留空的不变式 ③ 和 ⑥ 补上。

动手之前可以先想一个问题，第 03 讲开头要用：`README.md` 设计缺口清单第 5 条——强平价 45,180.72 不是 `tickSize` 0.1 的整数倍，那它到底该不该对齐？对齐的话往哪个方向对齐才是"保守"的？
