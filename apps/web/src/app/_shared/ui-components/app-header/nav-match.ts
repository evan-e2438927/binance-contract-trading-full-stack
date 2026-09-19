import { DEFAULT_SYMBOL } from "@/lib/config/constants";

export interface NavItem {
  href: string;
  /** 用来判断高亮的路径 */
  match: string;
  label: string;
  /** true = 只在完全相等时高亮（首页 "/" 要这样，否则所有页面都匹配） */
  exact?: boolean;
}

/**
 * G-01 主导航，顺序和文案按设计稿（Figma 2:17）。
 * 用 as const 保留 href 的字面量类型：Next 开了 typedRoutes，Link 要靠字面量校验路径是否存在
 */
export const NAV_ITEMS = [
  { href: "/", match: "/", label: "首页", exact: true },
  { href: `/trade/${DEFAULT_SYMBOL}`, match: "/trade", label: "交易" },
  { href: "/orders", match: "/orders", label: "订单" },
  { href: "/leaderboard", match: "/leaderboard", label: "排行榜" },
  { href: "/rules", match: "/rules", label: "规则" },
] as const satisfies readonly NavItem[];

/** 当前路径是否高亮这一项：exact 要完全相等；否则相等或以 "match/" 开头 */
export function isNavActive(pathname: string, item: Pick<NavItem, "match" | "exact">): boolean {
  if (item.exact) return pathname === item.match;
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
