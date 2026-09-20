import { openConnection, type Connection, type ConnectionOptions, type ConnectionState } from "./connection";
import { createLocalBook, type DepthSnapshot, type LocalBook } from "./local-book";
import { MarketParseError, parseStreamMessage, type DepthDiffEvent, type MarketEvent } from "./parse";
import { BINANCE_WS_BASE, combinedStreamUrl, type ConnectionName } from "./streams";

/**
 * 行情层对外的唯一入口：两条连接（/public 盘口、/market 成交 + 标记价 + K 线）合成一个行情源。
 *
 * 状态（设计缺口 #16：行情断线暂停交易由宿主负责，行情层负责如实报告"现在能不能信"）：
 * - connecting：启动后还没就绪过
 * - ready：两条连接都连着，而且**每个币对**都在这次连上之后收到过盘口和标记价。
 *   所以只能订阅币安上 status = TRADING 的币对——下架结算中的币对（比如 2026-09-17 的 TONUSDT，SETTLING）
 *   盘口永远是空的，订阅了就永远 ready 不了（见 exchange-info.ts）
 * - degraded：就绪过、后来断了（或者收到了解析不了的推送），在重新就绪之前都是这个状态
 *
 * "重新就绪"不去 REST 拉快照（04-backend-design.md 第 2 节原设计），而是等流本身推过来：
 * depth20 和 markPrice 都是完整快照，不是增量，重连后 100ms / 1s 内就会推一遍，不存在"补齐"的问题。
 * 少一条 REST 调用，也少一个"REST 快照和流对不上"的时间窗口。
 *
 * 行情事件**不管什么状态都往外发**：盘口和标记价是重新就绪的前提，得先让宿主收到。
 * 断线期间要不要暂停撮合、恢复后不补算（失真点 #7），是宿主看着状态决定的事（第 11 讲）。
 */

export type FeedStatus = "connecting" | "ready" | "degraded";

/**
 * 行情层对外发的事件：增量深度不往外发，它在这里被合成完整盘口（S01，local-book.ts），
 * 外面看到的还是原来的 book 事件，只是档位从 20 档变成 {@link BOOK_LEVELS} 档。
 */
export type FeedEvent = Exclude<MarketEvent, DepthDiffEvent>;

/**
 * 给引擎和界面的盘口档数（每侧）。
 *
 * 币安快照最多 1000 档，但每 100ms 把 2000 个档位重新排序、复制一遍太贵；200 档已经比原来的 20 档
 * 深十倍，够精度聚合到 1,000 和排队估算用。这是我们自己定的截断，写进失真点 #4。
 */
export const BOOK_LEVELS = 200;

/**
 * 拉快照用的档数。币安权重：5/10/20/50 档 = 2，100 档 = 5，500 档 = 10，1000 档 = 20。
 * 我们只留 {@link BOOK_LEVELS} 档，500 足够，权重只有 1000 档的一半。
 */
const SNAPSHOT_LIMIT = 500;

/**
 * 两次快照之间至少隔这么久。
 *
 * ⚠️ 2026-09-20 踩过的坑：19 个币对同时拉 1000 档快照（权重各 20），当场被币安封 IP（HTTP 418），
 * 而且失败后每秒重试一次，解封时又一起打过去，越封越久（508 → 868 → 1244 秒）。
 * 所以快照请求排队、按固定间隔发；失败按指数退避，不再定频重试。
 */
const SNAPSHOT_GAP_MS = 250;

/** 快照失败后的退避：第一次 1 秒，每次翻倍，最多 60 秒 */
const SNAPSHOT_BACKOFF_START_MS = 1_000;
const SNAPSHOT_BACKOFF_MAX_MS = 60_000;

export interface MarketFeedOptions {
  symbols: readonly string[];
  onEvent: (event: FeedEvent) => void;
  /** 拉盘口快照（S01）：默认用 binance-rest 的 depthSnapshot，测试注入假的 */
  fetchDepthSnapshot: (symbol: string, limit: number) => Promise<DepthSnapshot>;
  /** 两次快照之间的间隔，测试里设 0 */
  snapshotGapMs?: number;
  onStatusChange?: (status: FeedStatus) => void;
  logger?: Pick<Console, "log" | "error">;
  base?: string;
  /** 测试注入：默认 connection.ts 的 openConnection */
  openConnection?: (options: ConnectionOptions) => Connection;
  /** 透传给每条连接的选项（createSocket、定时器、退避……），测试用 */
  connectionOptions?: Partial<ConnectionOptions>;
}

