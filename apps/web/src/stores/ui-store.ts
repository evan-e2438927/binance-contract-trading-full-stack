import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { KlineInterval } from "@/server-api-module/market/types";

/**
 * 界面状态（05-frontend-design.md 第 4 节）。
 *
 * K 线周期、盘口视图和精度存本地，刷新后保留。用 skipHydration + providers 里手动 rehydrate：
 * 否则服务端渲染出的是默认值、浏览器上来就是存的值，两边对不上会报水合警告。
 *
 * 下单表单的输入不在这里：只有交易页用，放 app/trade/_stores/order-form-store.ts（目录规范第 5.3 节）。
 * 当前币对不在这里——它在路由 /trade/[symbol] 上，刷新和分享链接都能保住。
 */

export type BookView = "both" | "bids" | "asks";

export interface UiState {
  klineInterval: KlineInterval;
  /** 盘口视图：买卖都显示 / 只看买 / 只看卖 */
  bookView: BookView;
  /** 盘口聚合精度（每个币对各记一份）；缺省 = 按 tickSize 不聚合 */
  bookStep: Record<string, string>;
  /** 登录弹窗：顶栏"登录"、下单按钮"登录"、各处未登录提示都打开同一个 */
  loginOpen: boolean;

  setLoginOpen(open: boolean): void;
  setKlineInterval(interval: KlineInterval): void;
  setBookView(view: BookView): void;
  setBookStep(symbol: string, step: string): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      klineInterval: "15m",
      bookView: "both",
      bookStep: {},
      loginOpen: false,

      setLoginOpen: (loginOpen) => set({ loginOpen }),
      setKlineInterval: (klineInterval) => set({ klineInterval }),
      setBookView: (bookView) => set({ bookView }),
      setBookStep: (symbol, step) => set((s) => ({ bookStep: { ...s.bookStep, [symbol]: step } })),
    }),
    {
      name: "trade-ui",
      skipHydration: true,
      // 登录弹窗的开关是一次性的，不存
      partialize: ({ klineInterval, bookView, bookStep }) => ({ klineInterval, bookView, bookStep }),
    },
  ),
);
