import { parse } from "@binance-contract-trading-full-stack/shared";
import { useEffect, useRef, useState } from "react";

export type PriceDirection = "up" | "down" | "flat";

/** 新价和上一笔比：高了 up、低了 down、一样保持上一次的方向（币安最新价的着色方式）。纯函数，方便测 */
export function nextDirection(prev: string | null, next: string | null, current: PriceDirection): PriceDirection {
  if (prev === null || next === null) return current;
  const a = parse(prev);
  const b = parse(next);
  return b > a ? "up" : b < a ? "down" : current;
}

/**
 * 最新价的涨跌方向：和上一笔比较，不是和 24 小时前比。
 * 交易页行情条、顶栏行情、盘口中间行都用这个着色。
 */
export function usePriceDirection(price: string | null | undefined): PriceDirection {
  const [dir, setDir] = useState<PriceDirection>("flat");
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const next = price ?? null;
    setDir((current) => nextDirection(prev.current, next, current));
    if (next !== null) prev.current = next;
  }, [price]);

  return dir;
}
