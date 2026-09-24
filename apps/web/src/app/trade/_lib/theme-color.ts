/**
 * 从全站 CSS 变量读颜色。图表库要的是十六进制字符串，不能用 Tailwind 类，
 * 但也不该在图表这边再写一份色值——改主题时两边会对不上。
 *
 * 服务端渲染时没有 document，返回兜底值（图表本来就只在客户端建）。
 */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 图上交易线用到的几个颜色，一处定义 */
export const lineColors = () => ({
  up: themeColor("--up", "#0ecb81"),
  down: themeColor("--down", "#f6465d"),
  warn: themeColor("--brand", "#f0b90b"),
  surface: themeColor("--bg-surface", "#161a1e"),
  elevated: themeColor("--bg-elevated", "#1e2329"),
  text: themeColor("--text-primary", "#eaecef"),
});
