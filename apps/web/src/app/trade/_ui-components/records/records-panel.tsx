"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, SIDE_LABEL } from "@/app/_shared/labels";
import { useSymbols } from "@/hooks/use-symbols";
import { formatPrice, formatQty, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import { formatDateTime } from "@/lib/format/time";
import { fillsQuery, orderHistoryQuery } from "@/server-api-module/account/queries";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { CancelAllDialog } from "../dialogs/position-dialogs";
import { OpenOrdersTable } from "./open-orders-table";
import { PositionsTable } from "./positions-table";

/**
 * T-07 仓位 / 委托表格区（设计稿 4:5604）：持仓 · 当前委托 · 历史委托 · 历史成交，
 * 右侧「只看当前币对」开关（08 T-07）。
 *
 * 仓位和当前委托来自 account-store（REST 首屏 + WS 推送）；两个历史 tab 走 React Query，
 * 只取最近 20 条，底部「查看全部」跳 /orders。
 */

type Tab = "positions" | "openOrders" | "orderHistory" | "fills";

export function RecordsPanel({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<Tab>("positions");
  const [onlyThis, setOnlyThis] = useState(true);
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);
  const positions = useAccountStore((s) => s.positions);
  const openOrders = useAccountStore((s) => s.openOrders);
  const { data: symbols } = useSymbols();
  const specOf = (name: string): SymbolSpec | undefined => symbols?.find((s) => s.symbol === name);

  const visiblePositions = onlyThis ? positions.filter((p) => p.symbol === symbol) : positions;
  const visibleOrders = onlyThis ? openOrders.filter((o) => o.symbol === symbol) : openOrders;

  const tabs: { value: Tab; label: string }[] = [
    { value: "positions", label: `持仓 (${visiblePositions.length})` },
    { value: "openOrders", label: `当前委托 (${visibleOrders.length})` },
    { value: "orderHistory", label: "历史委托" },
    { value: "fills", label: "历史成交" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b px-3">
        <div className="flex">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-[12px] transition-colors",
                item.value === tab
                  ? "border-brand font-semibold text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyThis}
              onChange={(e) => setOnlyThis(e.target.checked)}
              className="accent-brand"
            />
            只看当前币对
          </label>
          {tab === "openOrders" && visibleOrders.length > 0 && (
            <button
              type="button"
              onClick={() => setCancelAllOpen(true)}
              className="rounded-[4px] border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-down/60 hover:text-down"
            >
              全部撤单
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {status !== "authenticated" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-[12px] text-muted-foreground">登录后查看仓位和委托</p>
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-[5px] bg-brand px-4 py-1.5 font-bold text-[12px] text-black"
            >
              登录 / 注册
            </button>
          </div>
        ) : tab === "positions" ? (
          <PositionsTable positions={visiblePositions} specOf={specOf} />
        ) : tab === "openOrders" ? (
          <OpenOrdersTable orders={visibleOrders} specOf={specOf} />
        ) : tab === "orderHistory" ? (
          <RecentOrderHistory symbol={onlyThis ? symbol : undefined} specOf={specOf} />
        ) : (
          <RecentFills symbol={onlyThis ? symbol : undefined} specOf={specOf} />
        )}
      </div>

      <CancelAllDialog
        open={cancelAllOpen}
        onOpenChange={setCancelAllOpen}
        symbol={symbol}
        count={visibleOrders.length}
      />
    </div>
  );
}

const HISTORY_LIMIT = 20;

function RecentOrderHistory({ symbol, specOf }: { symbol?: string; specOf: (s: string) => SymbolSpec | undefined }) {
  const { data, isPending } = useQuery(orderHistoryQuery({ symbol, limit: HISTORY_LIMIT }));
  if (isPending) return <Loading />;
  const rows = data?.items ?? [];
  if (rows.length === 0) return <Empty text="没有历史委托" />;

  return (
    <div className="num min-w-[900px]">
      <HistoryHead columns={["时间", "合约", "类型 / 方向", "价格", "成交均价", "数量 / 已成交", "状态"]} />
      {rows.map((order) => {
        const spec = specOf(order.symbol);
        return (
          <div key={order.id} className={cn(HISTORY_COLS, "border-b py-2 text-[12px]")}>
            <span className="font-mono text-[11px] text-muted-foreground">{formatDateTime(order.createdAt)}</span>
            <span className="text-foreground">{order.symbol}</span>
            <span className={order.side === "BUY" ? "text-up" : "text-down"}>
              {ORDER_TYPE_LABEL[order.type] ?? order.type} {SIDE_LABEL[order.side]}
            </span>
            <span className="text-right font-mono">
              {spec && order.price !== "0" ? formatPrice(order.price, spec) : "市价"}
            </span>
            <span className="text-right font-mono">
              {spec && order.avgPrice !== "0" ? formatPrice(order.avgPrice, spec) : PLACEHOLDER}
            </span>
            <span className="text-right font-mono">
              {spec ? `${formatQty(order.qty, spec)} / ${formatQty(order.executedQty, spec)}` : PLACEHOLDER}
            </span>
            <span className="text-right text-muted-foreground" title={order.rejectReason ?? undefined}>
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
        );
      })}
      <ViewAll tab="orders" />
    </div>
  );
}

function RecentFills({ symbol, specOf }: { symbol?: string; specOf: (s: string) => SymbolSpec | undefined }) {
  const { data, isPending } = useQuery(fillsQuery({ symbol, limit: HISTORY_LIMIT }));
  if (isPending) return <Loading />;
  const rows = data?.items ?? [];
  if (rows.length === 0) return <Empty text="没有成交记录" />;

  return (
    <div className="num min-w-[900px]">
      <HistoryHead columns={["时间", "合约", "方向", "价格", "数量", "角色", "手续费"]} />
      {rows.map((fill) => {
        const spec = specOf(fill.symbol);
        return (
          <div key={fill.id} className={cn(HISTORY_COLS, "border-b py-2 text-[12px]")}>
            <span className="font-mono text-[11px] text-muted-foreground">{formatDateTime(fill.createdAt)}</span>
            <span className="text-foreground">{fill.symbol}</span>
            <span className={fill.side === "BUY" ? "text-up" : "text-down"}>
              {SIDE_LABEL[fill.side]}
              {fill.isLiquidation && <span className="ml-1 text-[10px] text-down">强平</span>}
            </span>
            <span className="text-right font-mono">{spec ? formatPrice(fill.price, spec) : PLACEHOLDER}</span>
            <span className="text-right font-mono">{spec ? formatQty(fill.qty, spec) : PLACEHOLDER}</span>
            <span className="text-right text-muted-foreground">{fill.role === "MAKER" ? "Maker" : "Taker"}</span>
            <span className="text-right font-mono text-muted-foreground">{formatUsdt(fill.fee)}</span>
          </div>
        );
      })}
      <ViewAll tab="fills" />
    </div>
  );
}

const HISTORY_COLS = "grid grid-cols-[150px_110px_130px_repeat(4,minmax(90px,1fr))] items-center gap-x-3 px-3";

function HistoryHead({ columns }: { columns: string[] }) {
  return (
    <div className={cn(HISTORY_COLS, "sticky top-0 border-b bg-surface py-2 text-[11px] text-muted-foreground")}>
      {columns.map((column, index) => (
        <span key={column} className={index >= 3 ? "text-right" : undefined}>
          {column}
        </span>
      ))}
    </div>
  );
}

function ViewAll({ tab }: { tab: "orders" | "fills" }) {
  return (
    <div className="py-3 text-center">
      <Link href={{ pathname: "/orders", query: { tab } }} className="text-[12px] text-brand hover:opacity-80">
        查看全部 →
      </Link>
    </div>
  );
}

function Loading() {
  return <p className="py-10 text-center text-[12px] text-muted-foreground">加载中…</p>;
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-[12px] text-muted-foreground">{text}</p>;
}
