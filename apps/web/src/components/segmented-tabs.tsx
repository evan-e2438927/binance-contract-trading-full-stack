"use client";

import { TabsList, TabsTrigger } from "@binance-contract-trading-full-stack/ui/components/tabs";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * 分段式 tab（08 第 8 节，Figma 5:7228）：深色槽 + 选中项浮起一块。登录弹窗、排行榜周期、订单页 tab 都用这个。
 * 只换 packages/ui Tabs 的样式，外层仍用 <Tabs>，内容用 <TabsContent>。
 */
export function SegmentedTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn("w-full gap-[3px] rounded-[6px] bg-surface p-[3px] group-data-horizontal/tabs:h-10", className)}
      {...props}
    />
  );
}

export function SegmentedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-full rounded-[4px] py-[7px] font-medium text-[12px] text-muted-foreground leading-[18px]",
        "data-active:border-border data-active:bg-elevated data-active:text-foreground",
        "dark:data-active:border-border dark:data-active:bg-elevated dark:data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
