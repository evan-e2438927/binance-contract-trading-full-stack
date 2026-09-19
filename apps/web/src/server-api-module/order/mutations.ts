import { request } from "@/lib/axios-client/client";

import type { Order, PlaceOrderBody } from "./types";

/** POST /orders：下单。返回下单那一刻的订单；之后的状态变化以 WS order 推送为准 */
export const placeOrder = (body: PlaceOrderBody) => request.post<Order>("/orders", body);

/** DELETE /orders/:id：撤一张单 */
export const cancelOrder = (id: string) => request.delete<Order>(`/orders/${id}`);

/** DELETE /orders?symbol=：撤掉某个币对的全部挂单，返回被撤的订单 */
export const cancelAllOrders = (symbol: string) => request.delete<Order[]>("/orders", { symbol });
