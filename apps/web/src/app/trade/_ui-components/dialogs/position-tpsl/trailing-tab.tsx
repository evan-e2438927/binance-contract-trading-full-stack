"use client";

import { parse } from "@binance-contract-trading-full-stack/shared";
import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, fromFixed, PLACEHOLDER } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import type { WorkingType } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { placeOrder } from "@/server-api-module/order/mutations";
import type { Position } from "@/server-api-module/position/types";
import { useMarketStore } from "@/stores/market-store";

import { floorToLot, lotOf } from "../../../_lib/order-validate";
import {
  activationPriceError,
  CALLBACK_RATE_PRESETS,
  callbackRateError,
  stopLineFrom,
} from "../../../_lib/trailing-math";

/**
 * 跟踪委托 tab（M08b / 第 15 讲）。
 *
 * 和固定触发价的止盈止损不一样：这张单的止损线**跟着价格走**。
 * 价格每往有利方向走一步，线就往上（多头）或往下（空头）挪一步；
 * 从最有利处回撤够 callbackRate 才触发，按市价平。
 *
 * 币安不允许跟踪委托用 closePosition，所以这里必须锁定数量——默认填满当前仓位。
 */
export function TrailingTab({
  position,
  spec,
  isLong,
  onDone,
}: {
  position: Position;
  spec: SymbolSpec;
  isLong: boolean;
  onDone: () => void;
}) {
  const positionQty = position.positionAmt.replace("-", "");
  const [rate, setRate] = useState("1");
  const [activation, setActivation] = useState("");
  const [qty, setQty] = useState(positionQty);
  const [workingType, setWorkingType] = useState<WorkingType>("CONTRACT_PRICE");
  const [pending, setPending] = useState(false);

  const ticker = useMarketStore((s) => s.tickers[position.symbol]);
  // 跟哪个价，预估就用哪个价——两者不一致会让人以为算错了
  const current = (workingType === "MARK_PRICE" ? ticker?.markPrice : ticker?.lastPrice) ?? null;
  // 平仓方向和持仓相反：多头用卖单跟最高价，空头用买单跟最低价
  const side = isLong ? "SELL" : "BUY";

  const rateError = callbackRateError(rate);
  const activationErr = activationPriceError(activation, current, side);
  // 跟踪委托触发后按市价成交，数量规则用 MARKET_LOT_SIZE 那一组；向下对齐到合法数量
  const lot = lotOf(spec, true);
  const qtyNum = /^\d+(\.\d+)?$/.test(qty.trim()) ? fromFixed(floorToLot(parse(qty), lot)) : null;
  const qtyError = qtyNum === null || parse(qtyNum) <= 0n ? "请填一个不小于最小下单量的数量" : null;
  // 激活价填了就从激活价开始算线，没填就是"从现在开始跟"
  const base = activation.trim() !== "" && activationErr === null ? activation : current;
  const stopLine = base === null ? null : stopLineFrom(base, rate, side);
  const blocked = rateError !== null || activationErr !== null || qtyError !== null;

  const submit = async () => {
    if (blocked || qtyNum === null) return;
    setPending(true);
    try {
      await placeOrder({
        symbol: position.symbol,
        side,
        positionSide: position.positionSide,
        type: "TRAILING_STOP_MARKET",
        callbackRate: rate,
        ...(activation.trim() === "" ? {} : { activationPrice: activation }),
        workingType,
        qty: qtyNum,
        // 双向模式不能传 reduceOnly（positionSide 已经说明是平仓方向）
        ...(position.positionSide === "BOTH" ? { reduceOnly: true } : {}),
      });
      notify.success("跟踪委托已挂出");
      onDone();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="回调率" error={rateError}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              aria-label="回调率"
              className="w-full rounded-[6px] border bg-background px-3 py-2 pr-8 text-[13px] outline-none focus:border-brand/60"
            />
            <span className="-translate-y-1/2 absolute top-1/2 right-3 text-[12px] text-muted-foreground">%</span>
          </div>
          {CALLBACK_RATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setRate(preset)}
              className={cn(
                "rounded-[4px] border px-2 py-1 text-[11px] transition-colors",
                rate === preset ? "border-brand text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {preset}%
            </button>
          ))}
        </div>
      </Field>

      <Field label="激活价（不填 = 从现在开始跟）" error={activationErr}>
        <div className="flex items-center gap-2">
          <input
            value={activation}
            onChange={(e) => setActivation(e.target.value)}
            inputMode="decimal"
            placeholder={current ? formatPrice(current, spec) : "可不填"}
            aria-label="激活价"
            className="flex-1 rounded-[6px] border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand/60"
          />
          <button
            type="button"
            onClick={() => setActivation(current ? formatPrice(current, spec).replace(/,/g, "") : "")}
            className="rounded-[4px] border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            最新
          </button>
        </div>
      </Field>

      <Field label="数量" error={qtyError}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              aria-label="数量"
              className="w-full rounded-[6px] border bg-background px-3 py-2 pr-12 text-[13px] outline-none focus:border-brand/60"
            />
            <span className="-translate-y-1/2 absolute top-1/2 right-3 text-[12px] text-muted-foreground">
              {spec.baseAsset}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setQty(positionQty)}
            className="rounded-[4px] border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            全仓位
          </button>
        </div>
      </Field>

      <Field label="触发依据">
        <div className="flex gap-2">
          {(["CONTRACT_PRICE", "MARK_PRICE"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWorkingType(option)}
              className={cn(
                "flex-1 rounded-[6px] border py-2 text-[12px] transition-colors",
                workingType === option ? "border-brand text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "CONTRACT_PRICE" ? "最新价" : "标记价"}
            </button>
          ))}
        </div>
      </Field>

      <div className="rounded-[6px] bg-background px-3 py-2.5 text-[12px] leading-[19px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">现在的{workingType === "MARK_PRICE" ? "标记价" : "最新价"}</span>
          <span className="num font-mono text-foreground">{current ? formatPrice(current, spec) : PLACEHOLDER}</span>
        </div>
        <div className="flex justify-between pt-1">
          <span className="text-muted-foreground">按现在算，触发线在</span>
          <span className="num font-mono text-foreground">{stopLine ? formatPrice(stopLine, spec) : PLACEHOLDER}</span>
        </div>
        <p className="pt-2 text-muted-foreground">
          {isLong ? "价格越涨，触发线跟着往上抬" : "价格越跌，触发线跟着往下压"}； 从最{isLong ? "高" : "低"}处回撤{" "}
          {rateError ? "—" : `${rate}%`} 就按市价平仓。
          <strong className="font-normal text-foreground">线只会往有利方向挪，不会退回去。</strong>
        </p>
      </div>

      <Button disabled={pending || blocked} onClick={submit} className="w-full py-3 font-bold text-[15px]">
        确认
      </Button>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-[11px] text-down">{error}</span>}
    </div>
  );
}
