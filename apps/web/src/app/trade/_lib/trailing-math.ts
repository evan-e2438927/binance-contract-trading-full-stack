import { divRound, format, mulCeil, parse } from "@binance-contract-trading-full-stack/shared";

import type { Decimal, OrderSide } from "@/server-api-module/common/types";

/**
 * 跟踪委托（M08b / 第 15 讲）的前端算账。
 *
 * 服务端才是标准，这里只为即时反馈。回调率是**百分数**（"1" = 1%），和币安一个口径。
 * 全程 bigint，不用浮点。
 */

/** 币安接口允许的回调率范围（07-binance-reference.md 第 14 节） */
export const CALLBACK_RATE_MIN = "0.1";
export const CALLBACK_RATE_MAX = "10";

/** 常用回调率，点一下填进去 */
export const CALLBACK_RATE_PRESETS = ["0.5", "1", "2", "5"] as const;

/** 回调率填得对不对。返回 null 表示没问题 */
export function callbackRateError(input: string): string | null {
  if (input.trim() === "") return "请填回调率";
  if (!/^\d+(\.\d+)?$/.test(input.trim())) return "回调率只能是数字";
  const rate = parse(input);
  if (rate < parse(CALLBACK_RATE_MIN) || rate > parse(CALLBACK_RATE_MAX)) {
    return `回调率要在 ${CALLBACK_RATE_MIN}% ~ ${CALLBACK_RATE_MAX}% 之间`;
  }
  return null;
}

/**
 * 假如现在就开始跟，止损线落在哪。
 *
 * 卖单（护多头）跟最高价，止损线在下方；买单（护空头）跟最低价，触发线在上方。
 * 回撤用 `mulCeil` 往大了算——止损线离得稍远一点，不会因为舍入显得比服务端更容易被打掉。
 */
export function stopLineFrom(tracked: Decimal, callbackRatePercent: string, side: OrderSide): Decimal | null {
  if (callbackRateError(callbackRatePercent) !== null) return null;
  const base = parse(tracked);
  if (base <= 0n) return null;
  const gap = mulCeil(base, divRound(parse(callbackRatePercent), parse("100")));
  return format(side === "SELL" ? base - gap : base + gap, 8);
}

/**
 * 激活价方向对不对（币安 -2021）：卖单的激活价要高于现价，买单要低于现价。
 * 返回一句人话的提示；没问题返回 null。不填激活价是合法的（= 从现在开始跟）。
 */
export function activationPriceError(input: string, currentPrice: Decimal | null, side: OrderSide): string | null {
  if (input.trim() === "") return null;
  if (!/^\d+(\.\d+)?$/.test(input.trim())) return "激活价只能是数字";
  if (currentPrice === null) return null;
  const price = parse(input);
  const current = parse(currentPrice);
  if (side === "SELL" && price <= current) return "卖出方向的激活价要高于当前价";
  if (side === "BUY" && price >= current) return "买入方向的激活价要低于当前价";
  return null;
}
