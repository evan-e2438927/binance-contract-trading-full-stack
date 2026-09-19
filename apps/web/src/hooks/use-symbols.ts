import { useQuery } from "@tanstack/react-query";

import { symbolsQuery } from "@/server-api-module/market/queries";
import type { SymbolSpec } from "@/server-api-module/market/types";

/** 开放交易的币对规格 + 杠杆分层表。基本不变（分层表每天同步一次），缓存 10 分钟 */
export function useSymbols() {
  return useQuery(symbolsQuery());
}

/** 单个币对的规格；列表还没回来时是 undefined */
export function useSymbolSpec(symbol: string): SymbolSpec | undefined {
  const { data } = useSymbols();
  return data?.find((s) => s.symbol === symbol);
}
