"use client";

import type { SymbolSpec } from "@/server-api-module/market/types";

import { LastPrice } from "./last-price";
import { SymbolSwitcher } from "./symbol-switcher";
import { TickerStats } from "./ticker-stats";

/** T-01 币对切换 + T-02 行情条（Figma 4:4647），高 48px */
export function SymbolBar({ spec }: { spec: SymbolSpec }) {
  return (
    <div className="flex h-12 items-center gap-5 overflow-x-auto border-b bg-surface px-4">
      <SymbolSwitcher spec={spec} />
      <div className="h-6 w-px shrink-0 bg-border" />
      <LastPrice spec={spec} />
      <TickerStats spec={spec} />
    </div>
  );
}
