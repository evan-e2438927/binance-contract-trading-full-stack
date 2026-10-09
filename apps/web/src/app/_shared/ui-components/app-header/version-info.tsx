"use client";

import { useQuery } from "@tanstack/react-query";

import { systemVersionQuery } from "@/server-api-module/system/queries";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** 秒数 → "X天X小时X分钟" 量级的中文文案；0 秒返回 "0分钟" */
export function formatUptime(uptimeSeconds: number): string {
  if (uptimeSeconds <= 0) return "0分钟";

  const totalMinutes = Math.floor(uptimeSeconds / 60);
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (days > 0 || hours > 0) parts.push(`${hours}小时`);
  parts.push(`${minutes}分钟`);
  return parts.join("");
}

/** 顶栏版本号 + 运行时长展示：加载中 / 出错时显示 "—" 占位 */
export function VersionInfo() {
  const { data, isLoading, isError } = useQuery(systemVersionQuery());

  const text = isLoading || isError || !data ? "—" : `v${data.version} · 运行 ${formatUptime(data.uptime)}`;

  return (
    <span
      role="status"
      data-testid="system-version-info"
      aria-label={`服务端版本与运行时长：${text}`}
      title={text}
      className="num text-muted-foreground text-xs"
    >
      {text}
    </span>
  );
}
