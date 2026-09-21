import { LEDGER_TYPE } from "@binance-contract-trading-full-stack/shared";
import type { Route } from "next";

import type { LedgerType } from "@/server-api-module/common/types";

/**
 * 历史记录页（M10 / 08 第 5 节 O-00）的 tab 定义和 URL 参数解析。
 *
 * tab 和筛选条件都写进 URL（`/orders?tab=fills&symbol=BTCUSDT`），刷新和分享都能保住。
 * 这里全是纯函数，好测；组件只负责把 `useSearchParams()` 和 `router.replace()` 接上去。
 */

export const ORDERS_TABS = [
  { value: "orders", label: "历史委托", empty: "还没有历史委托" },
  { value: "fills", label: "成交记录", empty: "还没有成交记录" },
  { value: "ledger", label: "资金流水", empty: "还没有资金流水" },
  { value: "funding", label: "资金费", empty: "还没有资金费结算" },
  { value: "liquidations", label: "强平记录", empty: "还没有强平记录（这是好事）" },
] as const;

export type OrdersTab = (typeof ORDERS_TABS)[number]["value"];

/** 打开页面默认看哪个 tab；交易页「查看全部」也是跳这个 */
export const DEFAULT_TAB: OrdersTab = "orders";

/** 只有资金流水这一个 tab 有类型筛选（08 第 5 节 O-03 的 8 类） */
export const TAB_HAS_LEDGER_TYPE: OrdersTab = "ledger";

/** URL 里的三个参数解析出来的样子。`undefined` = 不筛，看全部 */
export interface OrdersQuery {
  tab: OrdersTab;
  symbol?: string;
  ledgerType?: LedgerType;
}

/** `useSearchParams()` 和 `URLSearchParams` 都满足这个形状，测试里传个假的就行 */
interface ParamsLike {
  get(key: string): string | null;
}

const TAB_VALUES = ORDERS_TABS.map((tab) => tab.value) as readonly string[];

/**
 * 把 URL 参数解析成页面状态。**认不出来的一律当成没传**，不报错也不空白页——
 * 别人改过的链接、旧的收藏夹都还能打开。
 *
 * @param knownSymbols 当前开放交易的币对；传 `undefined` 表示列表还没加载完，
 *   这时不判断币对合法性（否则首屏会把 URL 里的筛选条件抹掉）。已下架的币对（比如 TONUSDT）
 *   不在这个列表里，但历史记录里还有它的单子，所以筛选框里会补上它，见 `symbolOptions`。
 */
export function parseOrdersQuery(params: ParamsLike, knownSymbols?: string[]): OrdersQuery {
  const rawTab = params.get("tab");
  const tab = rawTab !== null && TAB_VALUES.includes(rawTab) ? (rawTab as OrdersTab) : DEFAULT_TAB;

  const rawSymbol = params.get("symbol")?.toUpperCase();
  const symbol = rawSymbol && (knownSymbols === undefined || knownSymbols.includes(rawSymbol)) ? rawSymbol : undefined;

  const rawType = params.get("type");
  const ledgerType =
    tab === TAB_HAS_LEDGER_TYPE && rawType !== null && (LEDGER_TYPE as readonly string[]).includes(rawType)
      ? (rawType as LedgerType)
      : undefined;

  return { tab, symbol, ledgerType };
}

/**
 * 反过来：状态 → 链接。默认值不写进 URL，地址栏干净点。
 *
 * 返回值标成 Next 的 `Route`：Next 16 的类型化路由只认静态可分析的字符串，
 * 带查询串的模板字面量它推不出来。这里是全页唯一拼 /orders 链接的地方，断言收在这一处。
 */
export function ordersHref(query: OrdersQuery): Route {
  const params = new URLSearchParams();
  if (query.tab !== DEFAULT_TAB) params.set("tab", query.tab);
  if (query.symbol) params.set("symbol", query.symbol);
  if (query.tab === TAB_HAS_LEDGER_TYPE && query.ledgerType) params.set("type", query.ledgerType);
  const search = params.toString();
  return (search ? `/orders?${search}` : "/orders") as Route;
}

/**
 * 币对筛选框的选项：开放交易的币对，加上当前 URL 选中的那个（可能已经下架）。
 * 不然用户从历史记录点进来，筛选框显示不出自己正在看的币对。
 */
export function symbolOptions(knownSymbols: string[], selected?: string): string[] {
  if (selected && !knownSymbols.includes(selected)) return [selected, ...knownSymbols];
  return knownSymbols;
}
