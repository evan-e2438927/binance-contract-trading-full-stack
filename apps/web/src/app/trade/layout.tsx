"use client";

import { useParams } from "next/navigation";

import { TradeView } from "./_ui-components/trade-view";

/**
 * 交易页外框。
 *
 * 整页放在 layout 而不是 page：Next 的动态段 /trade/[symbol] 换了参数会把 page 整棵子树重新挂载，
 * K 线图就会被销毁重建（05 第 5 节要求切币对不重建图表）。layout 在 [symbol] 之上，换币对时不重挂，
 * 币对从 useParams 读。/trade 自己没有 symbol，这时渲染 children（那个 page 负责跳到默认币对）。
 */
export default function TradeLayout({ children }: LayoutProps<"/trade">) {
  const params = useParams<{ symbol?: string }>();
  const symbol = params?.symbol;
  if (!symbol) return children;
  return <TradeView symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
