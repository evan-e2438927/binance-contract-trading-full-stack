"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useSyncExternalStore } from "react";
import { wsClient } from "@/lib/ws-client/instance";
import type { ConnectionStatus } from "@/lib/ws-client/protocol";

const LABEL: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
};

/** G-02 连接状态：顶栏里只显示小圆点（绿 = 已连接，黄闪 = 连接中 / 重连中），文字放悬停提示 */
export function ConnectionIndicator() {
  const status = useSyncExternalStore(
    (onChange) => wsClient.onStatus(onChange),
    () => wsClient.getStatus(),
    () => "idle" as const,
  );

  return (
    <span
      role="status"
      aria-label={`实时数据连接：${LABEL[status]}`}
      title={`实时数据连接：${LABEL[status]}`}
      className="flex size-4 items-center justify-center"
    >
      <span className={cn("size-2 rounded-full", status === "open" ? "bg-up" : "animate-pulse bg-brand")} />
    </span>
  );
}
