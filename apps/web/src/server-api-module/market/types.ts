import type { Decimal } from "../common/types";

/** 行情模块（/market/*，公共接口，不用登录）的 DTO。来源：apps/server/src/api/market.ts、ws/publisher.ts */

// ——— 币对规格 ———

/** 杠杆分层表的一档（名义价值越大，最大杠杆越低、维持保证金率越高） */
export interface Bracket {
  /** 档位序号，从 1 开始 */
  bracket: number;
  /** 这一档名义价值下限（USDT，含） */
  notionalFloor: Decimal;
  /** 这一档名义价值上限（USDT，不含） */
  notionalCap: Decimal;
  /** 这一档允许的最大杠杆倍数 */
  maxLeverage: number;
  /** 维持保证金率，比例（0.004 = 0.4%） */
  maintMarginRate: Decimal;
  /** 维持保证金速算额（USDT）：维持保证金 = 名义价值 × maintMarginRate − maintAmount */
  maintAmount: Decimal;
}

/**
 * 币对规格 + 杠杆分层表。来源：GET /market/symbols（数组，只含开放的币对，按后台排序）。
 * 下单参数校验、展示位数都按它；分层表每天从币安同步一次。
 */
export interface SymbolSpec {
  /** 币对名，如 "BTCUSDT" */
  symbol: string;
  /** 基础币种，如 "BTC" */
  baseAsset: string;
  /** 计价币种，本项目固定 "USDT" */
  quoteAsset: string;
  /** 币安的交易状态，开放交易为 "TRADING" */
  status: string;
  /** 币安的价格精度（位数）。展示别用它，用 tickSize 推 */
  pricePrecision: number;
  /** 币安的数量精度（位数）。展示别用它，用 stepSize 推 */
  quantityPrecision: number;
  /** 价格最小变动单位，如 "0.10000000"。价格展示位数按它推（lib/format 的 decimalsOf） */
  tickSize: Decimal;
  /** 最低挂单价；币安没给时为 null */
  minPrice: Decimal | null;
  /** 最高挂单价；币安没给时为 null */
  maxPrice: Decimal | null;
  /** 限价单数量最小变动单位。数量展示位数按它推 */
  stepSize: Decimal;
  /** 限价单最小数量 */
  minQty: Decimal;
  /** 限价单最大数量；币安没给时为 null */
  maxQty: Decimal | null;
  /** 市价单数量最小变动单位；null = 同 stepSize */
  marketStepSize: Decimal | null;
  /** 市价单最小数量；null = 同 minQty */
  marketMinQty: Decimal | null;
  /** 市价单最大数量；null = 不限 */
  marketMaxQty: Decimal | null;
  /** 最小名义价值（价格 × 数量，USDT） */
  minNotional: Decimal;
  /** 限价单价格上限系数（币安 PERCENT_PRICE.multiplierUp）：挂单价 ≤ 标记价 × 它，如 "1.05"；null = 不限 */
  percentPriceUp: Decimal | null;
  /** 限价单价格下限系数（multiplierDown）：挂单价 ≥ 标记价 × 它，如 "0.95"；null = 不限 */
  percentPriceDown: Decimal | null;
  /** 该币对最多同时挂多少单 */
  maxNumOrders: number;
  /** 强平清算费率，比例；null = 币安没给 */
  liquidationFeeRate: Decimal | null;
  /** 该币对最大杠杆（分层表第 1 档）；分层表还没同步时为 null */
  maxLeverage: number | null;
  /** 杠杆分层表，按档位升序。"当前杠杆下最多能开多大" = 所有 maxLeverage ≥ 当前杠杆的档位里最大的 notionalCap */
  brackets: Bracket[];
}

// ——— Ticker ———

/** 币安 24 小时滚动统计（服务端代理币安 REST 并缓存） */
export interface Stats24h {
  /** 24 小时涨跌额 */
  priceChange: Decimal;
  /** 24 小时涨跌幅，**已经是百分数**（"2.34" 表示 2.34%），用 formatPercentValue 展示 */
  priceChangePercent: Decimal;
  /** 24 小时前的开盘价 */
  openPrice: Decimal;
  /** 24 小时最高价 */
  highPrice: Decimal;
  /** 24 小时最低价 */
  lowPrice: Decimal;
  /** 24 小时成交量（基础币种） */
  volume: Decimal;
  /** 24 小时成交额（USDT） */
  quoteVolume: Decimal;
  /** 统计窗口开始时间 */
  openTime: number;
  /** 统计窗口结束时间 */
  closeTime: number;
  /** 24 小时成交笔数 */
  count: number;
}

/** WS `ticker:<SYMBOL>` 推送：跟着标记价约 1 秒一条，顺带最新的 24 小时统计（缺口 #47） */
export interface TickerPush {
  /** 最新成交价；还没收到过成交时为 null */
  lastPrice: Decimal | null;
  /** 最新成交时间；还没收到过成交时为 null */
  lastTradeTime: number | null;
  /** 标记价（算盈亏、强平用） */
  markPrice: Decimal;
  /** 指数价 */
  indexPrice: Decimal;
  /** 当期资金费率，比例（0.0001 = 0.01%） */
  fundingRate: Decimal;
  /** 下次资金费结算时间 */
  nextFundingTime: number;
  /** 这条标记价的时间 */
  markTime: number;
  /** 最新 24 小时统计（服务端订的币安 @ticker 流）；服务端刚启动、还没收到时为 null，这时保留 REST 拉到的 */
  stats24h: Stats24h | null;
}

