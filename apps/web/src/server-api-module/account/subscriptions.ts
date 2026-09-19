import { wsClient } from "@/lib/ws-client/instance";

import type { Order } from "../order/types";
import type { Position } from "../position/types";
import type { AccountSummary, Fill, FundingPayment, Liquidation } from "./types";

/**
 * 账户私有频道（apps/server/src/ws/protocol.ts）。auth 成功后服务端自动订阅，不用 subscribe。
 * 增量推送只在连接持续期间可信，断线重连后要 REST 全量对齐（providers/ws-bridge 负责）。
 */
export const accountChannels = {
  /** 资产汇总 */
  account: "account",
  /** 仓位变化（平仓推 positionAmt = "0"） */
  position: "position",
  /** 订单变化 */
  order: "order",
  /** 新成交 */
  fill: "fill",
  /** 被强平 */
  liquidation: "liquidation",
  /** 资金费结算 */
  funding: "funding",
} as const;

/** 监听资产汇总 */
export const onAccount = (handler: (summary: AccountSummary) => void) =>
  wsClient.on<AccountSummary>(accountChannels.account, ({ d }) => handler(d));

/** 监听仓位变化 */
export const onPosition = (handler: (position: Position) => void) =>
  wsClient.on<Position>(accountChannels.position, ({ d }) => handler(d));

/** 监听订单变化 */
export const onOrder = (handler: (order: Order) => void) =>
  wsClient.on<Order>(accountChannels.order, ({ d }) => handler(d));

/** 监听新成交 */
export const onFill = (handler: (fill: Fill) => void) => wsClient.on<Fill>(accountChannels.fill, ({ d }) => handler(d));

/** 监听强平 */
export const onLiquidation = (handler: (record: Liquidation) => void) =>
  wsClient.on<Liquidation>(accountChannels.liquidation, ({ d }) => handler(d));

/** 监听资金费结算 */
export const onFunding = (handler: (payment: FundingPayment) => void) =>
  wsClient.on<FundingPayment>(accountChannels.funding, ({ d }) => handler(d));
