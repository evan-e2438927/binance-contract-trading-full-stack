import { useEffect, useState } from "react";

/** 还剩几秒（向上取整，到点为 0）。按截止时间算而不是每秒减一，页面切到后台定时器变慢也不会走偏 */
export function remainingSeconds(endsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

/** 「59 秒后重新发送」用的倒计时。组件卸载（弹窗关闭）时自动清掉 */
export function useCountdown() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) setEndsAt(null);
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const seconds = endsAt === null ? 0 : remainingSeconds(endsAt, now);

  return {
    seconds,
    running: seconds > 0,
    start(durationMs: number) {
      const t = Date.now();
      setNow(t);
      setEndsAt(t + durationMs);
    },
  };
}