/** GET /market/ticker：实时部分 + 24 小时统计。行情还没收到的部分为 null */
export interface Ticker {
  /** 币对名 */
  symbol: string;
  /** 该币对行情是否就绪（服务端和币安连着，且这次连上后收到过它的盘口和标记价） */
  ready: boolean;
  /** 最新成交价；还没收到过成交时为 null */
  lastPrice: Decimal | null;
  /** 最新成交时间 */
  lastTradeTime: number | null;
  /** 标记价；还没收到时为 null */
  markPrice: Decimal | null;
  /** 指数价 */
  indexPrice: Decimal | null;
  /** 当期资金费率，比例 */
  fundingRate: Decimal | null;
  /** 下次资金费结算时间 */
  nextFundingTime: number | null;
  /** 标记价的时间 */
  markTime: number | null;
  /** 24 小时统计；拿不到（币安限流、网络）时为 null，那几项显示 "--" */
  stats24h: Stats24h | null;
}

// ——— 盘口与成交 ———

/** 一档盘口：[价格, 数量] */
export type BookLevel = [price: Decimal, qty: Decimal];

/** 盘口快照。WS `depth:<SYMBOL>` 推送就是这个形状（20 档全量，不是增量） */
export interface OrderBook {
  /** 买盘，价格从高到低 */
  bids: BookLevel[];
  /** 卖盘，价格从低到高 */
  asks: BookLevel[];
  /** 盘口时间；新快照比旧的小时丢弃 */
  updateTime: number;
}

/** GET /market/depth：引擎撮合实际用的那份盘口 */
export interface DepthSnapshot extends OrderBook {
  /** 币对名 */
  symbol: string;
  /** 该币对行情是否就绪 */
  ready: boolean;
}

/** WS `trade:<SYMBOL>`：币安的一笔真实成交（最新成交列表用） */
export interface Trade {
  /** 币安成交 id */
  tradeId: number;
  /** 成交价 */
  price: Decimal;
  /** 成交量（基础币种） */
  qty: Decimal;
  /** true = 买方是挂单方，即主动卖出（列表里显示红色） */
  buyerIsMaker: boolean;
  /** 成交时间 */
  time: number;
}

// ——— K 线 ———

/** 支持的 K 线周期，和币安一致 */
export const KLINE_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

/** K 线周期 */
export type KlineInterval = (typeof KLINE_INTERVALS)[number];

/** GET /market/klines 的一根 K 线（代理币安 REST），按开盘时间升序 */
export interface Kline {
  /** 开盘时间 */
  openTime: number;
  /** 收盘时间 */
  closeTime: number;
  /** 开盘价 */
  open: Decimal;
  /** 最高价 */
  high: Decimal;
  /** 最低价 */
  low: Decimal;
  /** 收盘价 */
  close: Decimal;
  /** 成交量（基础币种） */
  volume: Decimal;
  /** 成交额（USDT） */
  quoteVolume: Decimal;
  /** 成交笔数 */
  trades: number;
  /** 主动买入成交量 */
  takerBuyVolume: Decimal;
  /** 主动买入成交额 */
  takerBuyQuoteVolume: Decimal;
}

/** GET /market/klines 的查询参数 */
export interface KlineQuery {
  /** 币对名 */
  symbol: string;
  /** K 线周期 */
  interval: KlineInterval;
  /** 根数，1～1500，默认 500 */
  limit?: number;
  /** 起始时间（含） */
  startTime?: number;
  /** 结束时间（含），不能早于 startTime */
  endTime?: number;
}

/** WS `kline:<SYMBOL>:<interval>`：当前这根 K 线的最新状态 */
export interface KlinePush {
  /** K 线周期 */
  interval: KlineInterval;
  /** 开盘时间，同一根 K 线不变 */
  openTime: number;
  /** 收盘时间 */
  closeTime: number;
  /** 开盘价 */
  open: Decimal;
  /** 最高价 */
  high: Decimal;
  /** 最低价 */
  low: Decimal;
  /** 收盘价（未收盘时是最新价） */
  close: Decimal;
  /** 成交量（基础币种） */
  volume: Decimal;
  /** true = 这根已经收盘，之后的推送是下一根 */
  closed: boolean;
}

// ——— 资金费 ———

/** GET /market/funding-history 的一条（代理币安 REST），币安的历史资金费率 */
export interface FundingRateRecord {
  /** 结算时间 */
  fundingTime: number;
  /** 这一期的资金费率，比例 */
  fundingRate: Decimal;
  /** 结算时的标记价；币安没给时为 null */
  markPrice: Decimal | null;
  /** 币安的费率类型字段，原样透传 */
  rateType: string;
}

// ——— 行情源状态 ———

/**
 * 服务端行情源状态（apps/server/src/market/market-feed.ts）：
 * connecting 启动后还没就绪过 · ready 连着且每个币对都收到过盘口和标记价 · degraded 就绪过、后来断了，重新就绪前一直是它
 */
export type FeedStatus = "connecting" | "ready" | "degraded";

/** WS `market` 频道：行情源状态变化时推 */
export interface MarketStatusPush {
  /** 行情源状态 */
  status: FeedStatus;
  /** 是否允许撮合；false 时全站禁止下单、平仓 */
  matchingEnabled: boolean;
}

/** GET /market/status */
export interface MarketStatus {
  /** 行情源整体状态 */
  status: FeedStatus;
  /** 各开放币对的就绪情况 */
  symbols: {
    /** 币对名 */
    symbol: string;
    /** 该币对行情是否就绪 */
    ready: boolean;
    /** 最近一次收到成交的时间；没收到过为 null */
    lastTradeTime: number | null;
    /** 最近一次收到标记价的时间；没收到过为 null */
    markTime: number | null;
  }[];
}
