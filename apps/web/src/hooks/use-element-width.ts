"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 量一块区域现在有多宽（权益曲线要按真实像素画，不能靠 SVG 缩放——
 * 非等比缩放会把 2px 的线拉成粗细不匀）。
 *
 * 返回 null 表示还没量到，这一帧先别画，免得画一次再跳一下。
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