export interface MarketFeed {
  status(): FeedStatus;
  /**
   * 单个币对能不能用：它所在的两条连接都连着，而且这次连上之后收到过它的盘口和标记价。
   * 整体 ready 要求所有币对都就绪；宿主按币对暂停撮合时看这个（第 11 讲）。
   */
  symbolReady(symbol: string): boolean;
  /** 某条连接当前是否连着，给日志 / 健康检查用 */
  connectionState(name: ConnectionName): ConnectionState;
  stop(): void;
}

export function startMarketFeed(options: MarketFeedOptions): MarketFeed {
  const logger = options.logger ?? console;
  const open = options.openConnection ?? openConnection;
  const symbols = new Set(options.symbols.map((s) => s.toUpperCase()));
  if (symbols.size === 0) throw new Error("行情层至少要订阅一个币对");

  // 每个币对一份本地盘口（S01）：增量流进来先喂它，合成完整盘口再发给引擎
  const books = new Map<string, LocalBook>();
  const fetchingSnapshot = new Set<string>();
  const queuedSnapshots = new Set<string>();
  const snapshotQueue: string[] = [];
  const snapshotBackoff = new Map<string, number>();
  const snapshotTimers = new Set<ReturnType<typeof setTimeout>>();
  let draining = false;

  const states: Record<ConnectionName, ConnectionState> = { public: "closed", market: "closed" };
  // 这次连上之后，哪些币对已经收到过盘口 / 标记价。连接一断就清空：断线前的快照不能证明现在的行情
  const sawBook = new Set<string>();
  const sawMark = new Set<string>();
  let status: FeedStatus = "connecting";
  let everReady = false;
  let stopped = false; // 主动停掉之后连接关闭不算断线，不再报状态、不再发事件

  function refreshStatus(): void {
    if (stopped) return;
    const ready =
      states.public === "open" &&
      states.market === "open" &&
      sawBook.size === symbols.size &&
      sawMark.size === symbols.size;
    if (ready) everReady = true;
    const next: FeedStatus = ready ? "ready" : everReady ? "degraded" : "connecting";
    if (next === status) return;
    status = next;
    logger.log(`[market] 行情状态 → ${next}`);
    options.onStatusChange?.(next);
  }

  /** 这条连接负责的就绪条件作废：public 管盘口，market 管标记价 */
  function invalidate(name: ConnectionName): void {
    (name === "public" ? sawBook : sawMark).clear();
    // 盘口那条断了：本地盘口全部作废，重连后每个币对都要重新拉快照
    if (name === "public") {
      for (const book of books.values()) book.reset();
    }
  }

  function bookOf(symbol: string): LocalBook {
    let book = books.get(symbol);
    if (!book) {
      book = createLocalBook({ levels: BOOK_LEVELS });
      books.set(symbol, book);
    }
    return book;
  }

  /**
   * 拉快照：排队、限速、失败退避。
   *
   * 一个币对同时只会有一个在途请求；队列按 {@link SNAPSHOT_GAP_MS} 逐个发，
   * 19 个币对大约 5 秒铺满，总权重远低于 IP 限额。失败按指数退避重排，不定频重试。
   */
  function requestSnapshot(symbol: string): void {
    if (stopped || fetchingSnapshot.has(symbol) || queuedSnapshots.has(symbol)) return;
    queuedSnapshots.add(symbol);
    snapshotQueue.push(symbol);
    void drainSnapshots();
  }

  async function drainSnapshots(): Promise<void> {
    if (draining) return;
    draining = true;
    while (!stopped && snapshotQueue.length > 0) {
      const symbol = snapshotQueue.shift()!;
      queuedSnapshots.delete(symbol);
      await fetchSnapshot(symbol);
      if (snapshotQueue.length > 0) await delay(options.snapshotGapMs ?? SNAPSHOT_GAP_MS);
    }
    draining = false;
  }

  function delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        snapshotTimers.delete(timer);
        resolve();
      }, ms);
      snapshotTimers.add(timer);
    });
  }

  async function fetchSnapshot(symbol: string): Promise<void> {
    if (stopped || states.public !== "open") return;
    fetchingSnapshot.add(symbol);
    try {
      const snapshot = await options.fetchDepthSnapshot(symbol, SNAPSHOT_LIMIT);
      if (stopped || states.public !== "open") return;
      const result = bookOf(symbol).applySnapshot(snapshot, Date.now());
      if (result.t === "book") {
        snapshotBackoff.delete(symbol);
        sawBook.add(symbol);
        options.onEvent({ t: "book", symbol, bids: result.bids, asks: result.asks, ts: result.ts });
        refreshStatus();
        return;
      }
      logger.error(`[market] ${symbol} 快照没接上，稍后重试：${result.t === "resync" ? result.reason : ""}`);
      retrySnapshot(symbol);
    } catch (error) {
      if (!stopped) {
        logger.error(`[market] ${symbol} 拉盘口快照失败，稍后重试`, error);
        retrySnapshot(symbol);
      }
    } finally {
      fetchingSnapshot.delete(symbol);
    }
  }

  /** 指数退避重排：1 秒起步，每次翻倍，最多 60 秒（被币安限流时别再上去加压） */
  function retrySnapshot(symbol: string): void {
    if (stopped) return;
    const previous = snapshotBackoff.get(symbol) ?? 0;
    const wait = previous === 0 ? SNAPSHOT_BACKOFF_START_MS : Math.min(previous * 2, SNAPSHOT_BACKOFF_MAX_MS);
    snapshotBackoff.set(symbol, wait);
    const timer = setTimeout(() => {
      snapshotTimers.delete(timer);
      requestSnapshot(symbol);
    }, wait);
    snapshotTimers.add(timer);
  }

  /** 增量深度：喂本地盘口，合成完整盘口发出去；序列号断了就重新拉快照 */
  function handleDepthDiff(event: DepthDiffEvent): void {
    const book = bookOf(event.symbol);
    const result = book.applyDiff(event);
    if (result.t === "book") {
      sawBook.add(event.symbol);
      options.onEvent({ t: "book", symbol: event.symbol, bids: result.bids, asks: result.asks, ts: result.ts });
      return;
    }
    if (result.t === "resync") {
      logger.error(`[market] ${event.symbol} 盘口要重新对齐：${result.reason}`);
      sawBook.delete(event.symbol);
    }
    // buffered / resync 都要有一份新快照才能继续
    requestSnapshot(event.symbol);
  }

  function handleMessage(name: ConnectionName, text: string): void {
    if (stopped) return;
    let event: MarketEvent | null;
    try {
      event = parseStreamMessage(text);
    } catch (error) {
      if (!(error instanceof MarketParseError)) throw error;
      if (!error.critical) {
        // 只给展示用的流（24 小时统计）：丢掉这一条，不连累撮合
        logger.error(`[market:${name}] 展示用推送解析失败，已丢弃：${error.message}`, error.raw.slice(0, 500));
        return;
      }
      // 解析不了说明协议可能变了：这条连接的数据先不信，等下一轮完整快照再恢复就绪
      logger.error(`[market:${name}] 推送解析失败：${error.message}`, error.raw.slice(0, 500));
      invalidate(name);
      refreshStatus();
      return;
    }
    if (!event || !symbols.has(event.symbol)) return;

    if (event.t === "depthDiff") {
      handleDepthDiff(event);
      refreshStatus();
      return;
    }
    if (event.t === "markPrice") sawMark.add(event.symbol);
    options.onEvent(event);
    refreshStatus();
  }

  const connections = (["public", "market"] as const).map((name) =>
    open({
      ...options.connectionOptions,
      name,
      url: combinedStreamUrl(name, [...symbols], options.base ?? BINANCE_WS_BASE),
      logger,
      onMessage: (text) => handleMessage(name, text),
      onStateChange: (state) => {
        states[name] = state;
        if (state !== "open") invalidate(name);
        refreshStatus();
      },
    }),
  );

  return {
    status: () => status,
    symbolReady: (symbol) =>
      states.public === "open" && states.market === "open" && sawBook.has(symbol) && sawMark.has(symbol),
    connectionState: (name) => states[name],
    stop() {
      stopped = true;
      for (const timer of snapshotTimers) clearTimeout(timer);
      snapshotTimers.clear();
      for (const connection of connections) connection.stop();
    },
  };
}
