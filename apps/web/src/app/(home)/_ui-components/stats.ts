import type { SymbolSpec } from "@/server-api-module/market/types";

/** 数据条「最高杠杆」：所有币对里 maxLeverage 最大的那个。不写死数字，分层表变了这里跟着变 */
export function maxLeverageOf(
  symbols: readonly Pick<SymbolSpec, "baseAsset" | "maxLeverage">[],
): { maxLeverage: number; baseAsset: string } | null {
  let best: { maxLeverage: number; baseAsset: string } | null = null;
  for (const { baseAsset, maxLeverage } of symbols) {
    if (maxLeverage === null) continue;
    if (!best || maxLeverage > best.maxLeverage) best = { maxLeverage, baseAsset };
  }
  return best;
}
