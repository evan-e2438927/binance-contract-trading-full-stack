/** 按币种名搜索（不分大小写）："bt" 匹配 BTCUSDT；也可以直接输完整币对名 "btcusdt"。空串返回全部 */
export function filterSymbols<T extends { symbol: string; baseAsset: string }>(list: readonly T[], query: string): T[] {
  const q = query.trim().toUpperCase().replace("/", "");
  if (!q) return [...list];
  return list.filter((s) => s.baseAsset.startsWith(q) || s.symbol.startsWith(q));
}
