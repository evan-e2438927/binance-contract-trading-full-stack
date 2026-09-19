"use client";

import { Skeleton } from "@binance-contract-trading-full-stack/ui/components/skeleton";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useMemo, useState } from "react";

import { useTickers } from "@/hooks/use-symbol-market";
import { useSymbols } from "@/hooks/use-symbols";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

import { ContractRow } from "./contract-row";
import { CONTRACT_GRID } from "./grid";
import { sortByVolume } from "./sort-by-volume";

const EMPTY: SymbolSpec[] = [];
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];
const HEADERS = [
  { label: "币对", align: "text-left" },
  { label: "最新价", align: "text-right font-mono" },
  { label: "24h涨跌", align: "text-right font-mono" },
  { label: "标记价", align: "text-right font-mono" },
  { label: "资金费率", align: "text-right font-mono" },
  { label: "24h成交额", align: "text-right font-mono" },
  { label: "操作", align: "text-center" },
] as const;

/**
 * H-02 热门合约（Figma 2:367）：全部开放币对，按 24h 成交额降序（spec 一·3）。
 * 顺序只在首屏 24h 统计到齐时排一次：成交额随推送每秒在变（缺口 #47），每次重排行会上下跳，用户点不准。
 * 刷新页面才会按最新成交额重排。
 */
export function HotContracts() {
  const { data, isPending, error } = useSymbols();
  const symbols = data ?? EMPTY;
  useTickers(symbols.map((s) => s.symbol));

  // /market/tickers 一次写入全部币对（setTickers），所以任意一个有统计就说明首屏到齐了
  const statsArrived = useMarketStore((s) => symbols.some((spec) => s.tickers[spec.symbol]?.stats24h));
  const [order, setOrder] = useState<string[] | null>(null);
  if (order === null && statsArrived) {
    const { tickers } = useMarketStore.getState();
    setOrder(
      sortByVolume(
        symbols.map((spec) => ({ symbol: spec.symbol, quoteVolume: tickers[spec.symbol]?.stats24h?.quoteVolume })),
      ),
    );
  }

  const ordered = useMemo(() => {
    if (!order) return symbols;
    const rank = new Map(order.map((symbol, i) => [symbol, i]));
    // 排序之后才出现的币对（分层表刚同步进来）放最后
    return symbols.toSorted((a, b) => (rank.get(a.symbol) ?? order.length) - (rank.get(b.symbol) ?? order.length));
  }, [symbols, order]);

  return (
    <section className="mx-auto w-full max-w-[1100px] pt-12">
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[18px] text-foreground leading-[27px]">热门合约</h2>
        <span className="text-[12px] text-muted-foreground leading-[18px]">实时行情 · 自动刷新</span>
      </header>
      <div className="mt-4 overflow-hidden rounded-[10px] border bg-surface">
        <div
          className={cn(
            CONTRACT_GRID,
            "border-b py-2.5 font-medium text-[11px] text-muted-foreground leading-[16.5px]",
          )}
        >
          {HEADERS.map((h) => (
            <span key={h.label} className={h.align}>
              {h.label}
            </span>
          ))}
        </div>
        {error ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">{error.message}</p>
        ) : isPending ? (
          SKELETON_ROWS.map((key) => (
            <div key={key} className="border-b px-4 py-3 last:border-b-0">
              <Skeleton className="h-9 w-full" />
            </div>
          ))
        ) : (
          ordered.map((spec) => <ContractRow key={spec.symbol} spec={spec} />)
        )}
      </div>
    </section>
  );
}
