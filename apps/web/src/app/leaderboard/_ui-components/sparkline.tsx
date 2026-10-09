"use client";

import { format } from "@binance-contract-trading-full-stack/shared";

import { useElementWidth } from "@/hooks/use-element-width";

import type { Curve } from "../_lib/curve";

/**
 * hero 卡片里的迷你权益曲线（R-001/R-003）。纯展示：无坐标轴、无 tooltip、
 * 不能悬停、不能切天数——交互版本按用户决定（ASM-001）整体移除，这里只画一条线。
 *
 * 画法沿用 `equity-chart.tsx` 的线条语言（2px 圆角描边、10% 透明度面积填充、
 * 缺口断开不插值），去掉所有交互和坐标轴/可访问性表格。
 */

const HEIGHT = 80;
const PAD_Y = 6;

export function Sparkline({ curve }: { curve: Curve }) {
  const { ref, width } = useElementWidth();

  const plotW = width ?? 0;
  const plotH = HEIGHT - PAD_Y * 2;
  const px = (x: number) => x * plotW;
  const py = (y: number) => PAD_Y + (1 - y) * plotH;

  const first = curve.points[0];
  const last = curve.points.at(-1);
  // buildCurve 保证至少有一个点，这里只是让类型也知道
  if (!first || !last) return null;

  // 窗口内涨跌决定颜色：和页面其他地方（DirectionText）同一套 up/down 语义，不固定用品牌色。
  // 类名必须是完整字面量（不能拼字符串），不然 Tailwind 的静态扫描找不到、样式不会生成
  const rising = last.equity >= first.equity;
  const areaClass = rising ? "fill-up/10" : "fill-down/10";
  const strokeClass = rising ? "stroke-up" : "stroke-down";
  const dotClass = rising ? "fill-up" : "fill-down";

  const label = `近 30 天权益曲线，${first.date ?? "此刻"} 到 ${last.date ?? "此刻"}，最低 ${format(curve.min, 2)}，最高 ${format(curve.max, 2)} USDT`;

  return (
    <div ref={ref} className="w-full">
      {width !== null && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {curve.segments.map((segment) => {
            const head = segment[0];
            const tail = segment.at(-1);
            if (!head || !tail) return null;
            const key = `${head.date ?? "live"}-${segment.length}`;
            const line = segment.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x)},${py(p.y)}`).join(" ");
            const base = PAD_Y + plotH;
            return (
              <g key={key}>
                {segment.length > 1 && (
                  <path d={`${line} L${px(tail.x)},${base} L${px(head.x)},${base} Z`} className={areaClass} />
                )}
                <path
                  d={line}
                  fill="none"
                  className={strokeClass}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* 孤零零一个点的那一段，线画不出来，补个点 */}
                {segment.length === 1 && <circle cx={px(head.x)} cy={py(head.y)} r={2.5} className={dotClass} />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
