"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import type { KlineInterval } from "@/server-api-module/market/types";

import { MA_COLORS, MA_LENGTHS } from "./ma-options";

/** 工具栏上的快捷周期（设计稿 4:4714）。其它周期用库自带的周期菜单，这里只放常用的 */
const QUICK_INTERVALS: KlineInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/**
 * K 线工具栏（Figma 4:4714）：周期按钮 + 均线开关。
 * 图表库自带的顶栏关掉了，这一条就是它的替代。
 */
export function ChartToolbar({
  interval,
  onIntervalChange,
  maLengths,
  onToggleMa,
}: {
  interval: KlineInterval;
  onIntervalChange: (interval: KlineInterval) => void;
  maLengths: number[];
  onToggleMa: (length: number) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-surface px-3">
      {QUICK_INTERVALS.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onIntervalChange(item)}
          className={cn(
            "rounded-[3px] px-2 py-0.5 text-[12px] leading-[18px] transition-colors",
            item === interval
              ? "bg-elevated font-semibold text-foreground"
              : "text-muted-foreground hover:bg-elevated hover:text-foreground",
          )}
        >
          {item}
        </button>
      ))}
      <span className="mx-1 h-3.5 w-px bg-border" />
      {MA_LENGTHS.map((length) => {
        const on = maLengths.includes(length);
        return (
          <button
            key={length}
            type="button"
            onClick={() => onToggleMa(length)}
            title={on ? `关闭 MA(${length})` : `显示 MA(${length})`}
            className={cn("px-1 font-mono text-[12px] leading-[18px] transition-opacity", !on && "opacity-40")}
            style={{ color: MA_COLORS[length] }}
          >
            MA({length})
          </button>
        );
      })}
    </div>
  );
}
