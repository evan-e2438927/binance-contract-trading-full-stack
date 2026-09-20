import { queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";

import type { Page, PageQuery } from "../common/types";
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
