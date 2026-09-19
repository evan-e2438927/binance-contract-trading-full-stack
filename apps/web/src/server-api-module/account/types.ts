import type {
  Decimal,
  FillRole,
  LedgerType,
  MarginMode,
  OrderSide,
  PageQuery,
  PositionMode,
  PositionSide,
} from "../common/types";

/**
 * 账户模块（/account/*，要登录）的 DTO。来源：apps/server/src/api/account.ts、api/serialize.ts、ws/serialize.ts。
 * 仓位（Position）和订单（Order）的形状在 position / order 模块。
 */

// ——— 资产 ———

/**
 * 账户资产汇总（字段口径对照币安 GET /fapi/v3/account）。WS `account` 推送就是这个形状。
 * 带 null 的项在有仓位缺标记价时算不出来，显示 "--"。
 */
export interface AccountSummary {
  /** 钱包余额（USDT），等于全部资金流水之和，不含未实现盈亏 */
  walletBalance: Decimal;
  /** 全仓钱包余额 = 钱包余额 − 逐仓保证金 */
  crossWalletBalance: Decimal;
  /** 全部仓位的未实现盈亏（按标记价） */
  unrealizedPnl: Decimal | null;
  /** 全仓仓位的未实现盈亏 */
  crossUnrealizedPnl: Decimal | null;
  /** 保证金余额 = 钱包余额 + 全部未实现盈亏 */
  marginBalance: Decimal | null;
  /** 可用余额：下单校验用的同一个数 */
  availableBalance: Decimal | null;
  /** 全部仓位的起始保证金（按标记价 ÷ 杠杆） */
  positionInitialMargin: Decimal | null;
  /** 挂单冻结的保证金之和（含 Taker 手续费预留，比币安口径略多，缺口 #40） */
  openOrderMargin: Decimal;
  /** 全部仓位的维持保证金 */
  totalMaintMargin: Decimal | null;
  /** 全仓保证金率 = 全仓维持保证金 ÷ (全仓钱包余额 + 全仓未实现盈亏)，比例（1 = 100%） */
  marginRatio: Decimal | null;
  /** 单向 / 双向持仓 */
  positionMode: PositionMode;
  /** 有仓位但缺标记价的币对；非空时上面带 null 的项算不出来 */
  missingMarkPrices: string[];
}

/** GET /account：资产汇总 + 只有 REST 才给的账户信息 */
export interface Account extends AccountSummary {
  /** 昵称（排行榜显示用）；库里允许为 null */
  nickname: string | null;
  /** 现在能不能重置账户（距离上次重置满 24 小时） */
  canReset: boolean;
  /** 冷却中时，最早可以重置的时间；能重置时为 null */
  resetAvailableAt: number | null;
}

/** POST /account/reset 响应 */
export interface ResetAccountResult {
  /** 重置后的钱包余额（初始资金） */
  walletBalance: Decimal;
  /** 重置时间 */
  resetAt: number;
  /** 下次最早可以重置的时间 */
  resetAvailableAt: number;
}

// ——— 历史记录 ———

/** 成交。REST（/account/fills）和 WS `fill` 推送同一个形状 */
export interface Fill {
  /** 成交 id（uuid） */
  id: string;
  /** 所属订单 id */
  orderId: string;
  /** 币对名 */
  symbol: string;
  /** 买 / 卖 */
  side: OrderSide;
  /** 单向模式 BOTH；双向模式 LONG / SHORT */
  positionSide: PositionSide;
  /** 成交价 */
  price: Decimal;
  /** 这一笔成交的数量（基础币种） */
  qty: Decimal;
  /** 挂单方（Maker）/ 吃单方（Taker） */
  role: FillRole;
  /** 手续费（USDT） */
  fee: Decimal;
  /** 这一笔带来的已实现盈亏（开仓成交为 0） */
  realizedPnl: Decimal;
  /** 是不是强平引起的 */
  isLiquidation: boolean;
  /** 成交时间 */
  createdAt: number;
}

