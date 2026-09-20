import { div, type Fixed, mul, parse } from "@binance-contract-trading-full-stack/shared";

import { fromFixed } from "@/lib/format/number";

import { floorToTick } from "./order-validate";

/**
 * 止盈止损的换算（T-13，设计稿 4:1812 里「盈亏」那个下拉）。
 *
 * 用户可以按三种方式填：直接填触发价、填想赚 / 亏多少 USDT、填回报率。
 * 三者之间的换算只依赖仓位本身（开仓价、数量、方向、起始保证金），前端算得出来。
 *
 * 多头：盈亏 = (触发价 − 开仓价) × 数量
 * 空头：盈亏 = (开仓价 − 触发价) × 数量
 * 回报率 = 盈亏 ÷ 起始保证金（和仓位表的 ROE 同一个口径，服务端给的那个）
 *
 * ⚠️ 这里算的是**按触发价成交**的理想盈亏：不含手续费，也不保证真的能在触发价成交
 * （止损市价单触发后按盘口吃单）。界面上要说明这是预估。
 */

export type TpslInputMode = "PRICE" | "PNL" | "ROE";

export interface PositionBasis {
  /** 开仓均价 */
  entryPrice: string;
  /** 数量，正数 */
  qty: string;
  /** 多头 true */
  isLong: boolean;
  /** 起始保证金，算回报率用；服务端算不出来时为 null */
  initialMargin: string | null;
}

/** 触发价 → 盈亏（USDT）。数量为 0 时返回 null */
export function pnlAtTrigger(triggerPrice: string, position: PositionBasis): Fixed | null {
  if (!triggerPrice.trim() || !position.qty.trim()) return null;
  const qty = parse(position.qty);
  if (qty <= 0n) return null;
  const diff = position.isLong
    ? parse(triggerPrice) - parse(position.entryPrice)
    : parse(position.entryPrice) - parse(triggerPrice);
  return mul(diff, qty);
}

/** 盈亏（USDT）→ 触发价，按 tickSize 向下对齐（委托价必须是整数倍） */
export function triggerAtPnl(pnl: string, position: PositionBasis, tickSize: string): string {
  if (!pnl.trim() || !position.qty.trim()) return "";
  const qty = parse(position.qty);
  if (qty <= 0n) return "";
  const move = div(parse(pnl), qty);
  const entry = parse(position.entryPrice);
  const price = position.isLong ? entry + move : entry - move;
  if (price <= 0n) return "";
  return fromFixed(floorToTick(price, parse(tickSize)));
}

/** 回报率（比例，0.2 = 20%）→ 盈亏（USDT）。没有起始保证金时算不了 */
export function pnlAtRoe(roe: string, position: PositionBasis): Fixed | null {
  if (!roe.trim() || !position.initialMargin) return null;
  return mul(parse(roe), parse(position.initialMargin));
}

/** 盈亏（USDT）→ 回报率（比例） */
export function roeAtPnl(pnl: Fixed, position: PositionBasis): Fixed | null {
  if (!position.initialMargin) return null;
  const margin = parse(position.initialMargin);
  if (margin <= 0n) return null;
  return div(pnl, margin);
}

/**
 * 用户输入 → 触发价（下单要用的那个数）。
 * mode 是 PRICE 时原样返回；PNL / ROE 先换算成盈亏再反推触发价。
 * ROE 的输入是百分数（"20" 表示 20%），换算时除以 100。
 */
export function triggerPriceOf(input: string, mode: TpslInputMode, position: PositionBasis, tickSize: string): string {
  const value = input.trim();
  if (!value) return "";
  if (mode === "PRICE") return value;
  if (mode === "PNL") return triggerAtPnl(value, position, tickSize);
  const pnl = pnlAtRoe(fromFixed(div(parse(value), parse("100"))), position);
  return pnl === null ? "" : triggerAtPnl(fromFixed(pnl), position, tickSize);
}

/**
 * 止盈 / 止损的触发价方向是否合理（只做即时提醒，最终以服务端校验链为准）：
 * 多头止盈要高于开仓价、止损要低于开仓价；空头反过来。
 */
export function triggerDirectionHint(
  triggerPrice: string,
  kind: "TP" | "SL",
  position: PositionBasis,
): string | undefined {
  if (!triggerPrice.trim()) return undefined;
  const pnl = pnlAtTrigger(triggerPrice, position);
  if (pnl === null) return undefined;
  if (kind === "TP" && pnl < 0n) return "止盈触发价在亏损一侧，确认一下方向";
  if (kind === "SL" && pnl > 0n) return "止损触发价在盈利一侧，确认一下方向";
  return undefined;
}
