"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import { DirectionText } from "@/components/direction-text";
import { usePriceDirection } from "@/hooks/use-price-direction";
import { decimalsOf, formatDecimal, formatPercentValue, formatPrice } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

const TONE = { up: "text-up", down: "text-down", flat: "text-foreground" } as const;

/**
 * 行情条左侧：大号最新价 + 24h 涨跌额（涨跌幅）（Figma 4:4660）。
 * 最新价按「和上一笔比」着色；涨跌额 / 幅按 24h 涨跌着色，两者可以不同色。
 */
export function LastPrice({ spec }: { spec: SymbolSpec }) {
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice);
  const stats = useMarketStore((s) => s.tickers[spec.symbol]?.stats24h);
  const dir = usePriceDirection(lastPrice);
  const change = stats?.priceChange;

  return (
    <div className="num flex shrink-0 flex-col font-mono">
      <span className={cn("font-bold text-[20px] leading-6", TONE[dir])}>{formatPrice(lastPrice, spec)}</span>
      <DirectionText value={change} className="text-[11px] leading-[16.5px]">
        {stats
          ? `${formatDecimal(change, decimalsOf(spec.tickSize), { signed: true, thousands: false })} (${formatPercentValue(stats.priceChangePercent)})`
          : "--"}
      </DirectionText>
    </div>
  );
}
