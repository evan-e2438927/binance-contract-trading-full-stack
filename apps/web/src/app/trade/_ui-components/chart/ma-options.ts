/**
 * 图表上的均线（设计稿 4:4714 的 MA(7) / MA(25) / MA(99)）。
 * 颜色设计稿没给具体色值，按稿子的观感取：7 黄、25 蓝、99 紫。
 */
export const MA_LENGTHS = [7, 25, 99] as const;

export const MA_COLORS: Record<number, string> = {
  7: "#f0b90b",
  25: "#2e9bff",
  99: "#a45cff",
};
