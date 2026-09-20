import type { Metadata } from "next";

export async function generateMetadata(props: PageProps<"/trade/[symbol]">): Promise<Metadata> {
  const { symbol } = await props.params;
  return { title: symbol.toUpperCase() };
}

/**
 * 交易页的内容在 app/trade/layout.tsx 里（切币对时不重新挂载，见那里的说明）。
 * 这个 page 只负责标题。
 */
export default function TradePage() {
  return null;
}
