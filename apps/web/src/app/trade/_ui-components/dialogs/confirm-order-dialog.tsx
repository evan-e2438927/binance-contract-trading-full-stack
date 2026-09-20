"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import { formatPrice, formatQty, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import type { MarginMode, OrderSide, PositionMode } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import type { OrderPreview } from "@/server-api-module/order/types";

import type { OrderFormValues } from "../../_lib/order-body";

/**
 * 下单确认弹窗（用户 2026-09-20 定）。
 *
 * 把这一单到底要做什么摊开给用户看一遍再提交：方向、类型、价格、数量、这一侧的预估。
 * 数字都用前面已经算好的那份（前端预估 + 服务端 preview），这里不再算一遍。
 */
export function ConfirmOrderDialog({
  open,
  onOpenChange,
  side,
  spec,
  values,
  positionMode,
  leverageNum,
  marginMode,
  preview,
  estimatePrice,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: OrderSide;
  spec: SymbolSpec;
  values: OrderFormValues;
  positionMode: PositionMode;
  leverageNum: number | null;
  marginMode: MarginMode | null;
  preview: OrderPreview | null;
  /** 限价用委托价、市价用标记价；没有行情时为 null */
  estimatePrice: string | null;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const buy = side === "BUY";
  const typeLabel =
    values.tab === "MARKET"
      ? "市价"
      : values.tab === "LIMIT"
        ? "限价"
        : `条件委托（触发后${values.conditionalExec === "MARKET" ? "市价" : "限价"}）`;
  const openCloseLabel = positionMode === "HEDGE" ? (values.openClose === "OPEN" ? "开仓" : "平仓") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[360px] gap-4 rounded-[10px] border bg-elevated p-6 ring-0 sm:max-w-[360px]">
        <DialogTitle className="flex items-center gap-2 font-bold text-[15px] text-foreground">
          确认下单
          <span className={cn("rounded-[3px] px-1.5 py-0.5 text-[11px] text-white", buy ? "bg-up" : "bg-down")}>
            {buy ? "买入 / 做多" : "卖出 / 做空"}
          </span>
        </DialogTitle>

        <div className="flex flex-col gap-1.5 rounded-[6px] bg-background p-3 text-[11px]">
          <Line label="合约" value={`${spec.symbol} 永续`} />
          <Line
            label="模式"
            value={[marginMode === "ISOLATED" ? "逐仓" : "全仓", leverageNum ? `${leverageNum}x` : null, openCloseLabel]
              .filter(Boolean)
              .join(" · ")}
          />
          <Line label="类型" value={typeLabel} />
          {values.tab === "CONDITIONAL" && (
            <Line
              label="触发条件"
              value={`${values.workingType === "MARK_PRICE" ? "标记价" : "最新价"} ${formatPrice(values.triggerPrice, spec)}`}
            />
          )}
          <Line label="价格" value={values.tab === "MARKET" ? "市价" : formatPrice(values.price, spec)} />
          <Line label="数量" value={`${formatQty(values.qty, spec)} ${spec.baseAsset}`} />
          {values.reduceOnly && <Line label="选项" value="只减仓" />}
          {values.tab !== "MARKET" && <Line label="生效时间" value={values.timeInForce} />}
        </div>

        <div className="flex flex-col gap-1.5 rounded-[6px] bg-background p-3 text-[11px]">
          <Line label="预估成本" value={preview?.cost ? `${formatUsdt(preview.cost)} USDT` : PLACEHOLDER} />
          <Line
            label="成交后强平价"
            value={preview?.liquidationPrice ? formatPrice(preview.liquidationPrice, spec) : PLACEHOLDER}
          />
        </div>

        {values.tab === "MARKET" && (
          <p className="text-[11px] text-muted-foreground leading-[16.5px]">
            市价单按盘口逐档吃单，成交价可能和当前价{estimatePrice ? ` ${formatPrice(estimatePrice, spec)}` : ""}
            有差距； 吃穿可见 20 档会被拒单，不会硬成交。
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={submitting}
            onClick={onConfirm}
            className={cn("text-white", buy ? "bg-up hover:bg-up/90" : "bg-down hover:bg-down/90")}
          >
            {submitting ? "提交中…" : "确认下单"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-mono text-foreground">{value}</span>
    </div>
  );
}
