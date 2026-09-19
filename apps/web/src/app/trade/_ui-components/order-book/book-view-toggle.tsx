"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import type { BookView } from "@/stores/ui-store";

/**
 * 盘口视图切换（08 T-04，设计稿没画）：买卖都显示 / 只看买 / 只看卖。
 * 三个小图标用色块画——上半红下半绿表示两边都显示，全绿只看买，全红只看卖。
 */
const VIEWS: { value: BookView; label: string; asks: boolean; bids: boolean }[] = [
  { value: "both", label: "买卖都显示", asks: true, bids: true },
  { value: "bids", label: "只看买盘", asks: false, bids: true },
  { value: "asks", label: "只看卖盘", asks: true, bids: false },
];

export function BookViewToggle({ view, onChange }: { view: BookView; onChange: (view: BookView) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {VIEWS.map((item) => (
        <button
          key={item.value}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-pressed={view === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "flex size-5 flex-col justify-center gap-[2px] rounded-[3px] p-1 hover:bg-elevated",
            view === item.value && "bg-elevated",
          )}
        >
          <Half on={item.asks} tone="down" />
          <Half on={item.bids} tone="up" />
        </button>
      ))}
    </div>
  );
}

function Half({ on, tone }: { on: boolean; tone: "up" | "down" }) {
  return (
    <span
      className={cn(
        "h-[4px] w-full rounded-[1px]",
        on ? (tone === "up" ? "bg-up" : "bg-down") : "bg-muted-foreground/25",
      )}
    />
  );
}
