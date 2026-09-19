import { request } from "@/lib/axios-client/client";

import type { MarginMode, PositionSide } from "../common/types";
import type { Order } from "../order/types";
import type { AdjustIsolatedMarginBody, Position, SetLeverageResult, SetMarginModeResult } from "./types";

/** POST /positions/leverage：调杠杆（上限按分层表，服务端校验） */
export const setLeverage = (symbol: string, leverage: number) =>
  request.post<SetLeverageResult>("/positions/leverage", { symbol, leverage });

/** POST /positions/margin-mode：切换全仓 / 逐仓 */
export const setMarginMode = (symbol: string, marginMode: MarginMode) =>
  request.post<SetMarginModeResult>("/positions/margin-mode", { symbol, marginMode });

/** POST /positions/isolated-margin：追加 / 减少逐仓保证金，返回调整后的仓位 */
export const adjustIsolatedMargin = (body: AdjustIsolatedMarginBody) =>
  request.post<Position[]>("/positions/isolated-margin", body);

/** POST /positions/close：市价全平一个仓位，返回平仓单 */
export const closePosition = (symbol: string, positionSide: PositionSide = "BOTH") =>
  request.post<Order>("/positions/close", { symbol, positionSide });
