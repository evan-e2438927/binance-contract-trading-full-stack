import ReconnectingWebSocket from "partysocket/ws";

/** 连接层的最小接口：生产用 partysocket，测试里换成假的 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  reconnect(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "message" | "error", listener: (event: Event) => void): void;
}

/** WebSocket.OPEN */
export const SOCKET_OPEN = 1;

export type SocketFactory = (url: string) => SocketLike;

export const defaultSocketFactory: SocketFactory = (url) =>
  new ReconnectingWebSocket(url, [], {
    minReconnectionDelay: 1_000,
    maxReconnectionDelay: 30_000,
    reconnectionDelayGrowFactor: 2,
    connectionTimeout: 5_000,
    // 断线期间不缓冲消息：重连后 open 里会按订阅集重发 auth / sub，缓冲的旧消息再补发一遍会重复订阅
    maxEnqueuedMessages: 0,
    startClosed: true,
  }) as unknown as SocketLike;
