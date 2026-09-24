"use client";

import { useEffect, useRef, useState } from "react";

import { CHARTING_LIBRARY_PATH } from "@/lib/config/env";
import type { SymbolSpec } from "@/server-api-module/market/types";

import { useChartLines } from "../../_hooks/use-chart-lines";
import type { ChartLine } from "../../_lib/chart-lines";
import { themeColor } from "../../_lib/theme-color";
import { createDatafeed } from "../../_lib/tv-datafeed";
import type { TvChart as TvChartApi, TvWidget } from "../../_lib/tv-types";
import { MA_COLORS } from "./ma-options";

/**
 * T-03 K 线图：TradingView Charting Library（公司授权包放 public/charting_library/，不进 git）。
 *
 * 库自带的顶栏关掉，周期和均线用我们自己的工具栏（设计稿 4:4714），通过 activeChart() 的接口驱动。
 * 切币对、切周期都调接口，不重建图表；只在客户端加载，卸载时 remove()。
 * 图上的交易线（M09）交给 `use-chart-lines`，这里只负责把就绪后的 chart 交给它。
 */

type Status = "loading" | "ready" | "missing";

let libraryPromise: Promise<void> | null = null;

/** 加载一次授权包的脚本，之后复用同一个 Promise */
function loadLibrary(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  libraryPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${CHARTING_LIBRARY_PATH}charting_library.standalone.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      libraryPromise = null;
      reject(new Error("charting_library 没找到"));
    };
    document.head.appendChild(script);
  });
  return libraryPromise;
}

export function TvChart({
  spec,
  resolution,
  maLengths,
  lines,
}: {
  spec: SymbolSpec;
  resolution: string;
  maLengths: number[];
  /** M09 图上交易线：开仓均价、强平价、挂单 */
  lines: ChartLine[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<TvWidget | null>(null);
  const chartRef = useRef<TvChartApi | null>(null);
  const studyIds = useRef(new Map<number, string>());
  // datafeed 要拿到「当前」币对：切币对时只调 setSymbol，datafeed 实例不重建
  const specRef = useRef(spec);
  specRef.current = spec;
  const resolutionRef = useRef(resolution);
  const [status, setStatus] = useState<Status>("loading");

  // 建 widget：整个交易页生命周期里只建一次
  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    loadLibrary()
      .then(() => {
        const TradingView = window.TradingView;
        if (disposed || !TradingView) return;
        const widget = new TradingView.widget({
          container,
          library_path: CHARTING_LIBRARY_PATH,
          datafeed: createDatafeed(() => specRef.current),
          symbol: specRef.current.symbol,
          interval: resolutionRef.current,
          locale: "zh",
          timezone: "Asia/Shanghai",
          theme: "dark",
          autosize: true,
          // 库自带的顶栏 / 周期条 / 左侧画图栏都关掉，工具栏按设计稿自己做；
          // volume_force_overlay 默认开着会把成交量叠在 K 线那一格里，关掉才是币安那样单独一格
          disabled_features: [
            "header_widget",
            "timeframes_toolbar",
            "left_toolbar",
            "popup_hints",
            "volume_force_overlay",
          ],
          enabled_features: [],
          loading_screen: { backgroundColor: themeColor("--bg-surface", "#161a1e") },
          overrides: {
            "paneProperties.background": themeColor("--bg-surface", "#161a1e"),
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": themeColor("--line", "#2b3139"),
            "paneProperties.horzGridProperties.color": themeColor("--line", "#2b3139"),
            "scalesProperties.textColor": themeColor("--text-secondary", "#848e9c"),
            "scalesProperties.lineColor": themeColor("--line", "#2b3139"),
            "mainSeriesProperties.candleStyle.upColor": themeColor("--up", "#0ecb81"),
            "mainSeriesProperties.candleStyle.downColor": themeColor("--down", "#f6465d"),
            "mainSeriesProperties.candleStyle.borderUpColor": themeColor("--up", "#0ecb81"),
            "mainSeriesProperties.candleStyle.borderDownColor": themeColor("--down", "#f6465d"),
            "mainSeriesProperties.candleStyle.wickUpColor": themeColor("--up", "#0ecb81"),
            "mainSeriesProperties.candleStyle.wickDownColor": themeColor("--down", "#f6465d"),
            // 成交量那一格的高度（只在 volume_force_overlay 关掉时生效）
            volumePaneSize: "medium",
          },
        });
        widgetRef.current = widget;
        widget.onChartReady(() => {
          if (disposed) return;
          chartRef.current = widget.activeChart();
          studyIds.current.clear();
          setStatus("ready");
        });
      })
      .catch(() => {
        if (!disposed) setStatus("missing");
      });

    return () => {
      disposed = true;
      chartRef.current = null;
      studyIds.current.clear();
      widgetRef.current?.remove();
      widgetRef.current = null;
    };
  }, []);

  // 切币对：调 setSymbol，图表不重建（datafeed 通过 specRef 拿到新币对）
  useEffect(() => {
    if (status === "ready") chartRef.current?.setSymbol(spec.symbol);
  }, [spec.symbol, status]);

  // 切周期
  useEffect(() => {
    resolutionRef.current = resolution;
    if (status === "ready") chartRef.current?.setResolution(resolution);
  }, [resolution, status]);

  // 均线：按需要增删
  useEffect(() => {
    if (status !== "ready") return;
    const chart = chartRef.current;
    if (!chart) return;
    let cancelled = false;

    for (const [length, id] of studyIds.current) {
      if (!maLengths.includes(length)) {
        if (id) chart.removeEntity(id);
        studyIds.current.delete(length);
      }
    }
    for (const length of maLengths) {
      if (studyIds.current.has(length)) continue;
      // 先占位，避免创建期间重复下单同一条均线
      studyIds.current.set(length, "");
      chart
        .createStudy("Moving Average", false, false, { length }, { "plot.color": MA_COLORS[length] ?? "#848e9c" })
        .then((id) => {
          if (!id) return;
          // 期间被关掉了（占位已删）就把刚建好的也撤掉
          if (cancelled || studyIds.current.get(length) !== "") chart.removeEntity(id);
          else studyIds.current.set(length, id);
        })
        .catch(() => studyIds.current.delete(length));
    }

    return () => {
      cancelled = true;
    };
  }, [maLengths, status]);

  // M09：图表就绪后才画线；切币对时 hook 会自己把旧线清掉
  useChartLines(status === "ready" ? chartRef.current : null, spec.symbol, lines);

  return (
    <div className="relative min-h-0 flex-1 bg-surface">
      <div ref={containerRef} className="h-full w-full" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-[12px] text-muted-foreground">
          {status === "loading" ? (
            "K 线加载中…"
          ) : (
            <span className="max-w-[320px] text-center">
              K 线组件未安装：把授权包放到 apps/web/public/charting_library/（见 apps/web/README.md）
            </span>
          )}
        </div>
      )}
    </div>
  );
}
