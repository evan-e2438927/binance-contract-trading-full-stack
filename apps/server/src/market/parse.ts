import { parse, type Fixed } from "@binance-contract-trading-full-stack/shared";
import type { EngineInput, Level } from "@binance-contract-trading-full-stack/engine";

/**
 * 把币安组合流的一条推送解析成类型化的行情事件。
 *
 * 两条铁律：
 * 1. **价格、数量从字符串直接 parse() 成定标整数，不经过 number**（CLAUDE.md 硬约束 1）。
 *    币安推送里价格、数量本来就是字符串，JSON.parse 不会碰它们
 * 2. **格式不对就抛错，不猜**。字段缺了、不是十进制字符串、盘口没排好序——说明币安改了协议，
 *    这时候"尽量解析"出来的数字会直接进撮合，比停下来危险得多
 *
 * 字段含义以 2026-09-17 抓的真实推送为准（`__fixtures__/binance-streams-2026-09-17.jsonl`），
 * 对照表在 docs/design/07-binance-reference.md 第 7 节。
 */

export type BookEvent = Extract<EngineInput, { t: "book" }>;
export type TradeEvent = Extract<EngineInput, { t: "trade" }>;
/** 标记价推送：引擎输入之外多带一个指数价格（只给展示用，第 13b 讲 ticker 接口；引擎不看这个字段） */
export type MarkPriceEvent = Extract<EngineInput, { t: "markPrice" }> & { indexPrice: Fixed };

/** 1 分钟 K 线：只给前端画图，引擎不用（所以不是 EngineInput）。 */
export interface KlineEvent {
  t: "kline";
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: Fixed;
  high: Fixed;
  low: Fixed;
  close: Fixed;
  volume: Fixed;
  /** 这根 K 线是否已经收盘（`x`）。没收盘的会在这一分钟里反复推 */
  closed: boolean;
  ts: number;
}

/**
 * `<symbol>@ticker`：币安 24 小时滚动统计（不是 UTC 自然日），1 秒一条。只给界面展示（首页涨跌幅、成交额），
 * 引擎不用。2026-09-19 加，解决缺口 #47（原来 24 小时统计只能进页面时拉一次 REST）。
 */
export interface Stats24hEvent {
  t: "stats24h";
  symbol: string;
  priceChange: Fixed;
  /** 已经是百分数：4.095 表示 4.095% */
  priceChangePercent: Fixed;
  openPrice: Fixed;
  highPrice: Fixed;
  lowPrice: Fixed;
  lastPrice: Fixed;
  volume: Fixed;
  quoteVolume: Fixed;
  /** 统计窗口开始 / 结束时间 */
  openTime: number;
  closeTime: number;
  count: number;
  ts: number;
}

export type MarketEvent = BookEvent | TradeEvent | MarkPriceEvent | KlineEvent | Stats24hEvent;

export class MarketParseError extends Error {
  /**
   * 关键：这条流的数据会进撮合（盘口、成交、标记价）或者是就绪判断的依据。
   * 关键流解析失败要让这条连接降级、暂停撮合；非关键（24 小时统计）只记日志——展示数据出错不能让交易停下来。
   */
  readonly critical: boolean;

  constructor(message: string, readonly raw: string, options: { critical?: boolean } = {}) {
    super(message);
    this.name = "MarketParseError";
    this.critical = options.critical ?? true;
  }
}

/** 解析一条组合流推送。不认识的流返回 null（订阅之外的流不该出现，但出现了也不是数据错误）。 */
export function parseStreamMessage(raw: string): MarketEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    throw new MarketParseError("不是合法 JSON", raw);
  }
  const envelope = asRecord(message, "推送", raw);
  const stream = str(envelope, "stream", raw);
  const data = asRecord(envelope.data, "data", raw);
  const kind = stream.split("@")[1];

  switch (kind) {
    case "depth20":
      return parseDepth(data, raw);
    case "aggTrade":
      return parseAggTrade(data, raw);
    case "markPrice":
      return parseMarkPrice(data, raw);
    case "kline_1m":
      return parseKline(data, raw);
    case "ticker":
      try {
        return parseStats24h(data, raw);
      } catch (error) {
        if (!(error instanceof MarketParseError)) throw error;
        throw new MarketParseError(error.message, raw, { critical: false });
      }
    default:
      return null;
  }
}

