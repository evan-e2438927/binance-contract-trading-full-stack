import { AppError, parse, type Fixed } from "@binance-contract-trading-full-stack/shared";

/**
 * 币安公开行情 REST 的代理（第 13b 讲；04-backend-design.md 第 1 节规划的 `binance-rest.ts`）。
 * 参数、上限、权重 2026-09-17 对照网页版核对（07-binance-reference.md 第 12 节）：
 *
 * | 接口 | 用途 | 上限 / 权重 |
 * | --- | --- | --- |
 * | `GET /fapi/v1/klines` | K 线 | limit 默认 500、最大 1500；权重按 limit 1 / 2 / 5 / 10 |
 * | `GET /fapi/v1/fundingRate` | 历史资金费率 | limit 默认 100、最大 1000；和 fundingInfo 共享 500 次 / 5 分钟 / IP |
 * | `GET /fapi/v1/ticker/24hr` | 24 小时统计 | 单币对权重 1；不带 symbol（全部币对）权重 40 |
 *
 * 为什么要缓存：这些限额是按**我们服务器的 IP** 算的，所有用户共用。前端每开一个页面都直连币安转发一次，
 * 几十个用户就能把 IP 打进币安的封禁名单（418），之后所有人的 K 线都没了。
 *
 * 三条规矩：
 * - **格式不对就报错，不猜**：价格数量按严格十进制解析，超过 8 位小数也拒（不截断），和行情推送解析同一个态度
 * - **被限流就退避**：429 / 418 按 Retry-After 暂停请求（没有就 60 秒），期间直接返回 SERVICE_UNAVAILABLE，不继续撞
 * - 同一个请求并发只发一次（single-flight），结果按 TTL 缓存
 */

export const BINANCE_REST_BASE = "https://fapi.binance.com";

/** 币安 U 本位 K 线周期（网页版 interval 枚举，15 个；没有 1s） */
export const KLINE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
export type KlineInterval = (typeof KLINE_INTERVALS)[number];

export interface Kline {
  openTime: number;
  closeTime: number;
  open: Fixed;
  high: Fixed;
  low: Fixed;
  close: Fixed;
  volume: Fixed;
  quoteVolume: Fixed;
  trades: number;
  takerBuyVolume: Fixed;
  takerBuyQuoteVolume: Fixed;
}

export interface FundingRateRecord {
  fundingTime: number;
  fundingRate: Fixed;
  /** 币安字段 "mark price associated with a particular funding fee charge"。早年的记录可能为空，为空就是 null */
  markPrice: Fixed | null;
  rateType: string | null;
}

export interface Ticker24h {
  priceChange: Fixed;
  priceChangePercent: Fixed; // 币安原样：-95.960 表示 −95.96%
  openPrice: Fixed;
  highPrice: Fixed;
  lowPrice: Fixed;
  lastPrice: Fixed;
  volume: Fixed;
  quoteVolume: Fixed;
  openTime: number;
  closeTime: number;
  count: number;
}

export interface BinanceRestOptions {
  fetch?: typeof fetch;
  now?: () => number;
  base?: string;
  timeoutMs?: number;
  logger?: Pick<Console, "error">;
  maxCacheEntries?: number;
}

export interface BinanceRest {
  klines(params: { symbol: string; interval: KlineInterval; limit: number; startTime?: number; endTime?: number }): Promise<Kline[]>;
  fundingRates(params: { symbol: string; limit: number }): Promise<FundingRateRecord[]>;
  ticker24h(symbol: string): Promise<Ticker24h>;
  /** 全部币对的 24 小时统计，按币对名索引。首页币对列表用，一次请求代替 N 次 */
  ticker24hAll(): Promise<Map<string, Ticker24h>>;
}

const INTERVAL_MS: Record<KlineInterval, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1M": 31 * 86_400_000,
};

