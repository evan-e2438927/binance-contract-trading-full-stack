"use client";

import { useEffect, useState } from "react";

import { PLACEHOLDER } from "@/lib/format/number";
import { formatCountdown } from "@/lib/format/time";

/**
 * 倒计时 "03:42:15"，每秒走一次。to 为 null 显示 "--"。
 * 归零后停在 00:00:00，不自己往后推（资金费倒计时要等服务端推来新的 nextFundingTime，M02 规则）。
 * 首次渲染不读时钟，挂载后才开始走，避免服务端渲染和浏览器时间不一致导致的水合报错。
 */
export function Countdown({ to }: { to: number | null | undefined }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (to === null || to === undefined || now === null) return <>{PLACEHOLDER}</>;
  return <>{formatCountdown(to - now)}</>;
}
