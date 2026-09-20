"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { memo } from "react";

import { formatPrice, formatQty } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";

import type { BookSide, BookRow as Row } from "../../_lib/aggregate-book";

/**
 * 盘口一行（Figma 4:5092）：价格 · 数量 · 累计，右侧一条按累计量长短的背景条。
 *
 * memo + 价格做 key：一帧只重渲染数量变了的那几行。
 * 背景条宽度走 CSS 变量，不每次生成新的 style 对象（05 第 9 节）。
 */
/**
 * 一行的高度（px）。order-book.tsx 要用它算「这块高度能放下几整行」，
 * 所以必须导出——两边各写一份迟早对不上（2026-09-20）。
 */
export const BOOK_ROW_HEIGHT = 20.5;

export const BookRow = memo(function BookRow({
  row,
  side,
  spec,
  onPickPrice,
  onPickQty,
}: {
  row: Row;
  side: BookSide;
  spec: SymbolSpec;
  onPickPrice: (price: string) => void;
  onPickQty: (qty: string) => void;
}) {
  return (
    <div className="relative h-[20.5px] w-full shrink-0 cursor-pointer text-[11px] leading-[16.5px] hover:bg-elevated">
      <div
        className={cn("absolute inset-y-0 right-0", side === "bid" ? "bg-up/9" : "bg-down/9")}
        style={{ width: `${row.percentNum}%` }}
      />
      {/* 点价格填价格、点数量填累计量（08 T-04）；整行用两个按钮分区，键盘也能用 */}
      <button
        type="button"
        onClick={() => onPickPrice(row.price)}
        className={cn("absolute top-[2px] left-3 font-mono", side === "bid" ? "text-up" : "text-down")}
      >
        {formatPrice(row.price, spec)}
      </button>
      <button
        type="button"
        onClick={() => onPickQty(row.cumulative)}
        className="absolute top-[2px] right-3 left-1/3 flex justify-between gap-3 font-mono text-muted-foreground"
      >
        <span className="flex-1 text-right">{formatQty(row.qty, spec)}</span>
        <span className="flex-1 text-right">{formatQty(row.cumulative, spec)}</span>
      </button>
    </div>
  );
});
