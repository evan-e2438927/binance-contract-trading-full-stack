"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@binance-contract-trading-full-stack/ui/components/dialog";
import { TriangleAlert } from "lucide-react";

import { useSymbolSpec } from "@/hooks/use-symbols";
import { formatDecimal, formatPrice, formatQty, formatUsdt } from "@/lib/format/number";
import { useAccountStore } from "@/stores/account-store";

const SIDE_LABEL = { LONG: "多头", SHORT: "空头", BOTH: "" } as const;

/**
 * G-09 强平通知（05 第 13 节）：收到 WS liquidation 推送弹 Dialog，不是 Toast——
 * 这是用户最需要理解的一件事，不能一闪而过。多条强平排队，一条一条确认。
 * 设计稿出来后按稿调整；"查看详情"跳订单历史的强平记录 tab（第 5 阶段）。
 */
export function LiquidationDialog() {
  const current = useAccountStore((s) => s.liquidationQueue[0]);
  const dismiss = useAccountStore((s) => s.dismissLiquidation);
  const spec = useSymbolSpec(current?.symbol ?? "");

  if (!current) return null;

  // 币对规格还没加载到时按 8 位原样显示，不猜精度
  const price = (v: string) => (spec ? formatPrice(v, spec) : formatDecimal(v, 8));
  const qty = (v: string) => (spec ? formatQty(v, spec) : formatDecimal(v, 8));

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss(current.id)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-down">
            <TriangleAlert className="size-5" />
            仓位已被强制平仓
          </DialogTitle>
          <DialogDescription>
            保证金余额 {formatUsdt(current.marginBalanceBefore)} USDT 已低于维持保证金{" "}
            {formatUsdt(current.maintMarginAt)} USDT，系统按标记价强制平仓。
          </DialogDescription>
        </DialogHeader>
        <dl className="num grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">仓位</dt>
          <dd>
            {current.symbol} {SIDE_LABEL[current.positionSide]} {qty(current.qty)}
          </dd>
          <dt className="text-muted-foreground">开仓价 → 强平标记价</dt>
          <dd>
            {price(current.entryPrice)} → {price(current.markPrice)}
          </dd>
          <dt className="text-muted-foreground">已实现盈亏</dt>
          <dd className="text-down">{formatUsdt(current.realizedPnl, { signed: true })} USDT</dd>
          <dt className="text-muted-foreground">强平清算费</dt>
          <dd className="text-down">-{formatUsdt(current.liquidationFee)} USDT</dd>
        </dl>
        <DialogFooter>
          <Button onClick={() => dismiss(current.id)}>我知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
