"use client";

import { useEffect, useRef } from "react";

import { type ChartLine, toChartPrice } from "../_lib/chart-lines";
import { lineColors } from "../_lib/theme-color";
import type { TvChart, TvCreateShapeOptions } from "../_lib/tv-types";

/**
 * M09：把「想要画的线」和图表上实际存在的线对账。
 *
 * 用的是库自带的水平线（`createShape`）。本来该用 `createOrderLine` / `createPositionLine`——
 * 线上自带撤单 / 平仓按钮，设计文档也是这么写的——但那两个接口属于 **Trading Platform 版**，
 * 我们这份 Charting Library 授权包调用时会直接抛
 * `createOrderLine is only available on Trading Platform`（在浏览器里实测到的）。
 * 所以这一版只画线不带按钮，平仓和撤单去下面的表格点。
 *
 * 三件容易出错的事，都在这里解决：
 *
 * 1. **改价不重建**。同一个 key 的线只改坐标和文字——重建会闪一下，而价格是一直在动的
 *    （未实现盈亏跟着标记价走，线上的文字每秒都在变）
 * 2. **建线是异步的**（`createShape` 返回 Promise）。等它回来时这条线可能已经不该存在了
 *    （单子撤了、切了币对）。用一个 generation 计数挡住：回来时代变了就立刻删掉
 * 3. **线不能被用户误碰**：锁住、不可选中、不进图表的保存数据——它们是"系统画的"，
 *    不是用户的画线
 */

/** TradingView 的线型：0 实线、2 虚线 */
const SOLID = 0;
const DASHED = 2;

/** 正在创建中的占位。只做身份比较，不会被当成真的 id 用 */
const PENDING = "__pending__";

/**
 * 删线。组件卸载时 tv-chart 的 effect 先跑 `widget.remove()`，hook 的清理后跑——
 * 这时图表已经销毁，库内部会抛 `Cannot read properties of undefined`。
 * 图表都没了，线自然也没了，吞掉即可；切币对时图表还活着，正常删。
 */
function safeRemove(chart: TvChart, id: string): void {
  try {
    chart.removeEntity(id);
  } catch {
    // 图表已销毁
  }
}

export function useChartLines(chart: TvChart | null, symbol: string, lines: ChartLine[]): void {
  const shapeIds = useRef(new Map<string, string>());
  const applied = useRef(new Map<string, ChartLine>());
  const generation = useRef(0);

  const reset = (target: TvChart | null) => {
    generation.current += 1;
    if (target) {
      for (const id of shapeIds.current.values()) {
        if (id !== PENDING) safeRemove(target, id);
      }
    }
    shapeIds.current.clear();
    applied.current.clear();
  };

  // 切币对（或图表刚建好 / 卸载）：把旧线全清掉，别留在新币对的图上。
  // chart / symbol 这两个依赖不是"函数体里用到了"，而是"变了就得重置"——biome 只看引用，看不出这个意图
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换图表 / 换币对时必须清掉旧线
  useEffect(() => {
    reset(chart);
    return () => reset(chart);
  }, [chart, symbol]);

  useEffect(() => {
    if (!chart) return;
    const mine = generation.current;
    const colors = lineColors();
    const wanted = new Map(lines.map((line) => [line.key, line]));

    // ① 不该存在的线：删掉
    for (const [key, id] of shapeIds.current) {
      if (wanted.has(key)) continue;
      if (id !== PENDING) safeRemove(chart, id);
      shapeIds.current.delete(key);
      applied.current.delete(key);
    }

    // ② 已经有的线：只改变了的那几项
    for (const [key, line] of wanted) {
      const id = shapeIds.current.get(key);
      if (!id || id === PENDING) continue;
      const before = applied.current.get(key);
      if (before?.price === line.price && before?.label === line.label) continue;
      const shape = chart.getShapeById(id);
      if (before?.price !== line.price) shape.setPoints([{ price: toChartPrice(line.price) }]);
      if (before?.label !== line.label) shape.setProperties({ text: line.label });
      applied.current.set(key, line);
    }

    // ③ 新的线：建出来。异步，回来时要重新确认自己还该存在
    for (const [key, line] of wanted) {
      if (shapeIds.current.has(key)) continue;
      // 先占位，免得下一帧 effect 又跑一遍时把同一条线建两次
      shapeIds.current.set(key, PENDING);
      chart
        .createShape({ price: toChartPrice(line.price) }, shapeOptions(line, colors))
        .then((id) => {
          const stale = generation.current !== mine || shapeIds.current.get(key) !== PENDING;
          if (!id) {
            if (!stale) shapeIds.current.delete(key);
            return;
          }
          if (stale) {
            safeRemove(chart, id);
            return;
          }
          shapeIds.current.set(key, id);
          applied.current.set(key, line);
        })
        .catch(() => {
          // 建不出来就当没有这条线，别把占位留着挡住下一次重试
          if (shapeIds.current.get(key) === PENDING) shapeIds.current.delete(key);
        });
    }
  }, [chart, lines]);
}

function shapeOptions(line: ChartLine, colors: ReturnType<typeof lineColors>): TvCreateShapeOptions {
  const color = line.tone === "up" ? colors.up : line.tone === "down" ? colors.down : colors.warn;
  return {
    shape: "horizontal_line",
    text: line.label,
    // 系统画的线：锁住、选不中、不进图表保存的数据、不占用户的撤销栈
    lock: true,
    disableSelection: true,
    disableSave: true,
    disableUndo: true,
    overrides: {
      linecolor: color,
      linestyle: line.dashed ? DASHED : SOLID,
      linewidth: 1,
      textcolor: color,
      fontsize: 11,
      // 标签贴在左边、线的上方，右边留给价格刻度
      horzLabelsAlign: "left",
      vertLabelsAlign: "top",
      // 在价格轴上也标一个价签：一眼看到这条线在哪个价
      showPrice: true,
    },
  };
}
