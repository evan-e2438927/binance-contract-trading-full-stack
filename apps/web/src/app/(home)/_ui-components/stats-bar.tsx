"use client";

import { Skeleton } from "@binance-contract-trading-full-stack/ui/components/skeleton";

import { useSymbols } from "@/hooks/use-symbols";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { PLACEHOLDER } from "@/lib/format/number";

import { maxLeverageOf } from "./stats";

interface StatItem {
  value: string;
  label: string;
  sub: string;
  loading?: boolean;
}

/**
 * 数据条（Figma 2:366）。设计稿里「模拟交易者 12,483」「最高杠杆 150x」是写死的，
 * 按不编数字的原则：最高杠杆、币对数从 /market/symbols 算，第 4 格换成真实的撮合特性（spec 一·1）。
 */
export function StatsBar() {
  const { data: symbols, isPending } = useSymbols();
  const top = symbols ? maxLeverageOf(symbols) : null;

  const items: StatItem[] = [
    { value: `${INITIAL_BALANCE_DISPLAY} USDT`, label: "初始模拟资金", sub: "虚拟资金，无真实风险" },
    {
      value: top ? `${top.maxLeverage}x` : PLACEHOLDER,
      label: "最高杠杆",
      sub: top ? `${top.baseAsset} 永续合约` : "按币安杠杆分层表",
      loading: isPending,
    },
    {
      value: symbols ? String(symbols.length) : PLACEHOLDER,
      label: "跟踪交易对",
      sub: "主流永续合约",
      loading: isPending,
    },
    { value: "20 档", label: "真实盘口撮合", sub: "市价单逐档成交，限价单模拟排队" },
  ];

  return (
    <section className="mx-auto max-w-[900px] pt-12">
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-[10px] border bg-border">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col items-center bg-surface px-6 py-5 text-center">
            {item.loading ? (
              <Skeleton className="my-[3px] h-[27px] w-20" />
            ) : (
              <div className="num font-bold font-mono text-[22px] text-brand leading-[33px]">{item.value}</div>
            )}
            <div className="pt-1 font-semibold text-[12px] text-foreground leading-[18px]">{item.label}</div>
            <div className="pt-0.5 text-[11px] text-muted-foreground leading-[16.5px]">{item.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
