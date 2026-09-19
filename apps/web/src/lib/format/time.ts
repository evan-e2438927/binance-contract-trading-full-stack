import { PLACEHOLDER } from "./number";

/** 时间展示格式化。时间一律是毫秒时间戳，按本地时区显示 */

/** 资金费倒计时："03:42:15"。ms ≤ 0 显示 "00:00:00" */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 本地时区 "2026/09/19 11:30:05"（表格里的时间列） */
export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return PLACEHOLDER;
  return dateTimeFormatter.format(ms);
}

/** 本地时区 "11:30:05"（最新成交列表） */
export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return PLACEHOLDER;
  return timeFormatter.format(ms);
}
