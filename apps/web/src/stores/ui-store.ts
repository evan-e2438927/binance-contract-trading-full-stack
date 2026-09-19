import { create } from "zustand";

import type { KlineInterval } from "@/server-api-module/market/types";

/**
 * 界面状态（05-frontend-design.md 第 4 节）。
 *
 * 下单面板的输入放这里而不是组件内部：点盘口某一档要把价格 / 累计数量填进下单面板，
 * 两个组件不是父子关系，只能走全局 store。
 * 当前币对不在这里——它在路由 /trade/[symbol] 上，刷新和分享链接都能保住。
 */

export interface OrderDraft {
  price: string;
  qty: string;
}

export interface UiState {
  klineInterval: KlineInterval;
  /** 盘口聚合精度（每个币对各记一份）；缺省 = 按 tickSize 不聚合 */
  bookStep: Record<string, string>;
  orderDraft: OrderDraft;
  /** 登录弹窗：顶栏"登录"、下单按钮"登录"、各处未登录提示都打开同一个 */
  loginOpen: boolean;

  setLoginOpen(open: boolean): void;
  setKlineInterval(interval: KlineInterval): void;
  setBookStep(symbol: string, step: string): void;
  /** 点盘口价格 → 填入价格 */
  fillPrice(price: string): void;
  /** 点盘口数量 → 填入该档及以上的累计数量 */
  fillQty(qty: string): void;
  setOrderDraft(patch: Partial<OrderDraft>): void;
  resetOrderDraft(): void;
}

const EMPTY_DRAFT: OrderDraft = { price: "", qty: "" };

export const useUiStore = create<UiState>()((set) => ({
  klineInterval: "15m",
  bookStep: {},
  orderDraft: EMPTY_DRAFT,
  loginOpen: false,

  setLoginOpen: (loginOpen) => set({ loginOpen }),
  setKlineInterval: (klineInterval) => set({ klineInterval }),
  setBookStep: (symbol, step) => set((s) => ({ bookStep: { ...s.bookStep, [symbol]: step } })),
  fillPrice: (price) => set((s) => ({ orderDraft: { ...s.orderDraft, price } })),
  fillQty: (qty) => set((s) => ({ orderDraft: { ...s.orderDraft, qty } })),
  setOrderDraft: (patch) => set((s) => ({ orderDraft: { ...s.orderDraft, ...patch } })),
  resetOrderDraft: () => set({ orderDraft: EMPTY_DRAFT }),
}));
