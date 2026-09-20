import { div, type Fixed, mul, parse } from "@binance-contract-trading-full-stack/shared";

import { fromFixed } from "@/lib/format/number";

import { floorToLot } from "./order-validate";

/**
 * 数量输入的单位切换（08 T-06：「数量：单位可切换：币（BTC）/ USDT」）。
 *
 * 下单接口只收币的数量，所以按 USDT 输入时要先换算成币数，再**向下**对齐到合法数量
 * （minQty + k × stepSize）——向上取会超过用户打算花的钱。
 *
 * 换算价：限价单用委托价，市价单用标记价；没有价格就换算不了，返回空串（界面显示提示，不瞎猜）。
 */

export type QtyUnit = "BASE" | "QUOTE";

/** 用户输入 → 下单用的币数。unit 是 BASE 时原样返回（只做合法性对齐留给校验） */
export function toBaseQty(
  input: string,
  unit: QtyUnit,
  price: string | null,
  lot: { minQty: Fixed; stepSize: Fixed },
): string {
  const value = input.trim();
  if (!value) return "";
  if (unit === "BASE") return value;
  if (!price) return "";
  const priceFixed = parse(price);
  if (priceFixed <= 0n) return "";
  const base = floorToLot(div(parse(value), priceFixed), lot);
  return base <= 0n ? "" : fromFixed(base);
}

/** 币数 → USDT 金额（展示「≈ xxx USDT」，或切单位时把输入带过去） */
export function toQuoteQty(baseQty: string, price: string | null): string {
  const value = baseQty.trim();
  if (!value || !price) return "";
  const quote = mul(parse(value), parse(price));
  return quote <= 0n ? "" : fromFixed(quote);
}

/**
 * 切单位时把输入换过去，金额大致不变（币安也是这样，不会把输入框清空）。
 * 换算不了（没有价格）就返回空串，让用户重新输。
 */
export function convertQtyInput(
  input: string,
  from: QtyUnit,
  to: QtyUnit,
  price: string | null,
  lot: { minQty: Fixed; stepSize: Fixed },
): string {
  if (from === to) return input;
  if (!input.trim()) return "";
  return to === "BASE" ? toBaseQty(input, "QUOTE", price, lot) : toQuoteQty(input, price);
}
