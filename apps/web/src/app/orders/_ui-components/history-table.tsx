"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Page } from "@/server-api-module/common/types";

/**
 * 五个 tab 共用的表格外壳（08 第 8 节「表格：表头、行、悬停、空状态、加载、加载更多」）。
 *
 * 每个 tab 只提供一份列定义，表头、状态、翻页都在这里，五张表长得一模一样。
 * 分页是服务端游标分页：点「加载更多」取下一页，不做页码——记录一直在增长，
 * 页码会在翻页期间错位（理由见 apps/server/src/http/pagination.ts 的注释）。
 */

export interface Column<T> {
  /** 表头文字，同时作为 React key */
  header: string;
  /** CSS grid 轨道宽度，如 "160px"、"minmax(90px,1fr)" */
  width: string;
  /** 数字列右对齐 */
  align?: "right";
  /** 这一格显示什么 */
  cell: (row: T) => ReactNode;
}

export function HistoryTable<T extends { id: string }>({
  query,
  columns,
  emptyText,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>, Error>;
  columns: Column<T>[];
  emptyText: string;
}) {
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const template = columns.map((column) => column.width).join(" ");

  if (query.isPending) return <Notice>加载中…</Notice>;

  if (query.isError) {
    return (
      <Notice>
        {/* 服务端的错误原因已经是中文，原样显示（M10 通用规则第 3 条） */}
        <p className="text-down">{query.error.message}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-3 rounded-[4px] border px-3 py-1 text-[12px] text-muted-foreground hover:border-brand/60 hover:text-brand"
        >
          重试
        </button>
      </Notice>
    );
  }

  if (rows.length === 0) {
    return (
      <Notice>
        <p>{emptyText}</p>
        <Link
          href="/trade"
          className="mt-3 inline-block rounded-[4px] bg-brand px-4 py-1.5 font-bold text-[12px] text-black"
        >
          去交易
        </Link>
      </Notice>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="num min-w-max">
        <div
          className="sticky top-0 grid items-center gap-x-4 border-b bg-surface px-4 py-2.5 text-[11px] text-muted-foreground"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((column) => (
            <span key={column.header} className={column.align === "right" ? "text-right" : undefined}>
              {column.header}
            </span>
          ))}
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="grid items-center gap-x-4 border-b px-4 py-2.5 text-[12px] last:border-b-0 hover:bg-elevated/50"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((column) => (
              <div key={column.header} className={cn("truncate", column.align === "right" && "text-right")}>
                {column.cell(row)}
              </div>
            ))}
          </div>
        ))}

        <LoadMore query={query} count={rows.length} />
      </div>
    </div>
  );
}

function LoadMore<T>({ query, count }: { query: UseInfiniteQueryResult<InfiniteData<Page<T>>, Error>; count: number }) {
  if (!query.hasNextPage) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">共 {count} 条，没有更多了</p>;
  }
  return (
    <div className="py-4 text-center">
      <button
        type="button"
        disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
        className="rounded-[4px] border px-4 py-1.5 text-[12px] text-muted-foreground hover:border-brand/60 hover:text-brand disabled:opacity-50"
      >
        {query.isFetchingNextPage ? "加载中…" : "加载更多"}
      </button>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-[12px] text-muted-foreground">{children}</div>
  );
}
