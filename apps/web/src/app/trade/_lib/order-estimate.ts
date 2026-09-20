import { type Fixed, format, mul, mulCeil, parse } from "@binance-contract-trading-full-stack/shared";

import { floorToLot } from "./order-validate";

/**
 * 下单面板预估区里**只依赖输入本身**的三个数（设计稿 4:5796）：名义价值、预估保证金、预估手续费。
 *
 * 这三个只用到价格、数量、杠杆、费率，前端算得出来，所以输入一变就立刻跟着变。
 * 依赖账户全局状态的（可开最大、预估强平价）不在这里，走 `POST /orders/preview`，慢半拍出现。
 */

export interface EstimateInput {
  /** 限价用委托价，市价用标记价；没有价格时传 null */
  price: string | null;
  qty: string;
  leverageNum: number;
  /** 吃单方费率，来自 GET /market/symbols */
  takerFeeRate: string;
}

export interface Estimate {
  /** 名义价值 = 价格 × 数量 */
  notional: Fixed;
  /** 起始保证金 = 名义价值 ÷ 杠杆 */
  margin: Fixed;
  /** 预估手续费：按 Taker 算，向上取整（和服务端预留手续费同口径，宁可多算不少算） */
  fee: Fixed;
}

/** 价格或数量为空时返回 null，界面显示 "--" 或 0，不瞎猜 */
export function estimateOrder(input: EstimateInput): Estimate | null {
  if (!input.price || !input.qty.trim() || input.leverageNum <= 0) return null;
  const price = parse(input.price);
  const qty = parse(input.qty);
  if (price <= 0n || qty <= 0n) return null;

  const notional = mul(price, qty);
  return {
    notional,
    margin: notional / BigInt(input.leverageNum),
    fee: mulCeil(notional, parse(input.takerFeeRate)),
  };
}

/**
 * 百分比滑块：按「可开最大数量」换算，再对齐到合法数量（向下取）。
 * maxQty 还没回来（服务端预估慢半拍）时返回空串，滑块拖了也不填数。
 */
export function qtyFromPercent(
  maxQty: string | null,
  percentNum: number,
  lot: { minQty: Fixed; stepSize: Fixed },
): string {
  if (!maxQty) return "";
  const max = parse(maxQty);
  if (max <= 0n) return "";
  const qty = floorToLot((max * BigInt(Math.round(percentNum))) / 100n, lot);
  return qty <= 0n ? "" : format(qty, 8).replace(/0+$/, "").replace(/\.$/, "");
}
