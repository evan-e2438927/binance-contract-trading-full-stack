"use client";

import { mul, parse } from "@binance-contract-trading-full-stack/shared";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { DirectionText } from "@/components/direction-text";
import { formatPrice, formatQty, formatRatioAsPercent, formatUsdt, fromFixed, PLACEHOLDER } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import type { Position } from "@/server-api-module/position/types";
import { useAccountStore } from "@/stores/account-store";
import { useMarketStore } from "@/stores/market-store";

import { ClosePositionDialog, IsolatedMarginDialog } from "../dialogs/position-dialogs";
import { PositionTpslDialog } from "../dialogs/position-tpsl/position-tpsl-dialog";

/**
 * T-07 仓位表（设计稿 4:5628 的列）：数量 · 开仓均价 · 损益两平 · 标记价 · 强平价 · 保证金比率 ·
 * 保证金 · 盈亏/ROE · 预估资金费 · 操作。
 *
 * 表里的数全部用服务端给的（仓位推送每秒跟着标记价更新）。唯一前端算的是「预估资金费」：
 * 名义价值 × 当期资金费率，只依赖行情，不依赖账户全局状态。
 */

const COLS =
  "grid grid-cols-[minmax(150px,1.3fr)_repeat(8,minmax(88px,1fr))_minmax(140px,1.2fr)] items-center gap-x-3 px-3";

export function PositionsTable({
  positions,
  specOf,
}: {
  positions: Position[];
  specOf: (symbol: string) => SymbolSpec | undefined;
}) {
  if (positions.length === 0) {
    return <p className="py-10 text-center text-[12px] text-muted-foreground">当前没有持仓</p>;
  }
  return (
    <div className="num min-w-[1100px]">
      <div className={cn(COLS, "sticky top-0 border-b bg-surface py-2 text-[11px] text-muted-foreground")}>
        <span>合约</span>
        <span className="text-right">数量</span>
        <span className="text-right">开仓均价</span>
        <span className="text-right">损益两平</span>
        <span className="text-right">标记价</span>
        <span className="text-right">强平价</span>
        <span className="text-right">保证金比率</span>
        <span className="text-right">保证金</span>
        <span className="text-right">盈亏 / ROE</span>
        <span className="text-right">操作</span>
      </div>
      {positions.map((position) => (
        <PositionRow
          key={`${position.symbol}-${position.positionSide}`}
          position={position}
          spec={specOf(position.symbol)}
        />
      ))}
    </div>
  );
}

function PositionRow({ position, spec }: { position: Position; spec: SymbolSpec | undefined }) {
  const [dialog, setDialog] = useState<"close" | "margin" | "tpsl" | null>(null);
  const fundingRate = useMarketStore((s) => s.tickers[position.symbol]?.fundingRate) ?? null;
  if (!spec) return null;

  const amt = parse(position.positionAmt);
  const isLong = amt > 0n;
  const absQty = fromFixed(amt < 0n ? -amt : amt);
  // 预估资金费 = 名义价值 × 当期资金费率（收为正、付为负；只依赖行情，前端可以算）
  const estimatedFunding =
    position.notional && fundingRate ? fromFixed(mul(parse(position.notional), parse(fundingRate))) : null;

  return (
    <div className={cn(COLS, "border-b py-2.5 text-[12px] last:border-b-0 hover:bg-elevated/50")}>
      <div className="flex items-center gap-2">
        <span className={cn("h-7 w-[3px] rounded-full", isLong ? "bg-up" : "bg-down")} />
        <div>
          <div className="font-semibold text-foreground">{position.symbol}</div>
          <div className="text-[10px] text-muted-foreground">
            {position.marginMode === "CROSS" ? "全仓" : "逐仓"} {position.leverage}x
          </div>
        </div>
      </div>
      <span className={cn("text-right font-mono", isLong ? "text-up" : "text-down")}>
        {isLong ? "" : "-"}
        {formatQty(absQty, spec)}
      </span>
      <span className="text-right font-mono text-foreground">{formatPrice(position.entryPrice, spec)}</span>
      <span className="text-right font-mono text-foreground" title="含手续费的成本价，价格到这里不赚不赔（不含资金费）">
        {position.breakEvenPrice ? formatPrice(position.breakEvenPrice, spec) : PLACEHOLDER}
      </span>
      <span className="text-right font-mono text-foreground">
        {position.markPrice ? formatPrice(position.markPrice, spec) : PLACEHOLDER}
      </span>
      <span className="text-right font-mono text-down">
        {position.liquidationPrice ? formatPrice(position.liquidationPrice, spec) : PLACEHOLDER}
      </span>
      <span className="text-right font-mono text-muted-foreground">
        {formatRatioAsPercent(position.marginRatio, { signed: false })}
      </span>
      <span className="flex items-center justify-end gap-1 text-right font-mono text-foreground">
        {position.marginMode === "ISOLATED" ? (
          <>
            {formatUsdt(position.isolatedMargin)}
            <button
              type="button"
              aria-label="调整逐仓保证金"
              onClick={() => setDialog("margin")}
              className="text-muted-foreground hover:text-foreground"
            >
              <PencilIcon className="size-3" />
            </button>
          </>
        ) : (
          formatUsdt(position.initialMargin)
        )}
      </span>
      <span className="text-right font-mono">
        <DirectionText value={position.unrealizedPnl} className="block">
          {formatUsdt(position.unrealizedPnl, { signed: true })}
        </DirectionText>
        <DirectionText value={position.roe} className="block text-[10px]">
          {formatRatioAsPercent(position.roe)}
        </DirectionText>
      </span>
      <div className="flex items-center justify-end gap-2">
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title="按当前资金费率和名义价值估算，实际以结算时为准"
        >
          {estimatedFunding ? formatUsdt(estimatedFunding, { signed: true }) : PLACEHOLDER}
        </span>
        <button
          type="button"
          onClick={() => setDialog("close")}
          className="rounded-[4px] border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand/60 hover:text-foreground"
        >
          平仓
        </button>
        <button
          type="button"
          onClick={() => setDialog("tpsl")}
          className="rounded-[4px] border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand/60 hover:text-foreground"
        >
          止盈/损
        </button>
      </div>

      {dialog === "close" && (
        <ClosePositionDialog
          open
          onOpenChange={(open) => setDialog(open ? "close" : null)}
          position={position}
          spec={spec}
        />
      )}
      {dialog === "tpsl" && (
        <PositionTpslDialog
          open
          onOpenChange={(open) => setDialog(open ? "tpsl" : null)}
          position={position}
          spec={spec}
        />
      )}
      {dialog === "margin" && (
        <IsolatedMarginDialog open onOpenChange={(open) => setDialog(open ? "margin" : null)} position={position} />
      )}
    </div>
  );
}

/** 表头右侧的「一键全部市价平仓」用得到：当前账户有没有仓位 */
export function usePositionCount(): number {
  return useAccountStore((s) => s.positions.length);
}
