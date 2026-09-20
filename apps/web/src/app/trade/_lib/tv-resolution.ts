import { KLINE_INTERVALS, type KlineInterval } from "@/server-api-module/market/types";

/**
 * TradingView 的周期（resolution）和币安的周期（interval）互转。
 *
 * 两边写法不一样，而且有一个坑：TradingView 的 "1M" 是一个月，分钟是纯数字 "1"。
 * 所以不做字符串推导，直接用一张对照表。
 */
const RESOLUTION_BY_INTERVAL: Record<KlineInterval, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "8h": "480",
  "12h": "720",
  "1d": "1D",
  "3d": "3D",
  "1w": "1W",
  "1M": "1M",
};

const INTERVAL_BY_RESOLUTION = new Map<string, KlineInterval>(
  KLINE_INTERVALS.map((interval) => [RESOLUTION_BY_INTERVAL[interval], interval]),
);

/** 图表库支持的周期列表，顺序和 KLINE_INTERVALS 一致 */
export const SUPPORTED_RESOLUTIONS = KLINE_INTERVALS.map((interval) => RESOLUTION_BY_INTERVAL[interval]);

/** 币安周期 → 图表库周期 */
export function resolutionOf(interval: KlineInterval): string {
  return RESOLUTION_BY_INTERVAL[interval];
}

/** 图表库周期 → 币安周期；图表库给了我们不支持的周期时返回 null（调用方报错，不猜） */
export function intervalOf(resolution: string): KlineInterval | null {
  return INTERVAL_BY_RESOLUTION.get(resolution) ?? null;
}
