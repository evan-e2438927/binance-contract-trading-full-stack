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

/**
 * 币对规格，对应 symbols 表里引擎用得到的那几列。
 * 交易规则全部来自币安 `GET /fapi/v1/exchangeInfo` 该币对的 `filters`，字段名后面注明出处。
 */
export interface SymbolSpec {
  symbol: string;
  status: string; // 币安状态，'TRADING' 才允许下单（校验链第 1 步）
  enabled: boolean; // 我们是否对用户开放
  // PRICE_FILTER（校验链第 5 步）
  tickSize: Fixed; // 价格最小变动单位
  minPrice: Fixed; // 委托价 / 触发价下限
  maxPrice: Fixed; // 委托价 / 触发价上限
  // LOT_SIZE（校验链第 5 步，限价类订单）
  stepSize: Fixed; // 数量最小变动单位
  minQty: Fixed; // 最小下单数量
  maxQty: Fixed; // 最大下单数量
  // MARKET_LOT_SIZE（校验链第 5 步，市价单用这一组，不用 LOT_SIZE）
  marketStepSize: Fixed;
  marketMinQty: Fixed;
  marketMaxQty: Fixed; // BTCUSDT 限价单最多 1000，市价单最多 120
  // MIN_NOTIONAL（校验链第 6 步）
  minNotional: Fixed; // 最小下单名义价值，只减仓单不受限
  // PERCENT_PRICE（校验链第 7 步）：委托价必须落在 [标记价 × down, 标记价 × up]
  percentPriceUp: Fixed; // multiplierUp，BTCUSDT 1.05 → parse("1.05")
  percentPriceDown: Fixed; // multiplierDown，BTCUSDT 0.95 → parse("0.95")
  // MAX_NUM_ORDERS（校验链第 13 步）
  maxNumOrdersNum: number; // 每个账户在这个币对上最多挂多少单，BTCUSDT 200
  // exchangeInfo 币对级字段 liquidationFee（第 07 讲）
  liquidationFeeRate: Fixed; // 强平清算费率，按币对不同：BTCUSDT 0.0125（1.25%）、SOLUSDT 0.015
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
  // 强平清算费率不在这里：币安按币对设置，见 SymbolSpec.liquidationFeeRate（第 07 讲）
}

/**
 * 下单校验链里我们自己拍板的数字（币安没有对应规则的）。
 * 币安有的规则（价格上下限、挂单数上限……）按币对放在 SymbolSpec 里，不放这里。
 */
export interface LimitConfig {
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
  | {
      // 一条币安 @aggTrade 推送。字段对照（2026-09-17 抓取真实推送核对）：
      t: "trade";
      symbol: string;
      tradeId: number; // `a` 归集成交 id，币对内单调递增。Maker 成交的 id 用它拼（第 06 讲）
      price: Fixed; // `p`
      qty: Fixed; // ★ `nq`，不是 `q`：只含普通订单的成交量，不含 RPI 订单。盘口 depth 流不含 RPI 挂单，排队消耗要和盘口同口径
      buyerIsMaker: boolean; // `m`
      ts: number; // `T` 成交时间
    }
  | {
      t: "markPrice";
      symbol: string;
      markPrice: Fixed;
      fundingRate: Fixed;
      nextFundingTs: number;
      ts: number;
    }
  | {
      t: "settleFunding";
      symbol: string;
      rate: Fixed;
      markPrice: Fixed;
      ts: number;
    }
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
  | {
      t: "placeOrder";
      accountId: string;
      orderId: string;
      req: PlaceOrderRequest;
      ts: number;
    }
  | { t: "cancelOrder"; accountId: string; orderId: string; ts: number }
  | {
      t: "setLeverage";
      accountId: string;
      symbol: string;
      leverageNum: number;
      ts: number;
    }
  | {
      t: "setMarginMode";
      accountId: string;
      symbol: string;
      mode: MarginMode;
      ts: number;
    }
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
  | {
      t: "positionModeUpdate";
      accountId: string;
      positionMode: PositionMode;
      ts: number;
    }
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
