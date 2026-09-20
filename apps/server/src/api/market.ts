import { leverageBrackets, symbols as symbolsTable, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import type { EngineHost } from "../engine-host/engine-host";
import type { SymbolSpec } from "@binance-contract-trading-full-stack/engine";
import { AppError } from "@binance-contract-trading-full-stack/shared";
import { asc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { toDecimal, toDecimalOrNull } from "../http/decimal";
import { FEES } from "../persistence/load";
import { ok, parseQuery } from "../http/respond";
import { stats24hJson } from "./serialize";
import { KLINE_INTERVALS, type BinanceRest, type Ticker24h } from "../market/binance-rest";
import type { FeedStatus } from "../market/market-feed";
import type { MarketState } from "../market/market-state";

/**
 * 行情接口（04-backend-design.md 第 11 节"行情（公共）"），不需要登录，按 IP 限流。
 *
 * 数据从哪来：
 * - 币对规格、分层表：数据库（seed:symbols / sync:brackets 同步的，分层表热加载后库里就是最新的）
 * - 盘口：引擎（撮合实际用的那份，host.read）
 * - 最新成交、标记价、指数价格：行情层（market-state，不管就绪与否收到就记）
 * - 24 小时统计、K 线、历史资金费率：代理币安 REST 并缓存（binance-rest.ts）
 */

export interface MarketDeps {
  db: DbExecutor;
  host: EngineHost;
  symbols: readonly SymbolSpec[];
  feed: { status(): FeedStatus; symbolReady(symbol: string): boolean };
  marketState: MarketState;
  rest: BinanceRest;
}

const symbolQuery = { symbol: z.string({ error: "缺少 symbol" }).min(1, "缺少 symbol") };
const intQuery = (name: string) => z.coerce.number({ error: `${name} 必须是整数` }).int(`${name} 必须是整数`);

export function createMarketRoutes(deps: MarketDeps, middleware: { rateLimit: MiddlewareHandler }) {
  const routes = new Hono();
  routes.use("*", middleware.rateLimit);

  /** 只对开放且在交易的币对提供行情：代理币安的接口不能变成"任意币对都能查"的免费转发 */
  function openSymbol(symbol: string): SymbolSpec {
    const spec = deps.symbols.find((s) => s.symbol === symbol);
    if (!spec || !spec.enabled || spec.status !== "TRADING") throw new AppError("SYMBOL_NOT_TRADING", `${symbol} 不存在或未开放交易`);
    return spec;
  }

  routes.get("/symbols", async (c) => {
    const rows = await deps.db.select().from(symbolsTable).where(eq(symbolsTable.enabled, true)).orderBy(asc(symbolsTable.sortOrder), asc(symbolsTable.symbol));
    const brackets = await deps.db.select().from(leverageBrackets).orderBy(asc(leverageBrackets.symbol), asc(leverageBrackets.bracket));
    return ok(
      c,
      rows.map((s) => {
        const mine = brackets.filter((b) => b.symbol === s.symbol);
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          status: s.status,
          pricePrecision: s.pricePrecision,
          quantityPrecision: s.quantityPrecision,
          tickSize: toDecimal(s.tickSize),
          minPrice: toDecimalOrNull(s.minPrice),
          maxPrice: toDecimalOrNull(s.maxPrice),
          stepSize: toDecimal(s.stepSize),
          minQty: toDecimal(s.minQty),
          maxQty: toDecimalOrNull(s.maxQty),
          marketStepSize: toDecimalOrNull(s.marketStepSize),
          marketMinQty: toDecimalOrNull(s.marketMinQty),
          marketMaxQty: toDecimalOrNull(s.marketMaxQty),
          minNotional: toDecimal(s.minNotional),
          percentPriceUp: toDecimalOrNull(s.percentPriceUp),
          percentPriceDown: toDecimalOrNull(s.percentPriceDown),
          maxNumOrders: s.maxNumOrders,
          liquidationFeeRate: toDecimalOrNull(s.liquidationFeeRate),
          // 手续费率来自引擎配置（persistence/load.ts 的 FEES，全站一个费率档）。放在币对里是为了前端
          // 算预估手续费时不用再单独请求一次；币安是按币对 + 用户等级给的，以后要分档就改这里
          makerFeeRate: toDecimal(FEES.makerFeeRate),
          takerFeeRate: toDecimal(FEES.takerFeeRate),
          maxLeverage: mine[0]?.maxLeverage ?? null,
          // 前端算"当前杠杆下最多能开多大"：所有 maxLeverage ≥ 当前杠杆的档位里，notionalCap 最大的那个（缺口 #44）
          brackets: mine.map((b) => ({
            bracket: b.bracket,
            notionalFloor: toDecimal(b.notionalFloor),
            notionalCap: toDecimal(b.notionalCap),
            maxLeverage: b.maxLeverage,
            maintMarginRate: toDecimal(b.mmr),
            maintAmount: toDecimal(b.cum),
          })),
        };
      }),
    );
  });

  /** 一个币对的 ticker：实时部分来自行情层，stats 是币安 24 小时统计（拿不到为 null） */
  function tickerOf(symbol: string, stats: Ticker24h | null) {
    const mark = deps.marketState.mark(symbol);
    const trade = deps.marketState.lastTrade(symbol);
    return {
      symbol,
      ready: deps.feed.symbolReady(symbol),
      lastPrice: trade ? toDecimal(trade.price) : null,
      lastTradeTime: trade?.ts ?? null,
      markPrice: mark ? toDecimal(mark.markPrice) : null,
      indexPrice: mark ? toDecimal(mark.indexPrice) : null,
      fundingRate: mark ? toDecimal(mark.fundingRate) : null,
      nextFundingTime: mark?.nextFundingTs ?? null,
      markTime: mark?.ts ?? null,
      stats24h: stats && stats24hJson(stats),
    };
  }

  /** 24 小时统计拿不到（币安限流、网络）不影响实时价格部分，stats24h 为 null */
  const orNull = <T>(p: Promise<T>) =>
    p.catch((error) => {
      if (error instanceof AppError) return null;
      throw error;
    });

  routes.get("/ticker", async (c) => {
    const { symbol } = parseQuery(c, z.object(symbolQuery));
    openSymbol(symbol);
    // 优先用币安 @ticker 推送（1 秒一条，缺口 #47）；服务刚启动、推送还没到时才转发 REST
    const stats = deps.marketState.stats24h(symbol) ?? (await orNull(deps.rest.ticker24h(symbol)));
    return ok(c, tickerOf(symbol, stats));
  });

  /**
   * 全部开放币对的 ticker（首页币对列表）。和 /ticker 一样的格式，顺序同 /symbols。
   * 24 小时统计向币安要一次全量，不按币对逐个转发：首页一次加载只占 1 次限流额度，也只占币安 1 次请求。
   */
  routes.get("/tickers", async (c) => {
    // 币对集合和顺序跟 /symbols 同一条查询，前端两份数据能一一对上
    const rows = await deps.db
      .select({ symbol: symbolsTable.symbol })
      .from(symbolsTable)
      .where(eq(symbolsTable.enabled, true))
      .orderBy(asc(symbolsTable.sortOrder), asc(symbolsTable.symbol));
    // 24 小时统计优先用推送；有币对还没收到推送（服务刚启动）才向币安要一次全量
    const missing = rows.some(({ symbol }) => !deps.marketState.stats24h(symbol));
    const all = missing ? await orNull(deps.rest.ticker24hAll()) : null;
    return ok(
      c,
      rows.map(({ symbol }) => tickerOf(symbol, deps.marketState.stats24h(symbol) ?? all?.get(symbol) ?? null)),
    );
  });

  routes.get("/depth", async (c) => {
    // S01：引擎里现在是 200 档，接口放开到 200（原来只有 20 档可选）
    const query = parseQuery(
      c,
      z.object({
        ...symbolQuery,
        limit: z.enum(["5", "10", "20", "50", "100", "200"], { error: "limit 只能是 5、10、20、50、100、200" }).default("20"),
      }),
    );
    openSymbol(query.symbol);
    const view = await deps.host.read((engine) => engine.marketView(query.symbol));
    if (!view) throw new AppError("SYMBOL_NOT_TRADING", `${query.symbol} 不存在或未开放交易`);
    const n = Number(query.limit);
    const level = (l: { price: bigint; qty: bigint }) => [toDecimal(l.price), toDecimal(l.qty)];
    return ok(c, {
      symbol: query.symbol,
      ready: deps.feed.symbolReady(query.symbol),
      bids: view.bids.slice(0, n).map(level),
      asks: view.asks.slice(0, n).map(level),
      updateTime: view.bookTs,
    });
  });

  routes.get("/klines", async (c) => {
    const query = parseQuery(
      c,
      z.object({
        ...symbolQuery,
        interval: z.enum(KLINE_INTERVALS, { error: `interval 只能是 ${KLINE_INTERVALS.join(" / ")}` }),
        limit: intQuery("limit").min(1, "limit 最小 1").max(1500, "limit 最大 1500").default(500),
        startTime: intQuery("startTime").min(0).optional(),
        endTime: intQuery("endTime").min(0).optional(),
      }),
    );
    openSymbol(query.symbol);
    if (query.startTime !== undefined && query.endTime !== undefined && query.startTime > query.endTime) {
      throw new AppError("INVALID_PARAMS", "startTime 不能晚于 endTime");
    }
    const klines = await deps.rest.klines(query);
    return ok(
      c,
      klines.map((k) => ({
        openTime: k.openTime,
        closeTime: k.closeTime,
        open: toDecimal(k.open),
        high: toDecimal(k.high),
        low: toDecimal(k.low),
        close: toDecimal(k.close),
        volume: toDecimal(k.volume),
        quoteVolume: toDecimal(k.quoteVolume),
        trades: k.trades,
        takerBuyVolume: toDecimal(k.takerBuyVolume),
        takerBuyQuoteVolume: toDecimal(k.takerBuyQuoteVolume),
      })),
    );
  });

  routes.get("/funding-history", async (c) => {
    const query = parseQuery(c, z.object({ ...symbolQuery, limit: intQuery("limit").min(1, "limit 最小 1").max(1000, "limit 最大 1000").default(100) }));
    openSymbol(query.symbol);
    const records = await deps.rest.fundingRates(query);
    return ok(
      c,
      records.map((r) => ({ fundingTime: r.fundingTime, fundingRate: toDecimal(r.fundingRate), markPrice: toDecimalOrNull(r.markPrice), rateType: r.rateType })),
    );
  });

  routes.get("/status", (c) => {
    return ok(c, {
      status: deps.feed.status(),
      symbols: deps.symbols
        .filter((s) => s.enabled && s.status === "TRADING")
        .map((s) => ({
          symbol: s.symbol,
          ready: deps.feed.symbolReady(s.symbol),
          lastTradeTime: deps.marketState.lastTrade(s.symbol)?.ts ?? null,
          markTime: deps.marketState.mark(s.symbol)?.ts ?? null,
        })),
    });
  });

  return routes;
}
