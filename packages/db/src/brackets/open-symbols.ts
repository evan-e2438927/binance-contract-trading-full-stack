/**
 * 对用户开放的币对，数组顺序就是前端列表的展示顺序。
 *
 * `seed:symbols` 按这份名单设置 `symbols.enabled` 和 `sortOrder`；分层表同步只处理
 * `enabled = true` 的币对。要开放或下架一个币对：改这里 → 跑 `seed:symbols` →
 * 跑 `sync:brackets`（或等 server 下一次每日同步）。
 */
export const OPEN_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "SUIUSDT",
  // TONUSDT 2026-09-17 移出：币安状态 SETTLING（下架结算，盘口为空），见 docs/tutorial/README.md 缺口 #30
  "FILUSDT",
] as const;

/** 某个币对的运营字段：在名单里就开放，排序从 1 开始；不在名单里就关闭、排序归 0。 */
export function openSymbolSetting(symbol: string): { enabled: boolean; sortOrder: number } {
  const index = (OPEN_SYMBOLS as readonly string[]).indexOf(symbol);
  return index === -1 ? { enabled: false, sortOrder: 0 } : { enabled: true, sortOrder: index + 1 };
}
