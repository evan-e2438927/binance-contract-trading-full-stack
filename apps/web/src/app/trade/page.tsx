import { redirect } from "next/navigation";

import { DEFAULT_SYMBOL } from "@/lib/config/constants";

export default function TradeIndexPage() {
  redirect(`/trade/${DEFAULT_SYMBOL}`);
}
