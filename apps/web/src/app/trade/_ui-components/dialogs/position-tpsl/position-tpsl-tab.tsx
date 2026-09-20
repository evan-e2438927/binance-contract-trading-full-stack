"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, formatUsdt, fromFixed } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import type { WorkingType } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { placeOrder } from "@/server-api-module/order/mutations";
import type { Position } from "@/server-api-module/position/types";

import {
  type PositionBasis,
  pnlAtTrigger,
  type TpslInputMode,
  triggerDirectionHint,
  triggerPriceOf,
} from "../../../_lib/tpsl-math";

/**
 * 仓位止盈止损 tab（Figma 4:1812）：整仓的止盈 / 止损各一条。
 *
 * 下的是 `closePosition: true` 的触发单（TAKE_PROFIT_MARKET / STOP_MARKET）——
 * 触发那一刻按当时的全部仓位平，不用现在锁定数量（币安也是这个语义）。
 * 两条可以只设一条；都填了就下两张单。
 */

const MODES: { value: TpslInputMode; label: string }[] = [
  { value: "PRICE", label: "价格" },
  { value: "PNL", label: "盈亏" },
  { value: "ROE", label: "回报率" },
];

export function PositionTpslTab({
  position,
  spec,
  basis,
  onDone,
}: {
  position: Position;
  spec: SymbolSpec;
  basis: PositionBasis;
  onDone: () => void;
}) {
  const [tp, setTp] = useState({
    value: "",
    mode: "PRICE" as TpslInputMode,
    workingType: "CONTRACT_PRICE" as WorkingType,
  });
  const [sl, setSl] = useState({
    value: "",
    mode: "PRICE" as TpslInputMode,
    workingType: "CONTRACT_PRICE" as WorkingType,
  });
  const [pending, setPending] = useState(false);

  const tpTrigger = triggerPriceOf(tp.value, tp.mode, basis, spec.tickSize);
  const slTrigger = triggerPriceOf(sl.value, sl.mode, basis, spec.tickSize);

  const submit = async () => {
    if (!tpTrigger && !slTrigger) return;
    setPending(true);
    try {
      // 平仓方向和持仓相反；closePosition 单不传数量
      const side = basis.isLong ? "SELL" : "BUY";
      if (tpTrigger) {
        await placeOrder({
          symbol: position.symbol,
          side,
          positionSide: position.positionSide,
          type: "TAKE_PROFIT_MARKET",
          stopPrice: tpTrigger,
          workingType: tp.workingType,
          closePosition: true,
        });
      }
      if (slTrigger) {
        await placeOrder({
          symbol: position.symbol,
          side,
          positionSide: position.positionSide,
          type: "STOP_MARKET",
          stopPrice: slTrigger,
          workingType: sl.workingType,
          closePosition: true,
        });
      }
      notify.success("仓位止盈止损已设置");
      onDone();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <TriggerField kind="TP" state={tp} onChange={setTp} trigger={tpTrigger} basis={basis} spec={spec} />
      <TriggerField kind="SL" state={sl} onChange={setSl} trigger={slTrigger} basis={basis} spec={spec} />

      <p className="text-[12px] text-muted-foreground leading-[18px]">
        触发后按<strong className="font-normal text-foreground">当时的全部仓位</strong>
        市价平仓；预估盈亏按触发价算，不含手续费， 实际成交价由盘口决定。
      </p>

      <Button
        disabled={pending || (!tpTrigger && !slTrigger)}
        onClick={submit}
        className="w-full py-3 font-bold text-[15px]"
      >
        确认
      </Button>
    </div>
  );
}

function TriggerField({
  kind,
  state,
  onChange,
  trigger,
  basis,
  spec,
}: {
  kind: "TP" | "SL";
  state: { value: string; mode: TpslInputMode; workingType: WorkingType };
  onChange: (next: { value: string; mode: TpslInputMode; workingType: WorkingType }) => void;
  trigger: string;
  basis: PositionBasis;
  spec: SymbolSpec;
}) {
  const pnl = trigger ? pnlAtTrigger(trigger, basis) : null;
  const hint = triggerDirectionHint(trigger, kind, basis);
  const unit = state.mode === "PRICE" ? spec.quoteAsset : state.mode === "PNL" ? "USDT" : "%";

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={cn("h-3.5 w-[3px] rounded-[2px]", kind === "TP" ? "bg-up" : "bg-down")} />
        <span className="font-semibold text-[13px] text-foreground leading-[19.5px]">
          {kind === "TP" ? "止盈" : "止损"}
        </span>
      </div>

      <div className="flex gap-2.5 pt-2.5">
        <div className="relative flex-1">
          <input
            inputMode="decimal"
            value={state.value}
            onChange={(e) => onChange({ ...state, value: e.target.value.replace(/[^\d.-]/g, "") })}
            placeholder={state.mode === "PRICE" ? "触发价" : state.mode === "PNL" ? "盈亏金额" : "回报率"}
            className="h-[41.5px] w-full rounded-[6px] border bg-background px-3 pr-20 font-mono text-[13px] text-foreground outline-none focus:border-brand"
          />
          <div className="-translate-y-1/2 absolute top-1/2 right-3 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{unit}</span>
            {/* 触发依据：最新价 / 标记价（设计稿里输入框内那个「最新 ▼」） */}
            <select
              value={state.workingType}
              onChange={(e) => onChange({ ...state, workingType: e.target.value as WorkingType })}
              aria-label={`${kind === "TP" ? "止盈" : "止损"}触发依据`}
              className="rounded-[4px] border bg-background px-1 py-0.5 text-[11px] text-muted-foreground outline-none"
            >
              <option value="CONTRACT_PRICE">最新</option>
              <option value="MARK_PRICE">标记</option>
            </select>
          </div>
        </div>
        <select
          value={state.mode}
          onChange={(e) => onChange({ ...state, mode: e.target.value as TpslInputMode, value: "" })}
          aria-label={`${kind === "TP" ? "止盈" : "止损"}输入方式`}
          className="h-[41.5px] w-[100px] rounded-[6px] border bg-background px-3 text-[13px] text-foreground outline-none"
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      {(trigger || hint) && (
        <p className={cn("pt-1.5 text-[11px] leading-[16.5px]", hint ? "text-brand" : "text-muted-foreground")}>
          {hint ??
            `触发价 ${formatPrice(trigger, spec)}，预估${pnl !== null && pnl < 0n ? "亏损" : "盈利"} ${
              pnl === null ? "--" : formatUsdt(fromFixed(pnl), { signed: true })
            } USDT`}
        </p>
      )}
    </div>
  );
}
