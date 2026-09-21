import { type Fixed, parse } from "@binance-contract-trading-full-stack/shared";

import type { EquityCurve } from "@/server-api-module/account/types";

/**
 * 权益曲线的几何计算（B-04）。纯函数，输出 0～1 的归一化坐标，画多大由组件决定——
 * 这样它能在测试里单独验，不用挂 DOM。
 *
 * 两条规则：
 *
 * 1. **缺的日子断开，不插值**（`docs/frontend/README.md` M11）。某天服务端没拍到快照，
 *    我们不知道那天权益是多少，连一条直线过去就是编数字。所以折线拆成多段，中间断开。
 * 2. **金额全程 bigint**。只有最后一步「这个值在最小值和最大值之间的位置」才转成
 *    普通小数——那是个比例（画在第几像素），不是金额，不参与任何钱的计算。
 */

export interface CurvePoint {
  /** "YYYY-MM-DD"（UTC 快照）；最右端那个实时点是 null */
  date: string | null;
  /** 权益 */
  equity: Fixed;
  /** 从上次重置起的收益率（比例）；实时点没有 */
  roi: Fixed | null;
  /** 最右端的实时权益点（和快照分开画） */
  live: boolean;
  /** 横向位置 0～1（按日期在整个窗口里的位置，不是数组下标） */
  x: number;
  /** 纵向位置 0～1（0 = 最低，1 = 最高） */
  y: number;
}

export interface Curve {
  /** 折线分段；相邻两天才连线，中间缺了就另起一段 */
  segments: CurvePoint[][];
  /** 全部点，按 x 升序。hover 找最近点用 */
  points: CurvePoint[];
  /** 纵轴范围 */
  min: Fixed;
  max: Fixed;
}

const DAY_MS = 86_400_000;

/** "2026-09-21" → UTC 时间戳。格式不对返回 NaN，调用方当成没有这个点 */
function dayStamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * @param curve 服务端的 GET /account/equity-curve
 * @returns 没有任何可画的点时返回 null（组件显示空状态，不画一条假的直线）
 */
export function buildCurve(curve: EquityCurve | undefined): Curve | null {
  if (!curve) return null;

  const raw: { date: string | null; stamp: number; equity: Fixed; roi: Fixed | null; live: boolean }[] = [];

  for (const snapshot of curve.snapshots) {
    const stamp = dayStamp(snapshot.date);
    if (Number.isNaN(stamp)) continue;
    raw.push({ date: snapshot.date, stamp, equity: parse(snapshot.equity), roi: parse(snapshot.roi), live: false });
  }

  // 最右端是「此刻」的权益。缺标记价时服务端给 null，那就只画到最后一张快照
  if (curve.current.equity !== null) {
    // 实时点落在它自己那一天的位置上；同一天已经有快照时也不合并，快照是 UTC 00:00 拍的，
    // 和此刻不是一个时间点
    raw.push({
      date: null,
      stamp: Math.floor(curve.current.time / DAY_MS) * DAY_MS,
      equity: parse(curve.current.equity),
      roi: null,
      live: true,
    });
  }

  raw.sort((a, b) => a.stamp - b.stamp || Number(a.live) - Number(b.live));

  const firstRaw = raw[0];
  const lastRaw = raw.at(-1);
  if (!firstRaw || !lastRaw) return null;

  const spanMs = lastRaw.stamp - firstRaw.stamp;

  let min = firstRaw.equity;
  let max = firstRaw.equity;
  for (const item of raw) {
    if (item.equity < min) min = item.equity;
    if (item.equity > max) max = item.equity;
  }
  const range = max - min;

  const points: CurvePoint[] = raw.map((item) => ({
    date: item.date,
    equity: item.equity,
    roi: item.roi,
    live: item.live,
    // 只有一个点、或者全在同一天时摆中间，不然会贴着左边
    x: spanMs === 0 ? 0.5 : (item.stamp - firstRaw.stamp) / spanMs,
    // 比例：先在 bigint 上放大再转普通数，避免 bigint 除法把小数截没
    y: range === 0n ? 0.5 : Number(((item.equity - min) * 1_000_000n) / range) / 1_000_000,
  }));

  // 相邻两天才连线。差一天以上说明中间有天没拍到快照，断开
  const segments: CurvePoint[][] = [];
  let current: CurvePoint[] = [];
  points.forEach((point, index) => {
    const previous = raw[index - 1];
    const self = raw[index];
    if (!previous || !self) {
      // 第一个点：开一段新的
      if (current.length > 0) segments.push(current);
      current = [point];
      return;
    }
    const gapDays = Math.round((self.stamp - previous.stamp) / DAY_MS);
    if (gapDays <= 1) {
      current.push(point);
      return;
    }
    segments.push(current);
    current = [point];
  });
  if (current.length > 0) segments.push(current);

  return { segments, points, min, max };
}
