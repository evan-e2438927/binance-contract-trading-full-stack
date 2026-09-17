/**
 * 从币安 `GET /fapi/v1/exchangeInfo` 查哪些币对现在能交易（status = TRADING）。公开接口，不需要 Key。
 *
 * 为什么行情层要关心：只有 TRADING 的币对才有盘口和成交。2026-09-17 发现 TONUSDT 已经是 SETTLING
 * （下架结算中，盘口为空），订阅了它，行情源就永远等不齐"每个币对都收到过盘口"，状态卡在 connecting。
 *
 * 生产上币对清单由宿主从数据库 symbols 表读（status 列由 seed:symbols 从 exchangeInfo 同步，第 11 讲）；
 * 这里给不连数据库的 watch 脚本用，也给宿主启动时核对用。
 */

export interface SymbolStatus {
  symbol: string;
  status: string;
}

/** 从 exchangeInfo 的响应里挑出这些币对的状态。响应格式不对就抛错；币安返回里没有的币对状态记为 "MISSING"。 */
export function symbolStatuses(response: unknown, symbols: readonly string[]): SymbolStatus[] {
  const list = (response as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(list)) throw new Error("exchangeInfo 响应里没有 symbols 数组");
  const byName = new Map<string, string>();
  for (const item of list) {
    const { symbol, status } = (item ?? {}) as { symbol?: unknown; status?: unknown };
    if (typeof symbol !== "string" || typeof status !== "string") throw new Error("exchangeInfo.symbols 里有格式不对的条目");
    byName.set(symbol, status);
  }
  return symbols.map((symbol) => ({ symbol, status: byName.get(symbol) ?? "MISSING" }));
}

export async function fetchSymbolStatuses(
  symbols: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<SymbolStatus[]> {
  const response = await fetchImpl("https://fapi.binance.com/fapi/v1/exchangeInfo");
  if (!response.ok) throw new Error(`exchangeInfo 请求失败：HTTP ${response.status}`);
  return symbolStatuses(await response.json(), symbols);
}
