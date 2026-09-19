import { create } from "zustand";

/**
 * 下单表单状态（交易页私有）。
 *
 * 放在全局 store 而不是组件里：点盘口某一档要把价格 / 累计数量填进下单面板，
 * 两个组件不是父子关系（05 第 4 节）。M07 做下单面板时在这里继续加字段（订单类型、方向、选项……）。
 */

export interface OrderDraft {
  price: string;
  qty: string;
}

export interface OrderFormState {
  draft: OrderDraft;
  /** 点盘口价格 → 填入价格 */
  fillPrice(price: string): void;
  /** 点盘口数量 → 填入该档及以上的累计数量 */
  fillQty(qty: string): void;
  setDraft(patch: Partial<OrderDraft>): void;
  reset(): void;
}

const EMPTY_DRAFT: OrderDraft = { price: "", qty: "" };

export const useOrderFormStore = create<OrderFormState>()((set) => ({
  draft: EMPTY_DRAFT,
  fillPrice: (price) => set((s) => ({ draft: { ...s.draft, price } })),
  fillQty: (qty) => set((s) => ({ draft: { ...s.draft, qty } })),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  reset: () => set({ draft: EMPTY_DRAFT }),
}));
