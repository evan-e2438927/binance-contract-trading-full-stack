"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { formatRatioAsPercent } from "@/lib/format/number";
import { fundingPages } from "@/server-api-module/account/queries";
import type { FundingPayment } from "@/server-api-module/account/types";
import type { SymbolSpec } from "@/server-api-module/market/types";

import { priceText } from "../_lib/format-cell";
import { PositionSideCell, TimeCell, UsdtCell } from "./cells";
import { type Column, HistoryTable } from "./history-table";

/**
 * O-04 资金费：每 8 小时结算一次，多空互付。
 * 费率为正 = 多头付给空头，所以同一期里做多的金额为负、做空的为正。
 */
export function FundingTab({
  symbol,
  specOf,
  emptyText,
}: {
  symbol?: string;
  specOf: (symbol: string) => SymbolSpec | undefined;
  emptyText: string;
}) {
  const query = useInfiniteQuery(fundingPages(symbol));

  const columns: Column<FundingPayment>[] = [
    { header: "结算时间", width: "168px", cell: (f) => <TimeCell ms={f.settledAt} /> },
    { header: "合约", width: "110px", cell: (f) => <span className="text-foreground">{f.symbol}</span> },
    { header: "方向", width: "72px", cell: (f) => <PositionSideCell side={f.positionSide} /> },
    {
      header: "资金费率",
      width: "minmax(100px,1fr)",
      align: "right",
      // 费率是比例（0.0001 = 0.01%），币安界面按 4 位小数显示
      cell: (f) => (
        <span className="font-mono text-muted-foreground">{formatRatioAsPercent(f.fundingRate, { precision: 4 })}</span>
      ),
    },
    {
      header: "标记价",
      width: "minmax(100px,1fr)",
      align: "right",
      cell: (f) => <span className="font-mono">{priceText(f.markPrice, specOf(f.symbol))}</span>,
    },
    {
      header: "名义价值",
      width: "minmax(110px,1fr)",
      align: "right",
      // 结算基数：按标记价算的仓位名义价值，不是保证金
      cell: (f) => <UsdtCell value={f.notional} />,
    },
    {
      header: "收 / 付",
      width: "minmax(110px,1fr)",
      align: "right",
      cell: (f) => <UsdtCell value={f.amount} signed />,
    },
  ];

  return <HistoryTable query={query} columns={columns} emptyText={emptyText} />;
}
