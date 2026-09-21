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
import { RuleLink } from "@/components/rule-link";
import { useVisibleRows } from "@/hooks/use-visible-rows";
import { decimalsOf, formatDecimal } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";
import { useUiStore } from "@/stores/ui-store";

import { type BookSide, stepOptions } from "../../_lib/aggregate-book";
import { useOrderFormStore } from "../../_stores/order-form-store";
import { BookMid } from "./book-mid";
import { BOOK_ROW_HEIGHT, BookRow } from "./book-row";
import { BookViewToggle } from "./book-view-toggle";

/** 合并到一侧只剩这么少行时，底部出提示 */
// 聚合到 8 行以内就提示。BNBUSDT 这类 tick 0.01 的币对，精度选 0.1 只剩 5~6 行，
// 原来的阈值 3 够不到，用户看到的就是「莫名其妙少一截」（2026-09-20）
const MERGED_HINT_ROWS = 8;

/** T-04 盘口（Figma 4:5076）：卖盘 20 档（倒序）· 最新价 / 标记价 · 买盘 20 档 */
export function OrderBook({ spec }: { spec: SymbolSpec }) {
  const view = useUiStore((s) => s.bookView);
  const setView = useUiStore((s) => s.setBookView);
  const step = useUiStore((s) => s.bookStep[spec.symbol]) ?? spec.tickSize;
  const setStep = useUiStore((s) => s.setBookStep);
  const steps = useMemo(() => stepOptions(spec.tickSize), [spec.tickSize]);
  // 聚合到只剩几行时说明原因：界面拿到的是前 50 档，不是数据掉了（02 第九节失真点 #4）
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
          撮合用币安 1,000 档真实盘口，服务端按所选精度合并后推前 20 行；这个精度下盘口深度不够，只能合出这几行
          <RuleLink anchor="depth" label="盘口深度与市价单拒单" />
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
  // 2026-09-20 起服务端已经按精度聚合好了，这里不再自己合并（S03 讲义）。
  // book.step 和当前选的 step 不一致说明是切精度途中的旧数据，先不画，等新频道第一条
  const book = useMarketStore((s) => s.books[spec.symbol]);
  const fillPrice = useOrderFormStore((s) => s.fillPrice);
  const fillQty = useOrderFormStore((s) => s.fillQty);
  const rows = useMemo(() => {
    if (!book || book.step !== step) return [];
    return side === "bid" ? book.bids : book.asks;
  }, [book, step, side]);

  // ⚠️ 2026-09-20：只渲染**放得下的整行**。
  // 原来是把全部行都塞进 overflow-hidden 里，靠溢出截掉多的——行少时看不出来，
  // 服务端改成每侧推 20 行之后，边上永远露着半行，看着像坏了。
  // 截掉的永远是离成交价最远的那几档（卖盘从上、买盘从下），最优价始终贴着中间行。
  const { ref, visibleRows } = useVisibleRows(BOOK_ROW_HEIGHT);
  const display = useMemo(() => {
    if (visibleRows === null) return []; // 还没量到高度，先不画，避免闪一下
    return side === "ask" ? rows.slice(0, visibleRows).reverse() : rows.slice(0, visibleRows);
  }, [rows, side, visibleRows]);

  // 提示看的是**数据够不够**，不是窗口放不放得下，所以报 rows.length
  useEffect(() => {
    onRowCount(rows.length);
  }, [rows.length, onRowCount]);

  return (
    <div
      ref={ref}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", align === "end" ? "justify-end" : "justify-start")}
    >
      {display.map((row) => (
        <BookRow key={row.price} row={row} side={side} spec={spec} onPickPrice={fillPrice} onPickQty={fillQty} />
      ))}
    </div>
  );
}