/** 资金流水。每一笔余额变动都有一条，GET /account/ledger */
export interface LedgerEntry {
  /** 流水 id（uuid） */
  id: string;
  /** 流水类型：INITIAL 初始资金 · RESET 重置 · REALIZED_PNL 已实现盈亏 · FEE 手续费 · FUNDING 资金费 · LIQUIDATION 强平盈亏 · LIQUIDATION_FEE 强平清算费 · MARGIN_TRANSFER 逐仓保证金划转 */
  type: LedgerType;
  /** 相关币对；和币对无关（如初始资金、重置）时为 null */
  symbol: string | null;
  /** 变动金额（USDT），带符号：收入为正、支出为负 */
  amount: Decimal;
  /** 这笔发生后的钱包余额 */
  balanceAfter: Decimal;
  /** 关联的业务对象类型，如 "fill" / "funding" / "liquidation"；没有时为 null */
  refType: string | null;
  /** 关联的业务对象 id，配合 refType 能查到是哪次成交 / 结算引起的；没有时为 null */
  refId: string | null;
  /** 发生时间 */
  createdAt: number;
}

/** GET /account/ledger 的查询参数 */
export interface LedgerQuery extends PageQuery {
  /** 只看某种流水；不传 = 全部 */
  type?: LedgerType;
}

/** 一次资金费结算。REST（/account/funding）和 WS `funding` 推送同一个形状 */
export interface FundingPayment {
  /** 记录 id（uuid） */
  id: string;
  /** 币对名 */
  symbol: string;
  /** 单向模式 BOTH；双向模式 LONG / SHORT */
  positionSide: PositionSide;
  /** 这一期的资金费率，比例 */
  fundingRate: Decimal;
  /** 结算时的标记价 */
  markPrice: Decimal;
  /** 结算时的仓位名义价值 */
  notional: Decimal;
  /** 收付金额（USDT），带符号：收到为正、支付为负 */
  amount: Decimal;
  /** 结算时间 */
  settledAt: number;
}

/** 一次强平。REST（/account/liquidations）和 WS `liquidation` 推送同一个形状 */
export interface Liquidation {
  /** 记录 id（uuid） */
  id: string;
  /** 币对名 */
  symbol: string;
  /** 单向模式 BOTH；双向模式 LONG / SHORT */
  positionSide: PositionSide;
  /** 被强平仓位的保证金模式 */
  marginMode: MarginMode;
  /** 强平数量（基础币种） */
  qty: Decimal;
  /** 仓位开仓均价 */
  entryPrice: Decimal;
  /** 触发强平时的标记价 */
  markPrice: Decimal;
  /** 强平造成的已实现盈亏 */
  realizedPnl: Decimal;
  /** 强平清算费（比普通手续费高） */
  liquidationFee: Decimal;
  /** 取证：强平前一刻的保证金余额 */
  marginBalanceBefore: Decimal;
  /** 取证：强平前一刻的维持保证金要求（余额跌破它才触发） */
  maintMarginAt: Decimal;
  /** 强平时间 */
  createdAt: number;
}

/** GET /account/equity-curve：每日权益快照（UTC 00:00 拍） + 当前权益 */
export interface EquityCurve {
  /** 每日快照，按日期升序；某天没拍到就没有那一天 */
  snapshots: {
    /** 快照日期（UTC），"YYYY-MM-DD" */
    date: string;
    /** 当日权益 = 钱包余额 + 全部未实现盈亏 */
    equity: Decimal;
    /** 当日钱包余额 */
    walletBalance: Decimal;
    /** 从上次重置起的累计盈亏 */
    cumulativePnl: Decimal;
    /** 从上次重置起的收益率，比例 */
    roi: Decimal;
  }[];
  /** 此刻的权益，画在曲线最右端 */
  current: {
    /** 当前权益（保证金余额）；缺标记价时为 null */
    equity: Decimal | null;
    /** 服务端取值时间 */
    time: number;
  };
}
