import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import { DirectionText } from "@/components/direction-text";
import { formatUsdt } from "@/lib/format/number";
import { formatDateTime } from "@/lib/format/time";
import type { Decimal, OrderSide, PositionSide } from "@/server-api-module/common/types";

import { POSITION_SIDE_LABEL, SIDE_LABEL } from "../../_shared/labels";

/** 五张表反复出现的几种格子。放一起是为了同一种东西在五个 tab 里长得一样 */

/** 时间列：本地时区、等宽字体 */
export function TimeCell({ ms }: { ms: number }) {
  return <span className="font-mono text-[11px] text-muted-foreground">{formatDateTime(ms)}</span>;
}

/** 买 / 卖：买绿卖红 */
export function SideCell({ side }: { side: OrderSide }) {
  return <span className={side === "BUY" ? "text-up" : "text-down"}>{SIDE_LABEL[side]}</span>;
}

/**
 * 持仓方向：多头绿、空头红。
 * 单向持仓模式下服务端给的是 BOTH（币安的表示法），没有多空之分，显示「单向」而不是空白。
 */
export function PositionSideCell({ side }: { side: PositionSide }) {
  if (side === "BOTH") return <span className="text-muted-foreground">单向</span>;
  return <span className={side === "LONG" ? "text-up" : "text-down"}>{POSITION_SIDE_LABEL[side]}</span>;
}

/** USDT 金额。signed = 带符号并按正负着色（盈亏、流水金额、资金费收付） */
export function UsdtCell({ value, signed = false }: { value: Decimal | null; signed?: boolean }) {
  if (!signed) return <span className="font-mono text-foreground">{formatUsdt(value)}</span>;
  return (
    <DirectionText value={value} className="font-mono">
      {formatUsdt(value, { signed: true })}
    </DirectionText>
  );
}

/** 「强平」「只减仓」这类小标签 */
export function Tag({ text, tone = "muted" }: { text: string; tone?: "muted" | "down" }) {
  return (
    <span
      className={cn(
        "ml-1.5 rounded-[3px] px-1 py-px text-[10px]",
        tone === "down" ? "bg-down/15 text-down" : "bg-elevated text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}
