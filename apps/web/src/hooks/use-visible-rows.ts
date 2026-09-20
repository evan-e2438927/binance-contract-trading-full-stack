"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 量一块区域能放下几**整行**，只渲染这么多（2026-09-20）。
 *
 * 为什么需要：盘口和最新成交都是「固定行高 + overflow-hidden」，原来把全部行都塞进去、
 * 靠溢出截掉多的。行少时看不出来，行一多边上就永远露着半行，看着像渲染坏了。
 *
 * 用它之后截掉的是**整行**，而且截的永远是最不重要的那一端
 * （卖盘从最远处截、买盘从最远处截、成交列表从最旧的截）。
 *
 * 返回 null 表示还没量到高度——这一帧先别画，免得先铺满再收缩闪一下。
 */
export function useVisibleRows(rowHeight: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setVisibleRows(Math.max(0, Math.floor(el.clientHeight / rowHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowHeight]);

  return { ref, visibleRows };
}
