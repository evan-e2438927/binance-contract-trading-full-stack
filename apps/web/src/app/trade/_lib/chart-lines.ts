import { parse } from "@binance-contract-trading-full-stack/shared";

import { ORDER_TYPE_LABEL, SIDE_LABEL } from "@/app/_shared/labels";
import { formatPrice, formatQty, formatUsdt } from "@/lib/format/number";
import type { Decimal } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import type { Order } from "@/server-api-module/order/types";
import type { Position } from "@/server-api-module/position/types";

import { stopLineFrom } from "./trailing-math";

/**
 * M09 图上交易线：把「当前仓位 + 当前挂单」算成一组**想要画的线**。
 *
 * 纯函数，不碰图表库——难写的不是画线，是**增删改的对账**（哪条要新建、哪条只是改价、
 * 哪条该删掉）。把"想要什么"和"怎么画"分开，前者能单独测。
 *
 * `key` 是对账的依据：同一个 key 表示同一条线，价格变了就改价，不重建（重建会闪一下）。
 *
 * ⚠️ **线上没有按钮**。设计文档写的「线上直接平仓 / 撤单」要用 `createPositionLine` /
 * `createOrderLine`，而这两个接口在我们这份授权包里会直接抛
 * `createOrderLine is only available on Trading Platform`——它们属于 Trading Platform 版，
 * 我们拿到的是 Charting Library 版。所以这里退回到库自带的水平线（`createShape`）：
 * 价位和标签照画，按钮去表格里点。详见 M09 讲义。
 */

export type ChartLineKind = "position" | "liquidation" | "order";

export interface ChartLine {
  key: string;
  kind: ChartLineKind;
  /** 十进制字符串，画之前才转 number（见 toChartPrice） */
  price: Decimal;
  /** 线上的标签，一整句（水平线只有一个文字位，数量也写在里面） */
  label: string;
  /** 涨绿跌红，warn = 强平那种要警告的 */
  tone: "up" | "down" | "warn";
  /** 虚线：位置会自己动，或者不是一个钉死的价 */
  dashed: boolean;
}

/**
 * ⚠️ 展示边界：图表库的坐标只吃 number。
 * 金额一路都是 bigint / 字符串，只有交给图表库的这一步转 number，**不参与任何计算**
 * （和 tv-datafeed.ts 把 K 线转 number 是同一个理由）。
 */
export function toChartPrice(price: Decimal): number {
  return Number(price);
}

/** 当前币对上该画哪些线。顺序固定：仓位 → 强平 → 挂单 */
export function chartLines(symbol: string, positions: Position[], orders: Order[], spec: SymbolSpec): ChartLine[] {
  const lines: ChartLine[] = [];

  for (const position of positions) {
    if (position.symbol !== symbol) continue;
    const amt = parse(position.positionAmt);
    if (amt === 0n) continue;
    const isLong = amt > 0n;
    const qty = formatQty(position.positionAmt.replace("-", ""), spec);
    // 未实现盈亏算不出来（缺标记价）时不写 0，直接不提
    const pnl = position.unrealizedPnl === null ? "" : ` · ${formatUsdt(position.unrealizedPnl, { signed: true })}`;

    lines.push({
      key: `position:${position.symbol}:${position.positionSide}`,
      kind: "position",
      price: position.entryPrice,
      label: `${isLong ? "多" : "空"} ${qty} @ ${formatPrice(position.entryPrice, spec)}${pnl}`,
      tone: isLong ? "up" : "down",
      dashed: false,
    });

    // 强平价：服务端算的，前端不自己算。仓位小到钱包扛得住时服务端给 null
    if (position.liquidationPrice !== null) {
      lines.push({
        key: `liquidation:${position.symbol}:${position.positionSide}`,
        kind: "liquidation",
        price: position.liquidationPrice,
        label: `强平 ${formatPrice(position.liquidationPrice, spec)}`,
        tone: "warn",
        dashed: true,
      });
    }
  }

  for (const order of orders) {
    if (order.symbol !== symbol) continue;
    const line = orderLine(order, spec);
    if (line) lines.push(line);
  }

  return lines;
}

/** 一张挂单画在哪个价上、写什么。画不出来（缺价）就返回 null，不瞎画一条 */
function orderLine(order: Order, spec: SymbolSpec): ChartLine | null {
  const label = ORDER_TYPE_LABEL[order.type] ?? order.type;
  const side = SIDE_LABEL[order.side];
  const qty = order.closePosition ? "全部" : formatQty(order.qty, spec);
  const tone: ChartLine["tone"] = order.side === "BUY" ? "up" : "down";
  const base = { key: `order:${order.id}`, kind: "order" as const, tone };

  // 跟踪委托没有钉死的价，线的位置是"按最近一次拿到的跟踪价算出来的止损线"——
  // 服务端不推跟踪价（缺口 #53），所以这条线可能略旧，画成虚线并在标签里写明
  if (order.type === "TRAILING_STOP_MARKET") {
    if (order.trackedPrice === null || order.callbackRate === null) return null;
    const stop = stopLineFrom(order.trackedPrice, order.callbackRate, order.side);
    if (stop === null) return null;
    return {
      ...base,
      price: stop,
      label: `跟踪${side} ${qty} · 回调 ${order.callbackRate}%（会移动）`,
      dashed: true,
    };
  }

  // 条件单画在触发价上，普通限价单画在委托价上
  const price = order.stopPrice ?? order.price;
  if (price === null) return null;
  return {
    ...base,
    price,
    label: `${label}${side} ${qty} @ ${formatPrice(price, spec)}${order.reduceOnly ? " · 只减仓" : ""}`,
    dashed: order.stopPrice !== null,
  };
}
