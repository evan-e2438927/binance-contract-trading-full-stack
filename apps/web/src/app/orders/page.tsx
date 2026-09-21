import type { Metadata } from "next";
import { Suspense } from "react";

import { OrdersView } from "./_ui-components/orders-view";

export const metadata: Metadata = { title: "历史记录" };

/**
 * O 历史记录（05 第 1 节 / M10）：历史委托 · 成交记录 · 资金流水 · 资金费 · 强平记录。
 * 需要登录，数据全是服务端游标分页。
 *
 * 这里保持服务端组件（metadata 只能在服务端组件里导出）；`OrdersView` 要读 URL 查询参数，
 * Next 要求读 `useSearchParams()` 的客户端组件外面包一层 Suspense。
 */
export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}
