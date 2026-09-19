"use client";

import { TriangleAlert } from "lucide-react";

import { useMarketStore } from "@/stores/market-store";

/**
 * G-03 行情降级横幅（05 第 2 节）：行情源断了 → 撮合暂停 → 顶栏下方黄条，下单按钮禁用。
 * 恢复后不补算断线期间的成交（CLAUDE.md "宁可说做不到，不要编数字"）。
 */
export function MarketStatusBanner() {
  const feedStatus = useMarketStore((s) => s.feedStatus);
  const matchingEnabled = useMarketStore((s) => s.matchingEnabled);

  if (feedStatus === "ready" || feedStatus === "unknown") {
    if (matchingEnabled) return null;
  }

  const text =
    feedStatus === "connecting"
      ? "正在连接币安行情，连上之前暂不能下单。"
      : "行情连接中断，撮合已暂停。恢复后不会补算中断期间的成交。";

  return (
    <div className="flex items-center gap-2 bg-warn-bg px-4 py-2 text-brand text-sm">
      <TriangleAlert className="size-4" />
      {text}
    </div>
  );
}
