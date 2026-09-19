import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "订单历史" };

/** 订单历史（05 第 1 节）：需要登录。React Query + 服务端游标分页 */
export default function OrdersPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6">
      <ModulePlaceholder
        id="O-00"
        name="Tab 切换 + 筛选"
        note="历史委托 · 成交记录 · 资金流水 · 资金费 · 强平记录；按币对 / 流水类型筛选"
      />
      <div className="grid grid-cols-2 gap-4">
        <ModulePlaceholder
          id="O-01"
          name="历史委托"
          note="时间 · 币对 · 类型 · 方向 · 价格 · 数量 · 已成交 · 成交均价 · 状态 · 拒单原因"
        />
        <ModulePlaceholder
          id="O-02"
          name="成交记录"
          note="时间 · 币对 · 方向 · 价格 · 数量 · Maker/Taker · 手续费 · 已实现盈亏 · 强平标记"
        />
        <ModulePlaceholder id="O-03" name="资金流水" note="时间 · 类型 · 币对 · 金额 · 变动后余额" />
        <ModulePlaceholder id="O-04" name="资金费" note="结算时间 · 币对 · 方向 · 费率 · 标记价 · 名义价值 · 金额" />
        <ModulePlaceholder
          id="O-05"
          name="强平记录"
          note="时间 · 币对 · 方向 · 数量 · 开仓价 · 标记价 · 亏损 · 清算费 · 强平前保证金 / 维持保证金"
        />
        <ModulePlaceholder id="O-06" name="未登录 / 空状态" note="未登录：提示登录；没有记录：空状态插画 + 去交易" />
      </div>
    </div>
  );
}
