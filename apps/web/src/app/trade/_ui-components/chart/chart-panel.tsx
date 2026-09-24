"use client";

import { useMemo, useState } from "react";

import type { SymbolSpec } from "@/server-api-module/market/types";
import { useAccountStore } from "@/stores/account-store";
import { useUiStore } from "@/stores/ui-store";

import { chartLines } from "../../_lib/chart-lines";
import { resolutionOf } from "../../_lib/tv-resolution";
import { ChartToolbar } from "./chart-toolbar";
import { MA_LENGTHS } from "./ma-options";
import { TvChart } from "./tv-chart";

/**
 * T-03 K 线区：自己的工具栏 + 图表。周期记在 ui-store，刷新后保留。
 *
 * M09：图上还要画出和自己有关的价位（开仓均价、强平价、挂单）。算在这里、画在 TvChart 里——
 * 算什么是纯函数（`_lib/chart-lines.ts`，有测试），怎么画才碰图表库。
 * 没登录时 store 是空的，自然一条线都不画。
 */
export function ChartPanel({ spec }: { spec: SymbolSpec }) {
  const interval = useUiStore((s) => s.klineInterval);
  const setInterval = useUiStore((s) => s.setKlineInterval);
  const [maLengths, setMaLengths] = useState<number[]>([...MA_LENGTHS]);
  const positions = useAccountStore((s) => s.positions);
  const openOrders = useAccountStore((s) => s.openOrders);
  // 标记价每跳一次，未实现盈亏就变一次 → 线上的文字跟着更新（对账逻辑保证不会重建线）
  const lines = useMemo(() => chartLines(spec.symbol, positions, openOrders, spec), [spec, positions, openOrders]);

  const toggleMa = (length: number) =>
    setMaLengths((current) =>
      current.includes(length) ? current.filter((n) => n !== length) : [...current, length].sort((a, b) => a - b),
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ChartToolbar interval={interval} onIntervalChange={setInterval} maLengths={maLengths} onToggleMa={toggleMa} />
      <TvChart spec={spec} resolution={resolutionOf(interval)} maLengths={maLengths} lines={lines} />
    </div>
  );
}
