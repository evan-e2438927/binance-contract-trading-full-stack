import { leverageBrackets, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { createEngine, type EngineInput, type LeverageBracket } from "@binance-contract-trading-full-stack/engine";
import type { PositionMode } from "@binance-contract-trading-full-stack/shared";
import { asc, inArray } from "drizzle-orm";
import { startMarketFeed, type FeedStatus, type MarketFeed, type MarketFeedOptions } from "../market/market-feed";
import { loadEngineConfig, loadEngineSnapshot } from "../persistence/load";
import { persistEvents } from "../persistence/persist";
import { createEngineHost, type EngineHost } from "./engine-host";
import { createFundingScheduler } from "./funding-scheduler";
import { createAccountRegistrar, type AccountRegistrar } from "./register-account";

/**
 * 交易内核启动（04-backend-design.md 第 1 节启动顺序第 3～7 步）：
 *
 * 1. 从数据库加载币对规格 + 分层表 → 引擎配置
 * 2. 从数据库恢复账户、设置、活跃仓位、未完成订单 → 引擎快照（排队位置一律当估算值，load.ts）
 * 3. 创建引擎和宿主
 * 4. 连币安行情，只订阅开放且 TRADING 的币对（缺口 #30）
 * 5. 等行情就绪，超时（默认 30 秒）就停掉并抛错——盘口和标记价没就位就不接受下单
 * 6. **不需要单独的"全账户风控补扫"**：就绪之后每个币对每秒都有标记价推送，引擎收到就扫描
 *    这个币对上有仓位的账户（第 07 讲），1 秒之内所有持仓账户都会按当前标记价判一遍。
 *    停机期间该强平的就在这时补上（02-architecture.md 第七节"重启恢复"第 4 步）
 */

export interface TradingCore {
  host: EngineHost;
  feed: MarketFeed;
  /** 开户（第 12 讲鉴权层调用）：账户行 + 身份行 + INITIAL 流水一个事务落库 */
  accounts: AccountRegistrar;
  /** 分层表每日同步发现变化后调用：从数据库读这些币对的新表，喂进引擎并立刻扫风控 */
  reloadBrackets(symbols: readonly string[]): Promise<void>;
  stop(): Promise<void>;
}

export interface TradingCoreOptions {
  db: DbExecutor;
  logger?: Pick<Console, "log" | "error">;
  readyTimeoutMs?: number;
  /** 测试注入：假行情 */
  startFeed?: (options: MarketFeedOptions) => MarketFeed;
  now?: () => number;
}

export async function startTradingCore(options: TradingCoreOptions): Promise<TradingCore> {
  const { db } = options;
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;

  const config = await loadEngineConfig(db);
  const snapshot = await loadEngineSnapshot(db);
  const engine = createEngine(config, snapshot);
  logger.log(
    `[trading] 已恢复 ${snapshot.accounts.length} 个账户、${snapshot.positions.length} 个仓位、${snapshot.orders.length} 张挂单`,
  );

  // 仓位落库要按持仓模式转换表示法（缺口 #12），账户的模式在这里跟着 commit 更新
  const modes = new Map<string, PositionMode>(snapshot.accounts.map((a) => [a.id, a.positionMode]));
  const positionModeOf = (accountId: string): PositionMode => {
    const mode = modes.get(accountId);
    if (!mode) throw new Error(`不知道账户 ${accountId} 的持仓模式`);
    return mode;
  };

  let feed: MarketFeed | null = null;
  // 注册器要往宿主 submit，宿主落库又要问注册器"这个账户是不是正在注册"——用闭包晚绑定 host
  const registrar = createAccountRegistrar({ submit: (input) => host.submit(input), now });
  const host: EngineHost = createEngineHost({
    engine,
    persist: (events) =>
      persistEvents(db, events, { positionModeOf, pendingRegistrationOf: registrar.pendingRegistrationOf }),
    isSymbolReady: (symbol) => feed?.symbolReady(symbol) ?? false,
    logger,
    onCommitted(input, events) {
      if (input.t === "registerAccount") modes.set(input.accountId, input.positionMode);
      for (const event of events) {
        if (event.t === "positionModeUpdate") modes.set(event.accountId, event.positionMode);
      }
    },
  });
  // 注册账户要先有持仓模式：registerAccount 本身只产生 INITIAL 流水，不用转换，但下一笔成交就要用
  // （onCommitted 在 commit 之后才更新，下一个输入排在它后面，顺序天然保证）

  const funding = createFundingScheduler({
    logger,
    submit: (input) => {
      host.submit(input).catch((error) => logger.error(`[funding] ${input.symbol} 结算失败`, error));
    },
  });

  const tradable = config.symbols.filter((s) => s.enabled && s.status === "TRADING").map((s) => s.symbol);
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  feed = (options.startFeed ?? startMarketFeed)({
    symbols: tradable,
    logger,
    onEvent(event) {
      if (event.t === "kline") return; // K 线只给前端（第 14 讲）
      if (event.t === "markPrice") funding.onMarkPrice(event);
      host.feedMarket(event);
    },
    onStatusChange(status: FeedStatus) {
      if (status === "ready") resolveReady();
    },
  });

  const timeoutMs = options.readyTimeoutMs ?? 30_000;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    ready.then(() => false),
    new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), timeoutMs))),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    feed.stop();
    throw new Error(`行情 ${timeoutMs}ms 内没有就绪（${tradable.length} 个币对），不启动交易`);
  }
  logger.log(`[trading] 行情就绪，${tradable.length} 个币对开始撮合`);

  return {
    host,
    feed,
    accounts: registrar,
    async reloadBrackets(symbols) {
      const known = symbols.filter((s) => config.symbols.some((spec) => spec.symbol === s));
      if (known.length === 0) return;
      const rows = await db.select().from(leverageBrackets).where(inArray(leverageBrackets.symbol, known)).orderBy(asc(leverageBrackets.bracket));
      const bySymbol = new Map<string, LeverageBracket[]>();
      for (const row of rows) {
        const list = bySymbol.get(row.symbol) ?? [];
        list.push({
          bracketNum: row.bracket,
          notionalFloor: row.notionalFloor,
          notionalCap: row.notionalCap,
          maxLeverageNum: row.maxLeverage,
          mmr: row.mmr,
          cum: row.cum,
        });
        bySymbol.set(row.symbol, list);
      }
      for (const [symbol, brackets] of bySymbol) {
        const input: EngineInput = { t: "setBrackets", symbol, brackets, ts: now() };
        await host.submit(input);
        logger.log(`[trading] ${symbol} 分层表已热加载进引擎`);
      }
    },
    async stop() {
      feed?.stop();
      await host.idle();
    },
  };
}
