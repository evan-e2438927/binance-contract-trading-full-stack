import { parse } from "@binance-contract-trading-full-stack/shared";

export interface VolumeEntry {
  symbol: string;
  /** 24h 成交额（USDT，十进制字符串）；币安限流拿不到时为 null */
  quoteVolume: string | null | undefined;
}

const bySymbol = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * H-02 热门合约的顺序：24h 成交额降序（bigint 比较，不经过 Number）；
 * 拿不到成交额的排最后；相同时按币对名字母序，保证每次结果一样。
 */
export function sortByVolume(entries: readonly VolumeEntry[]): string[] {
  const keyed = entries.map((e) => ({
    symbol: e.symbol,
    volume: e.quoteVolume ? parse(e.quoteVolume) : null,
  }));
  keyed.sort((a, b) => {
    if (a.volume === null || b.volume === null) {
      if (a.volume === b.volume) return bySymbol(a.symbol, b.symbol);
      return a.volume === null ? 1 : -1;
    }
    if (a.volume !== b.volume) return a.volume > b.volume ? -1 : 1;
    return bySymbol(a.symbol, b.symbol);
  });
  return keyed.map((e) => e.symbol);
}
