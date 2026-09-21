import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";

import type { LedgerType, Page, PageQuery } from "../common/types";
import type { Order } from "../order/types";
import type { Position } from "../position/types";
import type {
  Account,
  EquityCurve,
  Fill,
  FundingPayment,
  LedgerEntry,
  LedgerQuery,
  Liquidation,
  SymbolConfig,
} from "./types";

/**
 * 账户模块的 queryKey。
 * 实时部分（资产、仓位、挂单）在 account-store，不进 React Query；这里只有历史类。
 * `xxxRoot` 用来按类失效（不管筛选条件）；登出时 removeQueries({ queryKey: accountKeys.all }) 整个清掉。
 */
export const accountKeys = {
  all: ["account"] as const,
  orderHistoryRoot: ["account", "orders", "history"] as const,
  orderHistory: (symbol?: string) => [...accountKeys.orderHistoryRoot, symbol ?? "all"] as const,
  fillsRoot: ["account", "fills"] as const,
  fills: (symbol?: string) => [...accountKeys.fillsRoot, symbol ?? "all"] as const,
  ledgerRoot: ["account", "ledger"] as const,
  ledger: (type?: string) => [...accountKeys.ledgerRoot, type ?? "all"] as const,
  fundingRoot: ["account", "funding"] as const,
  funding: (symbol?: string) => [...accountKeys.fundingRoot, symbol ?? "all"] as const,
  liquidations: ["account", "liquidations"] as const,
  equityCurve: (days: number) => ["account", "equity-curve", days] as const,
  symbolConfig: (symbol: string) => ["account", "symbol-config", symbol] as const,
};

/** GET /account：资产汇总 + 昵称、重置状态 */
export const fetchAccount = () => request.get<Account>("/account");

/** GET /account/symbol-config：这个币对当前的杠杆和保证金模式 */
export const fetchSymbolConfig = (symbol: string) => request.get<SymbolConfig>("/account/symbol-config", { symbol });

/** 给下单面板用：改杠杆 / 保证金模式后手动失效这个 key */
export const symbolConfigQuery = (symbol: string) =>
  queryOptions({
    queryKey: accountKeys.symbolConfig(symbol),
    queryFn: () => fetchSymbolConfig(symbol),
    staleTime: 60_000,
  });

/** GET /account/positions：当前全部仓位 */
export const fetchPositions = () => request.get<Position[]>("/account/positions");

/** GET /account/orders?status=open：当前挂单（含未触发的条件单） */
export const fetchOpenOrders = (symbol?: string) =>
  request.get<Page<Order>>("/account/orders", { status: "open", symbol });

/** GET /account/orders?status=history：历史委托，游标分页 */
export const fetchOrderHistory = (query: PageQuery = {}) =>
  request.get<Page<Order>>("/account/orders", { status: "history", ...query });

/** GET /account/fills：成交记录，游标分页 */
export const fetchFills = (query: PageQuery = {}) => request.get<Page<Fill>>("/account/fills", query);

/** 给交易页「历史委托」tab 用：最近 N 条，成交 / 强平发生时由 ws-bridge 失效 */
export const orderHistoryQuery = (query: PageQuery = {}) =>
  queryOptions({
    queryKey: [...accountKeys.orderHistory(query.symbol), query.limit ?? null] as const,
    queryFn: () => fetchOrderHistory(query),
  });

/** 给交易页「历史成交」tab 用 */
export const fillsQuery = (query: PageQuery = {}) =>
  queryOptions({
    queryKey: [...accountKeys.fills(query.symbol), query.limit ?? null] as const,
    queryFn: () => fetchFills(query),
  });

/** GET /account/ledger：资金流水，游标分页 */
export const fetchLedger = (query: LedgerQuery = {}) => request.get<Page<LedgerEntry>>("/account/ledger", query);

/** GET /account/funding：资金费收付记录，游标分页 */
export const fetchFundingPayments = (query: PageQuery = {}) =>
  request.get<Page<FundingPayment>>("/account/funding", query);

/** GET /account/liquidations：强平记录，游标分页 */
export const fetchLiquidations = (query: PageQuery = {}) =>
  request.get<Page<Liquidation>>("/account/liquidations", query);

/** GET /account/equity-curve：最近 days 天（1～365）的每日权益 */
export const fetchEquityCurve = (days = 30) => request.get<EquityCurve>("/account/equity-curve", { days });

/** 权益曲线 */
export const equityCurveQuery = (days = 30) =>
  queryOptions({ queryKey: accountKeys.equityCurve(days), queryFn: () => fetchEquityCurve(days) });

// ——— 历史记录页（M10）的无限列表 ———

/**
 * 「加载更多」式列表的 queryKey。
 * 前缀刻意保持在各自的 `xxxRoot` 下：ws-bridge 收到成交 / 资金费 / 强平推送时按 Root 前缀失效，
 * 这些列表跟着一起刷新，不用再加一套失效逻辑。
 */
export const historyPageKeys = {
  orderHistory: (symbol?: string) => [...accountKeys.orderHistoryRoot, "page", symbol ?? "all"] as const,
  fills: (symbol?: string) => [...accountKeys.fillsRoot, "page", symbol ?? "all"] as const,
  ledger: (symbol?: string, type?: string) =>
    [...accountKeys.ledgerRoot, "page", symbol ?? "all", type ?? "all"] as const,
  funding: (symbol?: string) => [...accountKeys.fundingRoot, "page", symbol ?? "all"] as const,
  liquidations: (symbol?: string) => [...accountKeys.liquidations, "page", symbol ?? "all"] as const,
};

/**
 * 游标分页接成无限列表：`pageParam` 就是上一页的 `nextCursor`，为 null 表示到底了。
 * 每页 50 条（服务端默认值，08 第 5 节 O-00），不传 limit。
 */
const pageOptions = <T>(queryKey: readonly unknown[], fetchPage: (cursor?: string) => Promise<Page<T>>) =>
  infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

/** 历史委托，按币对筛 */
export const orderHistoryPages = (symbol?: string) =>
  pageOptions(historyPageKeys.orderHistory(symbol), (cursor) => fetchOrderHistory({ symbol, cursor }));

/** 成交记录，按币对筛 */
export const fillsPages = (symbol?: string) =>
  pageOptions(historyPageKeys.fills(symbol), (cursor) => fetchFills({ symbol, cursor }));

/** 资金流水，按币对 + 流水类型筛 */
export const ledgerPages = (symbol?: string, type?: LedgerType) =>
  pageOptions(historyPageKeys.ledger(symbol, type), (cursor) => fetchLedger({ symbol, type, cursor }));

/** 资金费结算记录，按币对筛 */
export const fundingPages = (symbol?: string) =>
  pageOptions(historyPageKeys.funding(symbol), (cursor) => fetchFundingPayments({ symbol, cursor }));

/** 强平记录，按币对筛 */
export const liquidationPages = (symbol?: string) =>
  pageOptions(historyPageKeys.liquidations(symbol), (cursor) => fetchLiquidations({ symbol, cursor }));
