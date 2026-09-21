"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { formatUsdt } from "@/lib/format/number";
import { liquidationPages } from "@/server-api-module/account/queries";
import type { Liquidation } from "@/server-api-module/account/types";
import type { SymbolSpec } from "@/server-api-module/market/types";

import { MARGIN_MODE_LABEL } from "../../_shared/labels";
import { priceText, qtyText } from "../_lib/format-cell";
import { PositionSideCell, TimeCell, UsdtCell } from "./cells";
import { type Column, HistoryTable } from "./history-table";

/**
 * O-05 强平记录。最后一列是「强平前保证金余额 / 维持保证金」——
 * 这两个数才是"为什么被平"的答案（前者跌破后者就触发），光看亏了多少说明不了问题。
 */
export function LiquidationsTab({
  symbol,
  specOf,
  emptyText,
}: {
  symbol?: string;
  specOf: (symbol: string) => SymbolSpec | undefined;
  emptyText: string;
}) {
  const query = useInfiniteQuery(liquidationPages(symbol));

  const columns: Column<Liquidation>[] = [
    { header: "时间", width: "168px", cell: (l) => <TimeCell ms={l.createdAt} /> },
    { header: "合约", width: "110px", cell: (l) => <span className="text-foreground">{l.symbol}</span> },
    { header: "方向", width: "72px", cell: (l) => <PositionSideCell side={l.positionSide} /> },
    {
      header: "模式",
      width: "64px",
      cell: (l) => <span className="text-muted-foreground">{MARGIN_MODE_LABEL[l.marginMode]}</span>,
    },
    {
      header: "数量",
      width: "minmax(90px,1fr)",
      align: "right",
      cell: (l) => <span className="font-mono">{qtyText(l.qty, specOf(l.symbol))}</span>,
    },
    {
      header: "开仓价",
      width: "minmax(100px,1fr)",
      align: "right",
      cell: (l) => <span className="font-mono">{priceText(l.entryPrice, specOf(l.symbol))}</span>,
    },
    {
      header: "强平标记价",
      width: "minmax(100px,1fr)",
      align: "right",
      cell: (l) => <span className="font-mono">{priceText(l.markPrice, specOf(l.symbol))}</span>,
    },
    {
      header: "已实现盈亏",
      width: "minmax(110px,1fr)",
      align: "right",
      cell: (l) => <UsdtCell value={l.realizedPnl} signed />,
    },
    {
      header: "清算费",
      width: "minmax(90px,1fr)",
      align: "right",
      cell: (l) => <UsdtCell value={l.liquidationFee} />,
    },
    {
      header: "强平前保证金 / 维持保证金",
      width: "minmax(200px,1.4fr)",
      align: "right",
      cell: (l) => (
        <span className="font-mono text-muted-foreground" title="保证金余额跌破维持保证金就触发强平">
          {formatUsdt(l.marginBalanceBefore)} / {formatUsdt(l.maintMarginAt)}
        </span>
      ),
    },
  ];

  return <HistoryTable query={query} columns={columns} emptyText={emptyText} />;
}
