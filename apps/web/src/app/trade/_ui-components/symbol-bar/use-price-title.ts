import { useEffect } from "react";

import { formatPrice } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

/**
 * 浏览器标签页标题跟着最新价变："81,136.6 BTCUSDT · 合约模拟盘"（M02）。
 * 还没有最新价时保留 page.tsx 的 metadata 标题；离开交易页时恢复原标题。
 */
export function usePriceTitle(spec: SymbolSpec) {
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice);

  useEffect(() => {
    if (!lastPrice) return;
    const previous = document.title;
    document.title = `${formatPrice(lastPrice, spec)} ${spec.symbol} · 合约模拟盘`;
    return () => {
      document.title = previous;
    };
  }, [lastPrice, spec]);
}
