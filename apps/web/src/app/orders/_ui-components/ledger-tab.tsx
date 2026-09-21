"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { PLACEHOLDER } from "@/lib/format/number";
import { ledgerPages } from "@/server-api-module/account/queries";
import type { LedgerEntry } from "@/server-api-module/account/types";
import type { LedgerType } from "@/server-api-module/common/types";

import { LEDGER_TYPE_LABEL } from "../../_shared/labels";
import { TimeCell, UsdtCell } from "./cells";
import { type Column, HistoryTable } from "./history-table";

/**
 * O-03 资金流水：钱包余额的每一次变动都在这儿，8 类（LEDGER_TYPE）。
 * 这是账目的唯一依据——「余额 == 流水之和」是这个项目的硬约束（CLAUDE.md 第 5 条），
 * 所以每行都带「变动后余额」，从上往下能一路对到当前余额。
 */
export function LedgerTab({ symbol, type, emptyText }: { symbol?: string; type?: LedgerType; emptyText: string }) {
  const query = useInfiniteQuery(ledgerPages(symbol, type));

  const columns: Column<LedgerEntry>[] = [
    { header: "时间", width: "168px", cell: (l) => <TimeCell ms={l.createdAt} /> },
    {
      header: "类型",
      width: "140px",
      cell: (l) => <span className="text-foreground">{LEDGER_TYPE_LABEL[l.type] ?? l.type}</span>,
    },
    {
      header: "合约",
      width: "110px",
      // 开户赠送、账户重置跟币对无关，服务端给 null
      cell: (l) => <span className="text-muted-foreground">{l.symbol ?? PLACEHOLDER}</span>,
    },
    {
      header: "金额",
      width: "minmax(120px,1fr)",
      align: "right",
      cell: (l) => <UsdtCell value={l.amount} signed />,
    },
    {
      header: "变动后余额",
      width: "minmax(120px,1fr)",
      align: "right",
      cell: (l) => <UsdtCell value={l.balanceAfter} />,
    },
  ];

  return <HistoryTable query={query} columns={columns} emptyText={emptyText} />;
}
