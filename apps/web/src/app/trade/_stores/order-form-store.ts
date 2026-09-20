import { create } from "zustand";

import type { OrderFormValues } from "../_lib/order-body";
import type { QtyUnit } from "../_lib/qty-unit";

/**
 * 下单表单状态（交易页私有）。
 *
 * 放在 store 而不是组件里：点盘口某一档要把价格 / 累计数量填进下单面板，
 * 两个组件不是父子关系（05 第 4 节）。以后 K 线上的挂单线、仓位线也从这里预填。
 *
 * 只存"用户输入的字符串"，不存算出来的数：预估、校验都是从这些值现算的。
 */

export interface OrderFormState extends OrderFormValues {
  /** 数量输入框的单位：币（BASE）或 USDT（QUOTE）。下单永远按币数提交 */
  qtyUnit: QtyUnit;
  set(patch: Partial<OrderFormValues & { qtyUnit: QtyUnit }>): void;
  /** 点盘口价格 → 填入价格 */
  fillPrice(price: string): void;
  /** 点盘口数量 → 填入该档及以上的累计数量（盘口是币数，顺手把单位切回币） */
  fillQty(qty: string): void;
  /** 下单成功后清空数量，价格留着（连续下单常用同一个价） */
  clearQty(): void;
  /** 切币对时重置 */
  reset(): void;
}

const INITIAL: OrderFormValues & { qtyUnit: QtyUnit } = {
  tab: "LIMIT",
  side: "BUY",
  openClose: "OPEN",
  price: "",
  triggerPrice: "",
  workingType: "CONTRACT_PRICE",
  conditionalExec: "LIMIT",
  qty: "",
  timeInForce: "GTC",
  reduceOnly: false,
  qtyUnit: "BASE",
};

export const useOrderFormStore = create<OrderFormState>()((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  fillPrice: (price) => set({ price }),
  fillQty: (qty) => set({ qty, qtyUnit: "BASE" }),
  clearQty: () => set({ qty: "" }),
  reset: () => set(INITIAL),
}));
