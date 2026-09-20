"use client";

import { useState } from "react";

import type { SymbolSpec } from "@/server-api-module/market/types";
import { useUiStore } from "@/stores/ui-store";

import { resolutionOf } from "../../_lib/tv-resolution";
import { ChartToolbar } from "./chart-toolbar";
import { MA_LENGTHS } from "./ma-options";
import { TvChart } from "./tv-chart";

/** T-03 K 线区：自己的工具栏 + 图表。周期记在 ui-store，刷新后保留 */
export function ChartPanel({ spec }: { spec: SymbolSpec }) {
  const interval = useUiStore((s) => s.klineInterval);
  const setInterval = useUiStore((s) => s.setKlineInterval);
  const [maLengths, setMaLengths] = useState<number[]>([...MA_LENGTHS]);

  const toggleMa = (length: number) =>
    setMaLengths((current) =>
      current.includes(length) ? current.filter((n) => n !== length) : [...current, length].sort((a, b) => a - b),
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ChartToolbar interval={interval} onIntervalChange={setInterval} maLengths={maLengths} onToggleMa={toggleMa} />
      <TvChart spec={spec} resolution={resolutionOf(interval)} maLengths={maLengths} />
    </div>
  );
}
