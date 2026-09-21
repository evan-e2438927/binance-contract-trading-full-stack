import { decimalsOf, formatDecimal, PLACEHOLDER } from "@/lib/format/number";
import type { Decimal } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";

/**
 * 历史记录里的价格 / 数量怎么显示。
 *
 * 和交易页不同的地方：历史记录里的币对**可能已经下架**（比如 TONUSDT，S01 那次发现的），
 * `/market/symbols` 只给开放交易的币对，查不到它的 tickSize / stepSize。
 * 交易页遇到这种情况直接不渲染那一行，历史记录不行——那笔交易真实发生过，不能装作没有。
 *
 * 所以规格查不到时，按这个数**自己带的小数位**显示（服务端给的就是定标后的十进制字符串，
 * 位数是准的），既不猜精度，也不显示 "--"。
 */
function withStep(value: Decimal | null | undefined, step: Decimal | undefined): string {
  if (value === null || value === undefined || value === "") return PLACEHOLDER;
  return formatDecimal(value, decimalsOf(step ?? value));
}

/** 价格：有币对规格按 tickSize 的位数，没有就按这个数自己的位数 */
export function priceText(value: Decimal | null | undefined, spec?: SymbolSpec): string {
  return withStep(value, spec?.tickSize);
}

/** 数量：有币对规格按 stepSize 的位数，没有就按这个数自己的位数 */
export function qtyText(value: Decimal | null | undefined, spec?: SymbolSpec): string {
  return withStep(value, spec?.stepSize);
}
