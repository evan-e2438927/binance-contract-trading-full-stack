import { request } from "@/lib/axios-client/client";

import type { PositionMode } from "../common/types";
import type { ResetAccountResult } from "./types";

/** POST /account/reset：重置账户（24 小时一次）。余额、仓位的变化以随后的 WS 推送为准 */
export const resetAccount = () => request.post<ResetAccountResult>("/account/reset");

/** POST /account/position-mode：切换单向 / 双向持仓（能不能切由服务端校验） */
export const setPositionMode = (positionMode: PositionMode) =>
  request.post<{ positionMode: PositionMode }>("/account/position-mode", { positionMode });

/** POST /account/nickname：修改昵称 */
export const setNickname = (nickname: string) => request.post<{ nickname: string }>("/account/nickname", { nickname });
