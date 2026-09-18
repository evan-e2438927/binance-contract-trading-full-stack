import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { WsHub } from "./hub";

/**
 * 把连接中心挂到 HTTP server 上（04-backend-design.md 第 12 节：`wss://api.<域名>/ws`）。
 *
 * 用 `ws` 库直接处理 upgrade，不用 Hono 的 WebSocket 适配：`@hono/node-ws` 只兼容 `@hono/node-server` v1，
 * 我们是 v2（缺口 #51）。协议本来就是消息驱动的（连上之后发 auth），路由层面只要认一个路径。
 *
 * 这一层只做三件事：认路径、把消息转给 hub、连接关掉时告诉 hub。鉴权、订阅、心跳都在 hub 里。
 */

export interface WsServerOptions {
  server: Server;
  hub: WsHub;
  path?: string;
  logger?: Pick<Console, "log" | "error">;
  /** 单条消息最大字节数：客户端消息就几十字节，留 16 KB 足够 */
  maxPayload?: number;
}

export function attachWsServer(options: WsServerOptions): { close(): void } {
  const path = options.path ?? "/ws";
  const logger = options.logger ?? console;
  const wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload ?? 16 * 1024 });

  const onUpgrade = (request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = request.url ?? "";
    if (url.split("?")[0] !== path) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (socket_) => wss.emit("connection", socket_, request));
  };
  options.server.on("upgrade", onUpgrade);

  wss.on("connection", (socket: WebSocket) => {
    const client = options.hub.connect(
      (raw) => socket.send(raw),
      (code, reason) => socket.close(code, reason),
    );
    socket.on("message", (data) => {
      client.handleMessage(data.toString()).catch((error) => logger.error(`[ws] 连接 ${client.id} 处理消息出错`, error));
    });
    socket.on("close", () => client.handleClose());
    socket.on("error", (error) => {
      logger.error(`[ws] 连接 ${client.id} 出错`, error);
      client.handleClose();
    });
  });

  return {
    close() {
      options.server.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}
