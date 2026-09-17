import { openConnection, type Connection, type ConnectionOptions, type ConnectionState } from "./connection";
import { MarketParseError, parseStreamMessage, type MarketEvent } from "./parse";
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

export interface MarketFeedOptions {
  symbols: readonly string[];
  onEvent: (event: MarketEvent) => void;
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
  }

  function handleMessage(name: ConnectionName, text: string): void {
    if (stopped) return;
    let event: MarketEvent | null;
    try {
      event = parseStreamMessage(text);
    } catch (error) {
      if (!(error instanceof MarketParseError)) throw error;
      // 解析不了说明协议可能变了：这条连接的数据先不信，等下一轮完整快照再恢复就绪
      logger.error(`[market:${name}] 推送解析失败：${error.message}`, error.raw.slice(0, 500));
      invalidate(name);
      refreshStatus();
      return;
    }
    if (!event || !symbols.has(event.symbol)) return;

    if (event.t === "book") sawBook.add(event.symbol);
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
      for (const connection of connections) connection.stop();
    },
  };
}
