"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, formatQty, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import { formatDateTime } from "@/lib/format/time";
import { notify } from "@/lib/toast/notify";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { cancelOrder } from "@/server-api-module/order/mutations";
import type { Order } from "@/server-api-module/order/types";

/**
 * T-07 当前委托表。★ 招牌列是「前方排队」：这个价位排在我前面还有多少量，
 * 超出可见 20 档时是估算值，显示 `≈` 并说明（08 T-07）。
 *
 * 撤单成功后不手动删行，等 WS order 推送。
 */

const COLS = "grid grid-cols-[minmax(140px,1.2fr)_repeat(7,minmax(86px,1fr))_80px] items-center gap-x-3 px-3";

const TYPE_LABEL: Record<string, string> = {
  LIMIT: "限价",
  MARKET: "市价",
  STOP: "止损限价",
  STOP_MARKET: "止损市价",
  TAKE_PROFIT: "止盈限价",
  TAKE_PROFIT_MARKET: "止盈市价",
  LIQUIDATION: "强平",
};

export function OpenOrdersTable({
  orders,
  specOf,
}: {
  orders: Order[];
  specOf: (symbol: string) => SymbolSpec | undefined;
}) {
  if (orders.length === 0) {
    return <p className="py-10 text-center text-[12px] text-muted-foreground">当前没有委托</p>;
  }
  return (
    <div className="num min-w-[1000px]">
      <div className={cn(COLS, "sticky top-0 border-b bg-surface py-2 text-[11px] text-muted-foreground")}>
        <span>时间 / 合约</span>
        <span>类型 / 方向</span>
        <span className="text-right">价格</span>
        <span className="text-right">数量 / 已成交</span>
        <span className="text-right">前方排队</span>
        <span className="text-right">触发条件</span>
        <span className="text-right">冻结保证金</span>
        <span className="text-right">状态</span>
        <span className="text-right">操作</span>
      </div>
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} spec={specOf(order.symbol)} />
      ))}
    </div>
  );
}

function OrderRow({ order, spec }: { order: Order; spec: SymbolSpec | undefined }) {
  const [pending, setPending] = useState(false);
  if (!spec) return null;

  const cancel = async () => {
    setPending(true);
    try {
      await cancelOrder(order.id);
      notify.success("已撤单");
      // 行由 WS order 推送删掉，这里不动 store
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  const isBuy = order.side === "BUY";
  const trigger = order.stopPrice
    ? `${order.workingType === "MARK_PRICE" ? "标记价" : "最新价"} ${formatPrice(order.stopPrice, spec)}`
    : PLACEHOLDER;

  return (
    <div className={cn(COLS, "border-b py-2.5 text-[12px] last:border-b-0 hover:bg-elevated/50")}>
      <div>
        <div className="font-mono text-[11px] text-muted-foreground">{formatDateTime(order.createdAt)}</div>
        <div className="font-semibold text-foreground">{order.symbol}</div>
      </div>
      <div>
        <span className="text-foreground">{TYPE_LABEL[order.type] ?? order.type}</span>
        <span className={cn("ml-1.5", isBuy ? "text-up" : "text-down")}>{isBuy ? "买入" : "卖出"}</span>
        {order.reduceOnly && (
          <span className="ml-1.5 rounded-[3px] bg-elevated px-1 text-[10px] text-muted-foreground">只减仓</span>
        )}
      </div>
      <span className="text-right font-mono text-foreground">
        {order.price === "0" || !order.price ? "市价" : formatPrice(order.price, spec)}
      </span>
      <span className="text-right font-mono text-foreground">
        {formatQty(order.qty, spec)} / {formatQty(order.executedQty, spec)}
      </span>
      <span
        className="text-right font-mono text-muted-foreground"
        title={order.queueEstimated ? "该价位超出可见 20 档，这是估算值" : undefined}
      >
        {order.queueAhead === null
          ? PLACEHOLDER
          : `${order.queueEstimated ? "≈" : ""}${formatQty(order.queueAhead, spec)}`}
      </span>
      <span className="text-right font-mono text-muted-foreground">{trigger}</span>
      <span className="text-right font-mono text-muted-foreground">{formatUsdt(order.frozenMargin)}</span>
      <span className="text-right text-muted-foreground">
        {order.status === "NEW" ? (order.stopPrice ? "等待触发" : "挂单中") : "部分成交"}
      </span>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="rounded-[4px] border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-down/60 hover:text-down disabled:opacity-50"
        >
          撤单
        </button>
      </div>
    </div>
  );
}
