"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { usePathname } from "next/navigation";

import { DirectionText } from "@/components/direction-text";
import { usePriceDirection } from "@/hooks/use-price-direction";
import { useSymbolSpec } from "@/hooks/use-symbols";
import { formatPercentValue, formatPrice } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

const TONE = { up: "text-up", down: "text-down", flat: "text-foreground" } as const;

/** "/trade/btcusdt" → "BTCUSDT"；不是交易页返回 null */
export function tradeSymbolOf(pathname: string): string | null {
  const match = /^\/trade\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]).toUpperCase() : null;
}

/**
 * 顶栏行情（Figma 4:4632）：交易页当前币对的最新价 + 24h 涨跌幅，其它页面不显示。
 * 只读 market-store，不自己订阅——交易页的 useSymbolMarket 已经订了。
 */
export function HeaderTicker() {
  const symbol = tradeSymbolOf(usePathname());
  const spec = useSymbolSpec(symbol ?? "");
  if (!spec) return null;
  // 按币对重新挂载：切币对时不能拿新币对的价格和旧币对的上一笔比较着色
  return <TickerText key={spec.symbol} spec={spec} />;
}

function TickerText({ spec }: { spec: SymbolSpec }) {
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice);
  const change = useMarketStore((s) => s.tickers[spec.symbol]?.stats24h?.priceChangePercent);
  const dir = usePriceDirection(lastPrice);

  return (
    <div className="num mr-3 flex items-center gap-3.5 font-mono">
      <span className={cn("font-bold text-[16px] leading-6", TONE[dir])}>{formatPrice(lastPrice, spec)}</span>
      <DirectionText value={change} className="text-[12px] leading-[18px]">
        {formatPercentValue(change)}
      </DirectionText>
    </div>
  );
}
