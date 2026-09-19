import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ComponentProps } from "react";

import { direction } from "@/lib/format/number";

const TONE = { up: "text-up", down: "text-down", flat: "text-muted-foreground" } as const;

/** 按 value 的正负着色（涨绿跌红，0 或取不到为灰）。value 是决定颜色的数，children 是要显示的文字，两者可以不同 */
export function DirectionText({
  value,
  className,
  ...props
}: { value: string | null | undefined } & ComponentProps<"span">) {
  return <span className={cn(TONE[direction(value)], className)} {...props} />;
}