export function createBinanceRest(options: BinanceRestOptions = {}): BinanceRest {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const base = options.base ?? BINANCE_REST_BASE;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const logger = options.logger ?? console;
  const maxEntries = options.maxCacheEntries ?? 500;

  let pausedUntil = 0;
  const cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  const unavailable = () => new AppError("SERVICE_UNAVAILABLE", "行情数据暂时拿不到，请稍后再试");

  async function getJson(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    if (now() < pausedUntil) throw unavailable();
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      logger.error(`[binance-rest] ${path} 请求失败`, error);
      throw unavailable();
    }
    if (response.status === 429 || response.status === 418) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const pauseMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
      pausedUntil = now() + pauseMs;
      logger.error(`[binance-rest] ${path} 被币安限流（HTTP ${response.status}），暂停 ${pauseMs / 1000} 秒`);
      throw unavailable();
    }
    if (!response.ok) {
      logger.error(`[binance-rest] ${path} HTTP ${response.status}：${await response.text().catch(() => "")}`);
      throw unavailable();
    }
    return response.json();
  }

  /** TTL 缓存 + single-flight。失败的结果不缓存 */
  function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > t) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { expiresAt: t + ttlMs, value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    if (cache.size > maxEntries) {
      for (const [k, entry] of cache) {
        if (entry.expiresAt <= t || cache.size > maxEntries) cache.delete(k);
        if (cache.size <= maxEntries) break;
      }
    }
    return value;
  }

  function parsed<T>(path: string, body: unknown, parser: (body: unknown) => T): T {
    try {
      return parser(body);
    } catch (error) {
      logger.error(`[binance-rest] ${path} 响应格式不对：${(error as Error).message}`);
      throw unavailable();
    }
  }

  return {
    klines({ symbol, interval, limit, startTime, endTime }) {
      // 最新的 K 线（最后一根还没收盘）只缓存 5 秒；整段都在过去、已经收盘的缓存 10 分钟
      const settled = endTime !== undefined && endTime < now() - INTERVAL_MS[interval];
      const key = `klines:${symbol}:${interval}:${limit}:${startTime ?? ""}:${endTime ?? ""}`;
      return cached(key, settled ? 600_000 : 5_000, async () =>
        parsed("/fapi/v1/klines", await getJson("/fapi/v1/klines", { symbol, interval, limit, startTime, endTime }), parseKlines),
      );
    },
    fundingRates({ symbol, limit }) {
      return cached(`funding:${symbol}:${limit}`, 60_000, async () =>
        parsed("/fapi/v1/fundingRate", await getJson("/fapi/v1/fundingRate", { symbol, limit }), parseFundingRates),
      );
    },
    ticker24h(symbol) {
      return cached(`ticker:${symbol}`, 3_000, async () =>
        parsed("/fapi/v1/ticker/24hr", await getJson("/fapi/v1/ticker/24hr", { symbol }), parseTicker24h),
      );
    },
    ticker24hAll() {
      // 权重 40（单币对的 40 倍），缓存 10 秒：最多每分钟 240，占 IP 限额 2400 / 分钟的一成
      return cached("ticker:all", 10_000, async () =>
        parsed("/fapi/v1/ticker/24hr", await getJson("/fapi/v1/ticker/24hr", {}), (body) => parseTicker24hAll(body, logger)),
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 解析：每个字段校验类型和格式
// ─────────────────────────────────────────────────────────────

const DECIMAL = /^\d+(\.\d{1,8})?$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,8})?$/;

function decimal(value: unknown, name: string, signed = false): Fixed {
  if (typeof value !== "string" || !(signed ? SIGNED_DECIMAL : DECIMAL).test(value)) {
    throw new Error(`${name} 不是${signed ? "" : "非负"}十进制字符串（最多 8 位小数）：${JSON.stringify(value)}`);
  }
  return parse(value);
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${name} 不是整数：${JSON.stringify(value)}`);
  return value;
}

export function parseKlines(body: unknown): Kline[] {
  if (!Array.isArray(body)) throw new Error("K 线响应不是数组");
  return body.map((row, i) => {
    if (!Array.isArray(row) || row.length < 11) throw new Error(`第 ${i} 根 K 线不是 12 元组`);
    return {
      openTime: integer(row[0], "openTime"),
      open: decimal(row[1], "open"),
      high: decimal(row[2], "high"),
      low: decimal(row[3], "low"),
      close: decimal(row[4], "close"),
      volume: decimal(row[5], "volume"),
      closeTime: integer(row[6], "closeTime"),
      quoteVolume: decimal(row[7], "quoteVolume"),
      trades: integer(row[8], "trades"),
      takerBuyVolume: decimal(row[9], "takerBuyVolume"),
      takerBuyQuoteVolume: decimal(row[10], "takerBuyQuoteVolume"),
    };
  });
}

export function parseFundingRates(body: unknown): FundingRateRecord[] {
  if (!Array.isArray(body)) throw new Error("资金费率响应不是数组");
  return body.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      fundingTime: integer(r.fundingTime, "fundingTime"),
      fundingRate: decimal(r.fundingRate, "fundingRate", true),
      markPrice: r.markPrice === undefined || r.markPrice === "" ? null : decimal(r.markPrice, "markPrice"),
      rateType: typeof r.rateType === "string" ? r.rateType : null,
    };
  });
}

/**
 * 全量 24 小时统计（数组，每项多一个 symbol）。
 * 币安会返回几百个币对，其中有我们不开放的（已下架、结算中的）。某一条格式不对只跳过它并记日志：
 * 那个币对的 stats24h 就是 null（界面显示 --），不能因为一个无关币对让所有币对都拿不到统计。
 */
export function parseTicker24hAll(body: unknown, logger: Pick<Console, "error">): Map<string, Ticker24h> {
  if (!Array.isArray(body)) throw new Error("全量 24 小时统计响应不是数组");
  const result = new Map<string, Ticker24h>();
  for (const item of body) {
    const symbol = (item as { symbol?: unknown } | null)?.symbol;
    if (typeof symbol !== "string") continue;
    try {
      result.set(symbol, parseTicker24h(item));
    } catch (error) {
      logger.error(`[binance-rest] /fapi/v1/ticker/24hr ${symbol} 格式不对，跳过：${(error as Error).message}`);
    }
  }
  return result;
}

export function parseTicker24h(body: unknown): Ticker24h {
  const r = (body ?? {}) as Record<string, unknown>;
  return {
    priceChange: decimal(r.priceChange, "priceChange", true),
    priceChangePercent: decimal(r.priceChangePercent, "priceChangePercent", true),
    openPrice: decimal(r.openPrice, "openPrice"),
    highPrice: decimal(r.highPrice, "highPrice"),
    lowPrice: decimal(r.lowPrice, "lowPrice"),
    lastPrice: decimal(r.lastPrice, "lastPrice"),
    volume: decimal(r.volume, "volume"),
    quoteVolume: decimal(r.quoteVolume, "quoteVolume"),
    openTime: integer(r.openTime, "openTime"),
    closeTime: integer(r.closeTime, "closeTime"),
    count: integer(r.count, "count"),
  };
}
