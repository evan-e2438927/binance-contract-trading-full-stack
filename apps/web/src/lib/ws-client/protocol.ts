/** WS 协议里和业务无关的部分（apps/server/src/ws/protocol.ts） */

/** 服务端推送的外壳 */
export interface ServerPush<T = unknown> {
  /** 频道名，如 "depth:BTCUSDT"、"account" */
  ch: string;
  /** 服务端发出时间（毫秒时间戳） */
  ts: number;
  /** 载荷，形状由频道决定（见各模块 subscriptions.ts） */
  d: T;
}

/** idle 没连 · connecting 首次连接中 · open 已连接 · reconnecting 连上过、断了在重连 */
export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting";

/** 协议自带的系统频道，不需要订阅 */
export const systemChannels = {
  /** sub / unsub / auth 的回执 */
  ack: "ack",
  /** 协议错误、鉴权失败（如 TOKEN_EXPIRED） */
  error: "error",
} as const;

/** `error` 频道的载荷 */
export interface WsErrorPayload {
  /** 错误码（packages/shared 的 ERROR_CODES） */
  code: string;
  /** 给用户看的中文说明 */
  message: string;
}
