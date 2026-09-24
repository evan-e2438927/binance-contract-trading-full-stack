/**
 * TradingView Charting Library 的最小类型声明。
 *
 * 完整类型在 `apps/web/public/charting_library/charting_library.d.ts`，但那个目录**不进 git**
 * （公司授权包，见 apps/web/README.md）。直接引用它会让没放授权包的环境 `check-types` 挂掉，
 * 所以这里只声明我们真正用到的那几个接口，字段名和官方一致。
 */

/** 图表库要的一根 K 线。库只吃 number，这是展示边界（见 tv-datafeed.ts 的说明） */
export interface TvBar {
  /** 开盘时间，毫秒 */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** 库请求历史数据时给的范围，from / to 是**秒** */
export interface TvPeriodParams {
  from: number;
  to: number;
  countBack: number;
  firstDataRequest: boolean;
}

export interface TvSymbolInfo {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  format: "price";
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_empty_bars: boolean;
  supported_resolutions: string[];
  volume_precision: number;
  data_status: "streaming";
}

export interface TvDatafeed {
  onReady(
    callback: (config: { supported_resolutions: string[]; supports_marks: boolean; supports_time: boolean }) => void,
  ): void;
  searchSymbols(): void;
  resolveSymbol(symbolName: string, onResolve: (info: TvSymbolInfo) => void, onError: (reason: string) => void): void;
  getBars(
    symbolInfo: TvSymbolInfo,
    resolution: string,
    periodParams: TvPeriodParams,
    onResult: (bars: TvBar[], meta: { noData: boolean }) => void,
    onError: (reason: string) => void,
  ): void;
  subscribeBars(
    symbolInfo: TvSymbolInfo,
    resolution: string,
    onTick: (bar: TvBar) => void,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void,
  ): void;
  unsubscribeBars(listenerGuid: string): void;
}

/**
 * 图表上的一条画线（`createShape` 建出来的水平线）。
 *
 * ⚠️ 本来该用 `createOrderLine` / `createPositionLine`（线上自带撤单 / 平仓按钮），
 * 但它们属于 **Trading Platform 版**，我们这份 Charting Library 授权包调了会直接抛
 * `createOrderLine is only available on Trading Platform`。所以退回到水平线，只画不点。
 */
export interface TvShape {
  setPoints(points: { price: number }[]): void;
  setProperties(properties: Record<string, unknown>): void;
}

/** `createShape` 的参数，只声明我们用到的 */
export interface TvCreateShapeOptions {
  shape: "horizontal_line";
  text: string;
  lock: boolean;
  disableSelection: boolean;
  disableSave: boolean;
  disableUndo: boolean;
  overrides: Record<string, string | number | boolean>;
}

export interface TvChart {
  setSymbol(symbol: string): void;
  setResolution(resolution: string): void;
  createStudy(
    name: string,
    forceOverlay?: boolean,
    lock?: boolean,
    inputs?: Record<string, unknown>,
    overrides?: Record<string, unknown>,
  ): Promise<string | null>;
  removeEntity(id: string): void;
  createShape(point: { price: number }, options: TvCreateShapeOptions): Promise<string | null>;
  getShapeById(id: string): TvShape;
}

export interface TvWidget {
  onChartReady(callback: () => void): void;
  activeChart(): TvChart;
  remove(): void;
}

export interface TvWidgetOptions {
  container: HTMLElement;
  library_path: string;
  datafeed: TvDatafeed;
  symbol: string;
  interval: string;
  locale: string;
  timezone: string;
  theme: "dark" | "light";
  autosize: boolean;
  disabled_features: string[];
  enabled_features: string[];
  loading_screen: { backgroundColor: string };
  overrides: Record<string, string | number | boolean>;
}

declare global {
  interface Window {
    TradingView?: { widget: new (options: TvWidgetOptions) => TvWidget };
  }
}
