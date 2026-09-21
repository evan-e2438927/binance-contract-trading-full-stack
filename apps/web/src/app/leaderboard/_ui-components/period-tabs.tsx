import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import type { LeaderboardPeriod } from "@/server-api-module/leaderboard/types";

import { PERIODS } from "../_lib/period";

/** B-01 周期切换：日榜 · 周榜 · 总榜 */
export function PeriodTabs({
  period,
  onChange,
}: {
  period: LeaderboardPeriod;
  onChange: (period: LeaderboardPeriod) => void;
}) {
  return (
    <div className="flex">
      {PERIODS.map((item) => (
        <button
          key={item.value}
          type="button"
          title={item.hint}
          onClick={() => onChange(item.value)}
          className={cn(
            "border-b-2 px-4 py-3 text-[13px] transition-colors",
            item.value === period
              ? "border-brand font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
