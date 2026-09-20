import { decimalsOf } from "@/lib/format/number";
import { wsClient } from "@/lib/ws-client/instance";
import { fetchKlines } from "@/server-api-module/market/queries";
import { marketChannels, onKline } from "@/server-api-module/market/subscriptions";
import type { Kline, KlinePush, SymbolSpec } from "@/server-api-module/market/types";

import { intervalOf, SUPPORTED_RESOLUTIONS } from "./tv-resolution";
import type { TvBar, TvDatafeed, TvPeriodParams, TvSymbolInfo } from "./tv-types";

/**
 * TradingView Charting Library 的 Datafeed 适配器（M03）。
 *
 * 数值在这里从字符串变成 number：图表库只接受 number，这是**展示边界**——
 * 这些数只进图表，不参与任何账务计算（`CLAUDE.md` 硬约束第 1 条针对的是计算路径）。
 * 下单价格、盈亏这些还是走 bigint。
 *
 * K 线数据不进 store：图表库自己有缓存和分页（05 第 5 节）。
 */

/** 一根 K 线 → 图表库的一根柱子 */
function toBar(k: Kline): TvBar {
  return {
    time: k.openTime,
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
    volume: Number(k.volume),
  };
}

function pushToBar(k: KlinePush): TvBar {
  return {
    time: k.openTime,
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
    volume: Number(k.volume),
  };
}

/** 本地时区；图表库不认识时给它 UTC，总比整条时间轴偏掉好 */
function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

/**
 * getSpec 而不是直接传 spec：切币对时图表只调 setSymbol，datafeed 实例不重建，
 * 所以每次回调都要现取当前币对（精度、订阅的频道都跟着它）。
 */
export function createDatafeed(getSpec: () => SymbolSpec): TvDatafeed {
  // 每个订阅一条：listenerGuid → 取消函数（退订 WS + 摘掉监听）
  const subscriptions = new Map<string, () => void>();

  return {
    onReady(callback) {
      // 官方要求异步回调，同步调用会拿不到 datafeed 的初始化结果
      setTimeout(
        () => callback({ supported_resolutions: SUPPORTED_RESOLUTIONS, supports_marks: false, supports_time: false }),
        0,
      );
    },

    // 币对切换用我们自己的下拉（T-01），库里的搜索关掉了
    searchSymbols() {},

    resolveSymbol(_symbolName, onResolve) {
      const spec = getSpec();
      const info: TvSymbolInfo = {
        name: `${spec.baseAsset}/${spec.quoteAsset}`,
        ticker: spec.symbol,
        description: `${spec.baseAsset}/${spec.quoteAsset} 永续`,
        type: "crypto",
        session: "24x7",
        timezone: localTimezone(),
        exchange: "合约模拟盘",
        listed_exchange: "",
        format: "price",
        minmov: 1,
        // 价格小数位按 tickSize 推，和全站展示一致（不用 pricePrecision）
        pricescale: 10 ** decimalsOf(spec.tickSize),
        has_intraday: true,
        has_empty_bars: false,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision: decimalsOf(spec.stepSize),
        data_status: "streaming",
      };
      setTimeout(() => onResolve(info), 0);
    },

    getBars(_symbolInfo, resolution, periodParams: TvPeriodParams, onResult, onError) {
      const spec = getSpec();
      const interval = intervalOf(resolution);
      if (!interval) {
        onError(`不支持的周期：${resolution}`);
        return;
      }
      // 往左拖加载更早的数据：按 to 翻页，单次最多 1500 根（服务端也是这个上限）
      fetchKlines({
        symbol: spec.symbol,
        interval,
        limit: Math.min(1500, Math.max(periodParams.countBack, 1)),
        endTime: periodParams.to * 1000 - 1,
      })
        .then((klines) => {
          const bars = klines.filter((k) => k.openTime >= periodParams.from * 1000).map(toBar);
          onResult(bars, { noData: bars.length === 0 });
        })
        .catch((error: unknown) => onError(error instanceof Error ? error.message : "K 线加载失败"));
    },

    subscribeBars(_symbolInfo, resolution, onTick, listenerGuid) {
      const spec = getSpec();
      const interval = intervalOf(resolution);
      if (!interval) return;
      const offs = [
        onKline(spec.symbol, interval, (push) => onTick(pushToBar(push))),
        wsClient.subscribe([marketChannels.kline(spec.symbol, interval)]),
      ];
      subscriptions.set(listenerGuid, () => {
        for (const off of offs) off();
      });
    },

    unsubscribeBars(listenerGuid) {
      subscriptions.get(listenerGuid)?.();
      subscriptions.delete(listenerGuid);
    },
  };
}
