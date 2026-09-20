"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@binance-contract-trading-full-stack/ui/components/dropdown-menu";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { decimalsOf, formatDecimal } from "@/lib/format/number";
import type { BookLevel, SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";
import { useUiStore } from "@/stores/ui-store";

import { aggregateSide, type BookSide, stepOptions } from "../../_lib/aggregate-book";
import { useOrderFormStore } from "../../_stores/order-form-store";
import { BookMid } from "./book-mid";
import { BookRow } from "./book-row";
import { BookViewToggle } from "./book-view-toggle";

/** 合并到一侧只剩这么少行时，底部出提示 */
const MERGED_HINT_ROWS = 3;

/** T-04 盘口（Figma 4:5076）：卖盘 20 档（倒序）· 最新价 / 标记价 · 买盘 20 档 */
export function OrderBook({ spec }: { spec: SymbolSpec }) {
  const view = useUiStore((s) => s.bookView);
  const setView = useUiStore((s) => s.setBookView);
  const step = useUiStore((s) => s.bookStep[spec.symbol]) ?? spec.tickSize;
  const setStep = useUiStore((s) => s.setBookStep);
  const steps = useMemo(() => stepOptions(spec.tickSize), [spec.tickSize]);
  // 聚合到只剩几行时说明原因：我们只有 20 档，不是数据掉了（02 第九节失真点 #4）
  const [askRows, setAskRows] = useState(0);
  const [bidRows, setBidRows] = useState(0);
  const merged = step !== spec.tickSize && Math.min(askRows, bidRows) <= MERGED_HINT_ROWS;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="font-semibold text-[12px] text-foreground leading-[18px]">订单簿</span>
        <div className="flex items-center gap-1">
          <BookViewToggle view={view} onChange={setView} />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-0.5 rounded-[3px] px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-elevated">
              {formatDecimal(step, decimalsOf(step))}
              <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {steps.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => setStep(spec.symbol, option)}
                  className={cn("num justify-end font-mono text-[11px]", option === step && "text-brand")}
                >
                  {formatDecimal(option, decimalsOf(option))}
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
        {view !== "bids" && <BookSideRows spec={spec} side="ask" step={step} align="end" onRowCount={setAskRows} />}
        {/* 按币对重新挂载：新币对的价格不能和旧币对的上一笔比较着色 */}
        <BookMid key={spec.symbol} spec={spec} />
        {view !== "asks" && <BookSideRows spec={spec} side="bid" step={step} align="start" onRowCount={setBidRows} />}
      </div>

      {merged && (
        <p className="shrink-0 border-t px-3 py-1 text-[10px] text-muted-foreground leading-[15px]">
          本平台只用币安 20 档真实盘口撮合，精度放大后档位会合并成很少几行
        </p>
      )}
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
  onRowCount,
}: {
  spec: SymbolSpec;
  side: BookSide;
  step: string;
  align: "start" | "end";
  onRowCount: (count: number) => void;
}) {
  const levels = useMarketStore((s) => (side === "bid" ? s.books[spec.symbol]?.bids : s.books[spec.symbol]?.asks));
  const fillPrice = useOrderFormStore((s) => s.fillPrice);
  const fillQty = useOrderFormStore((s) => s.fillQty);
  const rows = useMemo(() => aggregateSide((levels ?? []) as BookLevel[], step, side), [levels, step, side]);
  const display = side === "ask" ? [...rows].reverse() : rows;

  useEffect(() => {
    onRowCount(rows.length);
  }, [rows.length, onRowCount]);

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
