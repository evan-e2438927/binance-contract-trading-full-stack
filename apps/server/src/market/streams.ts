/**
 * 订阅哪些流、连到哪个地址（04-backend-design.md 第 2 节，按币安现状改过，设计缺口 #22）。
 *
 * 币安把合约 WebSocket 拆成了三个入口（本地文档 Connect、"Important WebSocket Change Notice"）：
 * - /public：高频公共行情——depth、bookTicker
 * - /market：普通行情——aggTrade、markPrice、kline……
 * - /private：用户数据流（我们用不到）
 * 不带入口的旧地址 /ws、/stream 只推 /public 那一类，2026-09-17 实测收得到 depth、收不到 aggTrade。
 *
 * 所以原设计的"连接 A 一条连三种流"要拆成两条：盘口一条、成交 + 标记价 + K 线 + 24 小时统计一条。
 * 单条连接最多 1024 个流，20 个币对 × 4 = 80 个，一条 /market 连接够用。
 * `@ticker`（24 小时滚动统计，1 秒一条）2026-09-19 加（缺口 #47），只给界面展示，解析失败不影响撮合（parse.ts）。
 */

export const BINANCE_WS_BASE = "wss://fstream.binance.com";

/** 行情层的两条连接。名字也用来在日志和状态里区分是哪条断了。 */
export type ConnectionName = "public" | "market";

/** 每个币对订阅的流。币安要求流名里的币对是小写。 */
export function streamsFor(connection: ConnectionName, symbol: string): string[] {
  const s = symbol.toLowerCase();
  return connection === "public"
    ? [`${s}@depth@100ms`] // 增量深度，每 100ms 一次；配合 REST 快照在本地维护完整盘口（S01，local-book.ts）
    : [`${s}@aggTrade`, `${s}@markPrice@1s`, `${s}@kline_1m`, `${s}@ticker`];
}

/** 组合流地址：wss://fstream.binance.com/<入口>/stream?streams=a/b/c，推送包成 {"stream","data"}。 */
export function combinedStreamUrl(connection: ConnectionName, symbols: readonly string[], base = BINANCE_WS_BASE): string {
  const streams = symbols.flatMap((symbol) => streamsFor(connection, symbol));
  return `${base}/${connection}/stream?streams=${streams.join("/")}`;
}