/** `<symbol>@depth20@100ms`：b / a 各 20 档 [价格, 数量]，买盘降序、卖盘升序。时间用撮合时间 T。 */
function parseDepth(data: Record<string, unknown>, raw: string): BookEvent {
  expectEvent(data, "depthUpdate", raw);
  const bids = levels(data.b, "b", raw);
  const asks = levels(data.a, "a", raw);
  // 引擎假设 bids[0] 是买一、asks[0] 是卖一（state.ts BookState）。顺序不对说明协议变了，不能悄悄重排
  for (let i = 1; i < bids.length; i++) {
    if (bids[i]!.price >= bids[i - 1]!.price) throw new MarketParseError("买盘不是按价格降序", raw);
  }
  for (let i = 1; i < asks.length; i++) {
    if (asks[i]!.price <= asks[i - 1]!.price) throw new MarketParseError("卖盘不是按价格升序", raw);
  }
  return { t: "book", symbol: str(data, "s", raw), bids, asks, ts: int(data, "T", raw) };
}

/**
 * `<symbol>@aggTrade`：数量取 **nq**（只含普通订单，不含 RPI 订单），不取 q。
 * RPI 挂单不在 depth 流里，排队消耗必须和盘口同口径（第 06 讲定）。
 * nq 缺失就抛错，不退回 q——退回 q 会让排队悄悄变快。
 */
function parseAggTrade(data: Record<string, unknown>, raw: string): TradeEvent {
  expectEvent(data, "aggTrade", raw);
  const buyerIsMaker = data.m;
  if (typeof buyerIsMaker !== "boolean") throw new MarketParseError("aggTrade.m 不是布尔值", raw);
  return {
    t: "trade",
    symbol: str(data, "s", raw),
    tradeId: int(data, "a", raw),
    price: positive(data, "p", raw),
    qty: decimal(data, "nq", raw),
    buyerIsMaker,
    ts: int(data, "T", raw),
  };
}

/** `<symbol>@markPrice@1s`：p 标记价、i 指数价格、r 资金费率（可为负）、T 下次资金费结算时间；时间用事件时间 E。 */
function parseMarkPrice(data: Record<string, unknown>, raw: string): MarkPriceEvent {
  expectEvent(data, "markPriceUpdate", raw);
  return {
    t: "markPrice",
    symbol: str(data, "s", raw),
    markPrice: positive(data, "p", raw),
    indexPrice: positive(data, "i", raw),
    fundingRate: decimal(data, "r", raw, true),
    nextFundingTs: int(data, "T", raw),
    ts: int(data, "E", raw),
  };
}

function parseKline(data: Record<string, unknown>, raw: string): KlineEvent {
  expectEvent(data, "kline", raw);
  const k = asRecord(data.k, "kline.k", raw);
  const closed = k.x;
  if (typeof closed !== "boolean") throw new MarketParseError("kline.k.x 不是布尔值", raw);
  return {
    t: "kline",
    symbol: str(data, "s", raw),
    interval: str(k, "i", raw),
    openTime: int(k, "t", raw),
    closeTime: int(k, "T", raw),
    open: positive(k, "o", raw),
    high: positive(k, "h", raw),
    low: positive(k, "l", raw),
    close: positive(k, "c", raw),
    volume: decimal(k, "v", raw),
    closed,
    ts: int(data, "E", raw),
  };
}

