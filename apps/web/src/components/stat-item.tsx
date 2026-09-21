import { Tooltip, TooltipContent, TooltipTrigger } from "@binance-contract-trading-full-stack/ui/components/tooltip";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * 小标题 + 数值（交易页行情条 Figma 4:4667 等）。hint 有值时标题加虚下划线，悬停显示说明；
 * after 挂在标题后面，给规则页的 `?` 链接用（一两句话说不清的东西别塞进悬浮框）。
 */
export function StatItem({
  label,
  hint,
  after,
  className,
  children,
}: {
  label: string;
  hint?: string;
  after?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col", className)}>
      <span className="flex w-fit items-center">
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={<span />}
              className="w-fit cursor-help text-[10px] text-muted-foreground leading-[15px] underline decoration-dotted underline-offset-2"
            >
              {label}
            </TooltipTrigger>
            <TooltipContent side="bottom">{hint}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-[10px] text-muted-foreground leading-[15px]">{label}</span>
        )}
        {after}
      </span>
      <span className="num whitespace-nowrap font-mono text-[12px] text-foreground leading-[18px]">{children}</span>
    </div>
  );
}
