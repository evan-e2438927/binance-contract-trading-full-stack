"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { fillsPages } from "@/server-api-module/account/queries";
import type { Fill } from "@/server-api-module/account/types";
import type { SymbolSpec } from "@/server-api-module/market/types";

import { FILL_ROLE_LABEL } from "../../_shared/labels";
import { priceText, qtyText } from "../_lib/format-cell";
import { SideCell, Tag, TimeCell, UsdtCell } from "./cells";
import { type Column, HistoryTable } from "./history-table";

/** O-02 成交记录：一张单子可能吃出好几笔成交，这里是逐笔 */
export function FillsTab({
  symbol,
  specOf,
  emptyText,
}: {
  symbol?: string;
  specOf: (symbol: string) => SymbolSpec | undefined;
  emptyText: string;
}) {
  const query = useInfiniteQuery(fillsPages(symbol));

  const columns: Column<Fill>[] = [
    { header: "时间", width: "168px", cell: (f) => <TimeCell ms={f.createdAt} /> },
    { header: "合约", width: "110px", cell: (f) => <span className="text-foreground">{f.symbol}</span> },
    {
      header: "方向",
      width: "104px",
      cell: (f) => (
        <>
          <SideCell side={f.side} />
          {f.isLiquidation && <Tag text="强平" tone="down" />}
        </>
      ),
    },
    {
      header: "成交价",
      width: "minmax(100px,1fr)",
      align: "right",
      cell: (f) => <span className="font-mono">{priceText(f.price, specOf(f.symbol))}</span>,
    },
    {
      header: "数量",
      width: "minmax(90px,1fr)",
      align: "right",
      cell: (f) => <span className="font-mono">{qtyText(f.qty, specOf(f.symbol))}</span>,
    },
    {
      header: "角色",
      width: "80px",
      align: "right",
      // Maker 是挂单被吃，Taker 是主动吃单；两者费率不同，这一列解释了手续费为什么是这个数
      cell: (f) => <span className="text-muted-foreground">{FILL_ROLE_LABEL[f.role]}</span>,
    },
    {
      header: "手续费",
      width: "minmax(90px,1fr)",
      align: "right",
      cell: (f) => <UsdtCell value={f.fee} />,
    },
    {
      header: "已实现盈亏",
      width: "minmax(110px,1fr)",
      align: "right",
      // 开仓成交这一项是 0（盈亏要平仓才算出来），不是算不出来，所以显示 0 不是 "--"
      cell: (f) => <UsdtCell value={f.realizedPnl} signed />,
    },
  ];

  return <HistoryTable query={query} columns={columns} emptyText={emptyText} />;
}
