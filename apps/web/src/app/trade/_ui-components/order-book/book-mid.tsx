"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import { usePriceDirection } from "@/hooks/use-price-direction";
import { formatPrice, PLACEHOLDER } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

const TONE = { up: "text-up", down: "text-down", flat: "text-foreground" } as const;

/**
 * 盘口中间一行（Figma 4:5246）：最新价（按和上一笔比较着色）+ 标记价。
 * 设计稿这里写的是「≈$80715.0」的美元价；这个平台是 U 本位，再写一遍美元价没有信息量，
 * 按 08 T-04 换成标记价——强平和未实现盈亏都看它。
 */
export function BookMid({ spec }: { spec: SymbolSpec }) {
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice);
  const markPrice = useMarketStore((s) => s.tickers[spec.symbol]?.markPrice);
  const dir = usePriceDirection(lastPrice);

  return (
    <div className="num flex shrink-0 items-center gap-3 bg-elevated px-3 py-1">
      <span className={cn("font-bold font-mono text-[14px] leading-[21px]", TONE[dir])}>
        {formatPrice(lastPrice, spec)}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground leading-[15px]">
        标记 {markPrice ? formatPrice(markPrice, spec) : PLACEHOLDER}
      </span>
    </div>
  );
}
