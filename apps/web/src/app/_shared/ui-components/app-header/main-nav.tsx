"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavActive, NAV_ITEMS } from "./nav-match";

/** G-01 主导航（Figma 2:17）：当前页是浮起的深色块 + 半粗白字，其余灰字 */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item);
        return (
          <Link
            key={item.match}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-[5px] px-[13px] py-[5px] text-[13px] leading-[19.5px] transition-colors",
              active ? "bg-elevated font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
