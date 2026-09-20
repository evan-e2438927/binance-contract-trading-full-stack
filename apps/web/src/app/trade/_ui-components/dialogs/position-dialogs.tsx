"use client";

import { parse } from "@binance-contract-trading-full-stack/shared";
import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, formatQty, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { cancelAllOrders, placeOrder } from "@/server-api-module/order/mutations";
import { adjustIsolatedMargin, closePosition } from "@/server-api-module/position/mutations";
import type { Position } from "@/server-api-module/position/types";
import { useMarketStore } from "@/stores/market-store";

import { NumberField } from "../order-panel/fields";

/**
 * T-11 调整逐仓保证金 / T-12 平仓 / T-14 全部撤单（设计稿没画，功能按 08 做）。
 * 结果一律等 WS 推送刷新，不手动改 store。
 */

function Shell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[380px] gap-4 rounded-[10px] border bg-elevated p-6 ring-0 sm:max-w-[380px]">
        <DialogTitle className="font-bold text-[15px] text-foreground">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function useAction(onDone: () => void) {
  const [pending, setPending] = useState(false);
  const act = async (run: () => Promise<unknown>, successText: string) => {
    setPending(true);
    try {
      await run();
      notify.success(successText);
      onDone();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };
  return { pending, act };
}

/** T-12 平仓：市价平仓二次确认，或挂一张只减仓限价单 */
export function ClosePositionDialog({
  open,
  onOpenChange,
  position,
  spec,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position;
  spec: SymbolSpec;
}) {
  const markPrice = useMarketStore((s) => s.tickers[position.symbol]?.markPrice) ?? null;
  const lastPrice = useMarketStore((s) => s.tickers[position.symbol]?.lastPrice) ?? null;
  const [mode, setMode] = useState<"MARKET" | "LIMIT">("MARKET");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const { pending, act } = useAction(() => onOpenChange(false));

  const isLong = parse(position.positionAmt) > 0n;
  const absQty = parse(position.positionAmt) < 0n ? `-${position.positionAmt}`.replace("--", "") : position.positionAmt;
  const closeQty = qty.trim() || absQty.replace("-", "");

  const submit = () => {
    if (mode === "MARKET") {
      return act(() => closePosition(position.symbol, position.positionSide), "已按市价平仓");
    }
    // 限价平仓 = 反方向的只减仓限价单（单向模式用 reduceOnly，双向模式用 positionSide 表达）
    return act(
      () =>
        placeOrder({
          symbol: position.symbol,
          side: isLong ? "SELL" : "BUY",
          positionSide: position.positionSide,
          type: "LIMIT",
          timeInForce: "GTC",
          price,
          qty: closeQty,
          ...(position.positionSide === "BOTH" ? { reduceOnly: true } : {}),
        }),
      "限价平仓委托已提交",
    );
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="平仓">
      <div className="flex gap-2">
        {(["MARKET", "LIMIT"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "h-8 flex-1 rounded-[5px] border text-[12px]",
              mode === value ? "border-brand font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {value === "MARKET" ? "市价平仓" : "限价平仓"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 rounded-[6px] bg-background p-3 text-[11px]">
        <Line label="仓位" value={`${position.symbol} ${isLong ? "多头" : "空头"} ${formatQty(closeQty, spec)}`} />
        <Line label="标记价" value={markPrice ? formatPrice(markPrice, spec) : PLACEHOLDER} />
        <Line label="未实现盈亏" value={formatUsdt(position.unrealizedPnl, { signed: true })} />
      </div>

      {mode === "MARKET" ? (
        <p className="text-[11px] text-muted-foreground leading-[16.5px]">
          按当前盘口逐档吃单成交，成交价可能和标记价有差距。吃穿可见 20 档会被拒单，不会硬成交。
        </p>
      ) : (
        <>
          <NumberField
            label={`价格 (${spec.quoteAsset})`}
            unit={spec.quoteAsset}
            value={price}
            onChange={setPrice}
            action={
              lastPrice ? (
                <button type="button" className="text-[10px] text-brand" onClick={() => setPrice(lastPrice)}>
                  最新
                </button>
              ) : undefined
            }
          />
          <NumberField
            label={`数量 (${spec.baseAsset})`}
            unit={spec.baseAsset}
            value={qty}
            placeholder={absQty.replace("-", "")}
            onChange={setQty}
          />
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button disabled={pending || (mode === "LIMIT" && !price.trim())} onClick={submit}>
          确认
        </Button>
      </div>
    </Shell>
  );
}

/** T-11 调整逐仓保证金：增加 / 减少。减到会立刻强平时服务端会拒（MARGIN_WOULD_LIQUIDATE） */
export function IsolatedMarginDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position;
}) {
  const [type, setType] = useState<"ADD" | "REDUCE">("ADD");
  const [amount, setAmount] = useState("");
  const { pending, act } = useAction(() => onOpenChange(false));

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="调整逐仓保证金">
      <div className="flex gap-2">
        {(["ADD", "REDUCE"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={cn(
              "h-8 flex-1 rounded-[5px] border text-[12px]",
              type === value ? "border-brand font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {value === "ADD" ? "增加" : "减少"}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-[6px] bg-background p-3 text-[11px]">
        <Line label="当前逐仓保证金" value={`${formatUsdt(position.isolatedMargin)} USDT`} />
        <Line label="当前强平价" value={position.liquidationPrice ?? PLACEHOLDER} />
      </div>
      <NumberField label="金额 (USDT)" unit="USDT" value={amount} onChange={setAmount} />
      <p className="text-[11px] text-muted-foreground leading-[16.5px]">
        减少到会立刻触发强平时，服务端会拒绝这次调整并说明原因。
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          disabled={pending || !amount.trim()}
          onClick={() =>
            act(
              () =>
                adjustIsolatedMargin({ symbol: position.symbol, positionSide: position.positionSide, amount, type }),
              type === "ADD" ? "已增加逐仓保证金" : "已减少逐仓保证金",
            )
          }
        >
          确认
        </Button>
      </div>
    </Shell>
  );
}

/** T-14 全部撤单：显示将撤销的张数，二次确认 */
export function CancelAllDialog({
  open,
  onOpenChange,
  symbol,
  count,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  count: number;
}) {
  const { pending, act } = useAction(() => onOpenChange(false));

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="全部撤单">
      <p className="text-[12px] text-muted-foreground leading-[18px]">
        将撤销 {symbol} 的 {count} 张挂单（含未触发的条件单）。
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => act(() => cancelAllOrders(symbol), "已全部撤单")}
        >
          确认撤单
        </Button>
      </div>
    </Shell>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-mono text-foreground">{value}</span>
    </div>
  );
}