/**
 * 字段对照（2026-09-19 抓的真实推送，`__fixtures__/binance-ticker-2026-09-19.jsonl`）：
 * p 涨跌额（可负）、P 涨跌幅（百分数，可负）、o 开盘、h 最高、l 最低、c 最新价、v 成交量、q 成交额、
 * O / C 统计窗口开始 / 结束、n 成交笔数、E 事件时间。w 均价、Q 最新成交量、F / L 成交 id 不用。
 */
function parseStats24h(data: Record<string, unknown>, raw: string): Stats24hEvent {
  expectEvent(data, "24hrTicker", raw);
  return {
    t: "stats24h",
    symbol: str(data, "s", raw),
    priceChange: decimal(data, "p", raw, true),
    priceChangePercent: decimal(data, "P", raw, true),
    openPrice: decimal(data, "o", raw),
    highPrice: decimal(data, "h", raw),
    lowPrice: decimal(data, "l", raw),
    lastPrice: decimal(data, "c", raw),
    volume: decimal(data, "v", raw),
    quoteVolume: decimal(data, "q", raw),
    openTime: int(data, "O", raw),
    closeTime: int(data, "C", raw),
    count: int(data, "n", raw),
    ts: int(data, "E", raw),
  };
}

// ─────────────────────────────────────────────────────────────
// 字段读取：每个都校验类型和格式
// ─────────────────────────────────────────────────────────────

/** 最多 8 位小数的十进制字符串。parse() 本身不校验格式，"1e5"、"abc" 会被它解析成错的数，所以这里先挡。 */
const DECIMAL = /^\d+(\.\d{1,8})?$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,8})?$/;

function asRecord(value: unknown, name: string, raw: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MarketParseError(`${name} 不是对象`, raw);
  }
  return value as Record<string, unknown>;
}

function expectEvent(data: Record<string, unknown>, event: string, raw: string): void {
  if (data.e !== event) throw new MarketParseError(`事件类型应为 ${event}，收到 ${String(data.e)}`, raw);
}

function str(data: Record<string, unknown>, key: string, raw: string): string {
  const value = data[key];
  if (typeof value !== "string" || value === "") throw new MarketParseError(`字段 ${key} 缺失或不是字符串`, raw);
  return value;
}

/** 时间戳、归集成交 id：JSON 里是数字，必须是安全整数（CLAUDE.md 允许时间戳、计数器用 number）。 */
function int(data: Record<string, unknown>, key: string, raw: string): number {
  const value = data[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MarketParseError(`字段 ${key} 不是整数`, raw);
  }
  return value;
}

function decimal(data: Record<string, unknown>, key: string, raw: string, signed = false): Fixed {
  const value = str(data, key, raw);
  if (!(signed ? SIGNED_DECIMAL : DECIMAL).test(value)) {
    throw new MarketParseError(`字段 ${key} 不是${signed ? "" : "非负"}十进制数（最多 8 位小数）：${value}`, raw);
  }
  return parse(value);
}

function positive(data: Record<string, unknown>, key: string, raw: string): Fixed {
  const value = decimal(data, key, raw);
  if (value <= 0n) throw new MarketParseError(`字段 ${key} 必须大于 0：${data[key]}`, raw);
  return value;
}

function levels(value: unknown, name: string, raw: string): Level[] {
  if (!Array.isArray(value)) throw new MarketParseError(`盘口 ${name} 不是数组`, raw);
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || typeof row[1] !== "string") {
      throw new MarketParseError(`盘口 ${name}[${i}] 不是 [价格, 数量]`, raw);
    }
    const [price, qty] = row as [string, string];
    if (!DECIMAL.test(price) || !DECIMAL.test(qty)) {
      throw new MarketParseError(`盘口 ${name}[${i}] 不是十进制数：${price} / ${qty}`, raw);
    }
    const level = { price: parse(price), qty: parse(qty) };
    if (level.price <= 0n || level.qty <= 0n) throw new MarketParseError(`盘口 ${name}[${i}] 价格或数量不为正`, raw);
    return level;
  });
}
