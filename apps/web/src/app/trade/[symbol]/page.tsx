import type { Metadata } from "next";

import { TradeView } from "../_ui-components/trade-view";

export async function generateMetadata(props: PageProps<"/trade/[symbol]">): Promise<Metadata> {
  const { symbol } = await props.params;
  return { title: symbol.toUpperCase() };
}

/** 交易主页面：全部交易功能都在这一页（05 第 2、3 节） */
export default async function TradePage(props: PageProps<"/trade/[symbol]">) {
  const { symbol } = await props.params;
  return <TradeView symbol={symbol.toUpperCase()} />;
}
