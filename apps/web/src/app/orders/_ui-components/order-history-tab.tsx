"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { PLACEHOLDER } from "@/lib/format/number";
import { orderHistoryPages } from "@/server-api-module/account/queries";
import type { SymbolSpec } from "@/server-api-module/market/types";
import type { Order } from "@/server-api-module/order/types";

import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from "../../_shared/labels";
import { priceText, qtyText } from "../_lib/format-cell";
import { SideCell, Tag, TimeCell } from "./cells";
import { type Column, HistoryTable } from "./history-table";

/** O-01 历史委托：已经结束的单子（挂单中的在交易页「当前委托」，服务端按状态分开给） */
export function OrderHistoryTab({
  symbol,
  specOf,
  emptyText,
}: {
  symbol?: string;
  specOf: (symbol: string) => SymbolSpec | undefined;
  emptyText: string;
}) {
  const query = useInfiniteQuery(orderHistoryPages(symbol));

  const columns: Column<Order>[] = [
    { header: "时间", width: "168px", cell: (o) => <TimeCell ms={o.createdAt} /> },
    { header: "合约", width: "110px", cell: (o) => <span className="text-foreground">{o.symbol}</span> },
    {
      header: "类型",
      width: "112px",
      cell: (o) => (
        <>
          <span className="text-foreground">{ORDER_TYPE_LABEL[o.type] ?? o.type}</span>
          {o.reduceOnly && <Tag text="只减仓" />}
        </>
      ),
    },
    { header: "方向", width: "64px", cell: (o) => <SideCell side={o.side} /> },
    {
      header: "价格",
      width: "minmax(100px,1fr)",
      align: "right",
      // 市价单没有委托价（服务端给 null），别显示成 0
      cell: (o) => (
        <span className="font-mono">{o.price === null ? "市价" : priceText(o.price, specOf(o.symbol))}</span>
      ),
    },
    {
      header: "成交均价",
      width: "minmax(100px,1fr)",
      align: "right",
      // 一笔没成交的单子（撤单 / 拒单）均价是 "0"，那是"没有"，不是 0 元
      cell: (o) => (
        <span className="font-mono">{o.avgPrice === "0" ? PLACEHOLDER : priceText(o.avgPrice, specOf(o.symbol))}</span>
      ),
    },
    {
      header: "数量",
      width: "minmax(90px,1fr)",
      align: "right",
      // closePosition 单下单时不写数量，触发那一刻按当时的仓位现算
      cell: (o) => <span className="font-mono">{o.closePosition ? "全部仓位" : qtyText(o.qty, specOf(o.symbol))}</span>,
    },
    {
      header: "已成交",
      width: "minmax(90px,1fr)",
      align: "right",
      cell: (o) => <span className="font-mono">{qtyText(o.executedQty, specOf(o.symbol))}</span>,
    },
    {
      header: "状态",
      width: "88px",
      align: "right",
      cell: (o) => <span className="text-muted-foreground">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>,
    },
    {
      header: "原因",
      width: "minmax(180px,1.6fr)",
      // 服务端给的中文原因，原样显示；列窄了会截断，完整的放 title
      cell: (o) => (
        <span className="text-muted-foreground" title={o.rejectReason ?? undefined}>
          {o.rejectReason ?? PLACEHOLDER}
        </span>
      ),
    },
  ];

  return <HistoryTable query={query} columns={columns} emptyText={emptyText} />;
}
