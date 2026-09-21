"use client";

import { format } from "@binance-contract-trading-full-stack/shared";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { useElementWidth } from "@/hooks/use-element-width";
import { formatCompact, formatRatioAsPercent, formatUsdt } from "@/lib/format/number";

import type { Curve, CurvePoint } from "../_lib/curve";

/**
 * B-04 权益曲线的图本身。
 *
 * 画法上守三条（`dataviz` 技能）：线 2px 圆角、面积填充只有 10% 的淡淡一层、
 * 网格线是一格灰的细实线（不抢戏）；**只给最右端一个直接标注**，其余的值靠纵轴刻度和
 * 悬停读数，不在每个点上写数字；**文字一律用文本色，不用线的颜色**——
 * 黄色当正文在深色底上不好读，身份靠旁边那个色点表示。
 *
 * 悬停和键盘左右键都能读到每一天的数（鼠标不用对准那条 2px 的线，
 * 十字线会自己吸附到最近的一天）。
 */

const HEIGHT = 180;
const PAD = { top: 14, right: 68, bottom: 20, left: 46 };

export function EquityChart({ curve }: { curve: Curve }) {
  const { ref, width } = useElementWidth();
  const [active, setActive] = useState<number | null>(null);

  const plotW = width === null ? 0 : Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const px = (point: CurvePoint) => PAD.left + point.x * plotW;
  // y 反过来：0 在底部
  const py = (point: CurvePoint) => PAD.top + (1 - point.y) * plotH;

  const last = curve.points.at(-1);
  const first = curve.points[0];
  const mid = (curve.min + curve.max) / 2n;
  const activePoint = active === null ? null : curve.points[active];
  // buildCurve 保证至少有一个点，这里只是让类型也知道
  if (!first || !last) return null;

  /** 鼠标落在哪个 x，就取最近的那一天——读者瞄的是日期，不是那条线 */
  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || plotW <= 0) return;
    const ratio = (clientX - box.left - PAD.left) / plotW;
    let best = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    curve.points.forEach((point, index) => {
      const gap = Math.abs(point.x - ratio);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    setActive(best);
  };

  return (
    <div ref={ref} className="relative w-full">
      {width !== null && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`权益曲线，${first.date ?? "此刻"} 到 ${last.date ?? "此刻"}，最低 ${format(curve.min, 2)}，最高 ${format(curve.max, 2)} USDT`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          className="touch-none"
        >
          {/* 网格和刻度：一格灰的细实线，能看见但不抢戏 */}
          <g className="text-border">
            {[
              { value: curve.max, y: PAD.top },
              { value: mid, y: PAD.top + plotH / 2 },
              { value: curve.min, y: PAD.top + plotH },
            ].map((tick) => (
              <line
                key={tick.y}
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={tick.y}
                y2={tick.y}
                stroke="currentColor"
                strokeWidth={1}
              />
            ))}
          </g>
          <g className="fill-muted-foreground text-[10px]">
            {[
              { value: curve.max, y: PAD.top },
              { value: mid, y: PAD.top + plotH / 2 },
              { value: curve.min, y: PAD.top + plotH },
            ].map((tick) => (
              <text key={tick.y} x={PAD.left - 6} y={tick.y + 3} textAnchor="end">
                {formatCompact(format(tick.value, 8))}
              </text>
            ))}
            <text x={PAD.left} y={HEIGHT - 6}>
              {first.date ?? ""}
            </text>
            <text x={PAD.left + plotW} y={HEIGHT - 6} textAnchor="end">
              {last.date ?? "此刻"}
            </text>
          </g>

          {/* 每一段单独画：缺了快照的日子断开，不连一条假的直线过去 */}
          {curve.segments.map((segment) => {
            const head = segment[0];
            const tail = segment.at(-1);
            if (!head || !tail) return null;
            const key = `${head.date ?? "live"}-${segment.length}`;
            const line = segment.map((p, i) => `${i === 0 ? "M" : "L"}${px(p)},${py(p)}`).join(" ");
            const base = PAD.top + plotH;
            return (
              <g key={key}>
                {segment.length > 1 && (
                  <path d={`${line} L${px(tail)},${base} L${px(head)},${base} Z`} className="fill-brand/10" />
                )}
                <path
                  d={line}
                  fill="none"
                  className="stroke-brand"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* 孤零零一个点的那一段，线画不出来，补个点 */}
                {segment.length === 1 && <circle cx={px(head)} cy={py(head)} r={3} className="fill-brand" />}
              </g>
            );
          })}

          {/* 十字线 + 当前点。环是表面色，压在线上也看得清 */}
          {/*
        悬停读数是增强，不是唯一通道（dataviz：tooltip enhances, never gates）。
        同一份数据在这张表里，读屏和键盘用户照样读得到，不用去对准那条 2px 的线。
      */}
          <table className="sr-only">
            <caption>每日权益快照</caption>
            <thead>
              <tr>
                <th>日期</th>
                <th>权益（USDT）</th>
              </tr>
            </thead>
            <tbody>
              {curve.points.map((point) => (
                <tr key={point.date ?? "live"}>
                  <td>{point.date ?? "此刻"}</td>
                  <td>{formatUsdt(format(point.equity, 8))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {activePoint && (
            <g>
              <line
                x1={px(activePoint)}
                x2={px(activePoint)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-muted-foreground/50"
                strokeWidth={1}
              />
              <circle
                cx={px(activePoint)}
                cy={py(activePoint)}
                r={4}
                className="fill-brand stroke-surface"
                strokeWidth={2}
              />
            </g>
          )}

          {/* 最右端：唯一的直接标注 */}
          <circle cx={px(last)} cy={py(last)} r={4} className="fill-brand stroke-surface" strokeWidth={2} />
          <text x={px(last) + 8} y={py(last) + 3} className="fill-foreground font-mono text-[10px]">
            {formatUsdt(format(last.equity, 8))}
          </text>
        </svg>
      )}

      {activePoint && (
        <div
          className="pointer-events-none absolute top-2 flex flex-col gap-0.5 whitespace-nowrap rounded-[5px] border bg-elevated px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{
            // 贴着十字线，靠右边时翻到左侧，别被卡片切掉
            left: Math.min(px(activePoint) + 10, (width ?? 0) - 140),
          }}
        >
          <span className="text-muted-foreground">{activePoint.date ?? "此刻（实时权益）"}</span>
          <span className="num font-mono font-semibold text-[13px] text-foreground">
            {formatUsdt(format(activePoint.equity, 8))} USDT
          </span>
          {activePoint.roi !== null && (
            <span className={cn("num font-mono", activePoint.roi >= 0n ? "text-up" : "text-down")}>
              {formatRatioAsPercent(format(activePoint.roi, 8))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
