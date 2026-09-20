"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { memo } from "react";

import { useVisibleRows } from "@/hooks/use-visible-rows";

import { formatPrice, formatQty } from "@/lib/format/number";
import { formatTime } from "@/lib/format/time";
import type { SymbolSpec, Trade } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

/**
 * T-05 最新成交（Figma 4:5408）：价格（按主动买卖着色）· 数量 · 时间，最近 50 条，新的在上。
 * 数据是币安的真实成交，不是我们撮合出来的（store 已经限长 50 条）。
 */
/** 一行的高度（px），和下面 TradeRow 的 h-[20.5px] 必须一致 */
const TRADE_ROW_HEIGHT = 20.5;

export function RecentTrades({ spec }: { spec: SymbolSpec }) {
  const trades = useMarketStore((s) => s.trades[spec.symbol]);
  // 只渲染放得下的整行：原来 50 条全塞进 overflow-hidden，底部永远露半行（2026-09-20）
  const { ref, visibleRows } = useVisibleRows(TRADE_ROW_HEIGHT);
  const shown = visibleRows === null ? [] : (trades ?? []).slice(0, visibleRows);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b px-3 py-1.5">
        <span className="font-semibold text-[11px] text-foreground leading-[16.5px]">最新成交</span>
      </div>
      <div className="flex shrink-0 items-center border-b px-3 py-1 text-[11px] text-muted-foreground leading-[16.5px]">
        <span className="flex-1">价格({spec.quoteAsset})</span>
        <span className="flex-1 text-right">数量({spec.baseAsset})</span>
        <span className="flex-1 text-right">时间</span>
      </div>
      <div ref={ref} className="num flex min-h-0 flex-1 flex-col overflow-hidden">
        {trades?.length ? (
          shown.map((trade) => <TradeRow key={trade.tradeId} trade={trade} spec={spec} />)
        ) : (
          <p className="py-6 text-center text-[11px] text-muted-foreground">暂无成交</p>
        )}
      </div>
    </div>
  );
}

const TradeRow = memo(function TradeRow({ trade, spec }: { trade: Trade; spec: SymbolSpec }) {
  return (
    <div className="flex h-[20.5px] shrink-0 items-center px-3 font-mono text-[11px] leading-[16.5px]">
      {/* buyerIsMaker = 买方在挂单，这笔是主动卖出，显示红色 */}
      <span className={cn("flex-1", trade.buyerIsMaker ? "text-down" : "text-up")}>
        {formatPrice(trade.price, spec)}
      </span>
      <span className="flex-1 text-right text-foreground">{formatQty(trade.qty, spec)}</span>
      <span className="flex-1 text-right text-muted-foreground">{formatTime(trade.time)}</span>
    </div>
  );
});
