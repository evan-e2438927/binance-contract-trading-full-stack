import { type Fixed, format, parse } from "@binance-contract-trading-full-stack/shared";

import { trimDecimal } from "@/lib/format/number";
import type { BookLevel } from "@/server-api-module/market/types";

/**
 * 盘口聚合与累计量（M04）。全程 bigint，不碰浮点。
 *
 * 聚合方向按「合并后这一档还挂得住」来定：买盘价格向下取整、卖盘向上取整。
 * 例如 tickSize 0.1、精度 1 时，买单 80,715.9 归到 80,715（往下让一点，仍然买得到），
 * 卖单 80,715.1 归到 80,716（往上让一点）。反过来会把档位挪到对手方向，看上去价差变小。
 */

/** bigint → 展示用的十进制字符串，去掉定标的尾随零 */
const fixedToString = (value: Fixed): string => trimDecimal(format(value, 8));

export type BookSide = "bid" | "ask";

export interface BookRow {
  /** 这一档的价格（聚合后的档位价） */
  price: string;
  /** 这一档的数量（聚合进来的各档之和） */
  qty: string;
  /** 从最优价累计到这一档的数量 */
  cumulative: string;
  /** 累计量占本侧最大累计量的百分比，0～100 的整数，只用来画背景条 */
  percentNum: number;
}

/** 价格归到所在档位：买盘向下取整、卖盘向上取整。step 必须 > 0 */
export function bucketPrice(price: Fixed, step: Fixed, side: BookSide): Fixed {
  const remainder = price % step;
  if (remainder === 0n) return price;
  return side === "bid" ? price - remainder : price - remainder + step;
}

/**
 * 把一侧的 20 档按 step 合并，并算出累计量和背景条百分比。
 * levels 要按币安给的顺序传进来（买盘价格从高到低、卖盘从低到高），也就是最优价在前。
 */
export function aggregateSide(levels: readonly BookLevel[], step: string, side: BookSide): BookRow[] {
  const stepFixed = parse(step);
  if (stepFixed <= 0n) throw new Error(`聚合精度必须大于 0：${step}`);

  // 保持最优价在前的顺序：Map 按插入顺序遍历
  const buckets = new Map<string, Fixed>();
  for (const [price, qty] of levels) {
    const key = fixedToString(bucketPrice(parse(price), stepFixed, side));
    buckets.set(key, (buckets.get(key) ?? 0n) + parse(qty));
  }

  let cumulative = 0n;
  const rows: { price: string; qty: Fixed; cumulative: Fixed }[] = [];
  for (const [price, qty] of buckets) {
    cumulative += qty;
    rows.push({ price, qty, cumulative });
  }

  const max = cumulative; // 最后一行的累计量就是本侧最大值
  return rows.map((row) => ({
    price: row.price,
    qty: fixedToString(row.qty),
    cumulative: fixedToString(row.cumulative),
    // 百分比是画条用的长度，不是金额：先用 bigint 算成 0～100 的整数，再转 number
    percentNum: max === 0n ? 0 : Number((row.cumulative * 100n) / max),
  }));
}

/** 精度选项：tickSize 的 1 / 10 / 100 倍（08 T-04） */
export function stepOptions(tickSize: string): string[] {
  const base = parse(tickSize);
  return [base, base * 10n, base * 100n].map(fixedToString);
}
