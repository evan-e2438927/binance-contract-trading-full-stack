"use client";

import { parse } from "@binance-contract-trading-full-stack/shared";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, PLACEHOLDER } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import type { Position } from "@/server-api-module/position/types";
import { useMarketStore } from "@/stores/market-store";

import type { PositionBasis } from "../../../_lib/tpsl-math";
import { PositionTpslTab } from "./position-tpsl-tab";
import { TpslOrdersTab } from "./tpsl-orders-tab";

/**
 * T-13 止盈止损弹窗（Figma 4:369 / 4:1812 / 4:3213），一个弹窗三个 tab：
 *
 * 1. 止盈/止损：给仓位挂**部分**止盈止损单（带数量），可以挂多条 → tpsl-orders-tab
 * 2. 仓位止盈止损：整仓的止盈 / 止损各一条（closePosition） → position-tpsl-tab
 * 3. 跟踪委托：引擎还不支持 TRAILING_STOP_MARKET，等第 15 讲（按钮禁用并说明）
 */

type Tab = "orders" | "position" | "trailing";

export function PositionTpslDialog({
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
  const [tab, setTab] = useState<Tab>("position");
  const [warningOpen, setWarningOpen] = useState(true);
  const markPrice = useMarketStore((s) => s.tickers[position.symbol]?.markPrice) ?? null;

  const amt = parse(position.positionAmt);
  const isLong = amt > 0n;
  const basis: PositionBasis = {
    entryPrice: position.entryPrice,
    qty: position.positionAmt.replace("-", ""),
    isLong,
    initialMargin: position.initialMargin,
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "orders", label: "止盈/止损" },
    { value: "position", label: "仓位止盈止损" },
    { value: "trailing", label: "跟踪委托" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px] gap-0 rounded-[12px] border bg-elevated p-0 ring-0 sm:max-w-[520px]">
        <div className="flex items-center justify-between px-6 pt-5">
          <DialogTitle className="font-bold text-[18px] text-foreground leading-[27px]">
            {tab === "orders" ? "止盈/止损" : tab === "position" ? "仓位止盈止损" : "跟踪委托"}
          </DialogTitle>
        </div>

        {/* 合约信息（设计稿 4:3100） */}
        <div className="flex flex-col gap-[7px] px-6 pt-3.5 text-[13px]">
          <InfoRow
            label="合约"
            value={`${position.symbol} 永续 / ${isLong ? "做多" : "做空"} ${position.leverage}x`}
            tone={isLong ? "up" : "down"}
          />
          <InfoRow label="开仓价格" value={`${formatPrice(position.entryPrice, spec)} USDT`} />
          <InfoRow label="标记价格" value={markPrice ? `${formatPrice(markPrice, spec)} USDT` : PLACEHOLDER} />
          <InfoRow
            label="预估强平价"
            value={position.liquidationPrice ? `${formatPrice(position.liquidationPrice, spec)} USDT` : PLACEHOLDER}
          />
        </div>

        {warningOpen && (
          <div className="mx-6 mt-3 flex items-start gap-2.5 rounded-[8px] border bg-white/4 px-3.5 py-2.5">
            <span className="text-[14px] text-muted-foreground leading-[21px]">ⓘ</span>
            <p className="flex-1 text-[12px] text-muted-foreground leading-[19.2px]">
              市场行情瞬息万变，将止损触发价设置为接近强平价可能会导致订单无法执行。
            </p>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setWarningOpen(false)}
              className="text-[16px] text-muted-foreground leading-6 hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}

        <div className="mt-3.5 flex border-b px-6">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                "border-b-2 px-2 py-2 text-[13px] transition-colors",
                item.value === tab
                  ? "border-brand font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="px-6 pt-4 pb-6">
          {tab === "position" && (
            <PositionTpslTab position={position} spec={spec} basis={basis} onDone={() => onOpenChange(false)} />
          )}
          {tab === "orders" && <TpslOrdersTab position={position} spec={spec} basis={basis} />}
          {tab === "trailing" && (
            <p className="py-10 text-center text-[12px] text-muted-foreground leading-[18px]">
              跟踪委托还没做：引擎暂不支持这种订单类型，正在单独一讲里补（第 15 讲）。
              <br />
              现在可以先用「仓位止盈止损」设固定触发价。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-start justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "num font-mono",
          tone === "up" ? "font-semibold text-up" : tone === "down" ? "font-semibold text-down" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
