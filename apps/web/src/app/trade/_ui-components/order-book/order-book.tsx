"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@binance-contract-trading-full-stack/ui/components/dropdown-menu";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";

import type { BookLevel, SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";
import { useUiStore } from "@/stores/ui-store";

import { aggregateSide, type BookSide, stepOptions } from "../../_lib/aggregate-book";
import { useOrderFormStore } from "../../_stores/order-form-store";
import { BookMid } from "./book-mid";
import { BookRow } from "./book-row";
import { BookViewToggle } from "./book-view-toggle";

/** T-04 盘口（Figma 4:5076）：卖盘 20 档（倒序）· 最新价 / 标记价 · 买盘 20 档 */
export function OrderBook({ spec }: { spec: SymbolSpec }) {
  const view = useUiStore((s) => s.bookView);
  const setView = useUiStore((s) => s.setBookView);
  const step = useUiStore((s) => s.bookStep[spec.symbol]) ?? spec.tickSize;
  const setStep = useUiStore((s) => s.setBookStep);
  const steps = useMemo(() => stepOptions(spec.tickSize), [spec.tickSize]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="font-semibold text-[12px] text-foreground leading-[18px]">订单簿</span>
        <div className="flex items-center gap-1">
          <BookViewToggle view={view} onChange={setView} />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-0.5 rounded-[3px] px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-elevated">
              {step}
              <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {steps.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => setStep(spec.symbol, option)}
                  className={cn("num justify-end font-mono text-[11px]", option === step && "text-brand")}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex shrink-0 items-center border-b px-3 py-1 text-[11px] text-muted-foreground leading-[16.5px]">
        <span className="flex-1">价格({spec.quoteAsset})</span>
        <span className="flex-1 text-right">数量({spec.baseAsset})</span>
        <span className="flex-1 text-right">累计</span>
      </div>

      <div className="num flex min-h-0 flex-1 flex-col">
        {view !== "bids" && <BookSideRows spec={spec} side="ask" step={step} align="end" />}
        <BookMid spec={spec} />
        {view !== "asks" && <BookSideRows spec={spec} side="bid" step={step} align="start" />}
      </div>
    </div>
  );
}

/**
 * 一侧的档位。卖盘倒序显示（最低卖价贴着中间行），所以 asks 要反过来，
 * 而且高度不够时要贴着底部（align=end）——先被截掉的是离成交价最远的那几档。
 */
function BookSideRows({
  spec,
  side,
  step,
  align,
}: {
  spec: SymbolSpec;
  side: BookSide;
  step: string;
  align: "start" | "end";
}) {
  const levels = useMarketStore((s) => (side === "bid" ? s.books[spec.symbol]?.bids : s.books[spec.symbol]?.asks));
  const fillPrice = useOrderFormStore((s) => s.fillPrice);
  const fillQty = useOrderFormStore((s) => s.fillQty);
  const rows = useMemo(() => aggregateSide((levels ?? []) as BookLevel[], step, side), [levels, step, side]);
  const display = side === "ask" ? [...rows].reverse() : rows;

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", align === "end" ? "justify-end" : "justify-start")}
    >
      {display.map((row) => (
        <BookRow key={row.price} row={row} side={side} spec={spec} onPickPrice={fillPrice} onPickQty={fillQty} />
      ))}
    </div>
  );
}
