import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { signToken } from "../auth/tokens";
import { createWsHub, type WsHub } from "./hub";
import { attachWsServer } from "./server";

/**
 * 端到端：真的起一个 HTTP server、真的连 WebSocket、真的收发消息。
 * 上面的 hub / publisher 测试都绕开了 socket，这一条验证接线（升级、路径、消息转发、断开清理）。
 */

const SECRET = "ws-e2e-test-secret-0123456789abcdef";
const quiet = { log: () => {}, error: () => {} };
let running: { server: Server; hub: WsHub; close: () => void } | null = null;

afterEach(async () => {
  running?.close();
  running = null;
});

async function startServer(options: { heartbeatMs?: number; pongTimeoutMs?: number } = {}) {
  const server = createServer((_req, res) => res.end("ok"));
  const hub = createWsHub({ jwtSecret: SECRET, isOpenSymbol: (s) => s === "BTCUSDT", logger: quiet, ...options });
  const ws = attachWsServer({ server, hub, logger: quiet });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  running = {
    server,
    hub,
    close: () => {
      ws.close();
      hub.stop();
      server.close();
    },
  };
  return { hub, url: `ws://127.0.0.1:${port}` };
}

function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  async function waitFor(predicate: (m: any) => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = messages.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`等不到消息，收到的是：${JSON.stringify(messages)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  return { socket, messages, opened, closed, waitFor, send: (m: unknown) => socket.send(JSON.stringify(m)) };
}

describe("WebSocket 网关（端到端）", () => {
  it("★ 连上 /ws → auth → 订阅 → 收到公共和私有推送；断开后不再推", async () => {
    const { hub, url } = await startServer();
    const client = connect(`${url}/ws`);
    await client.opened;

    client.send({ op: "auth", token: await signToken("acc-1", SECRET, Date.now()) });
    expect(await client.waitFor((m) => m.ch === "ack")).toMatchObject({ d: { op: "auth", accountId: "acc-1" } });

    client.send({ op: "sub", channels: ["depth:btcusdt"] });
    await client.waitFor((m) => m.ch === "ack" && m.d.op === "sub");

    hub.publish("depth:BTCUSDT", { bids: [["50000", "1"]], asks: [] });
    expect(await client.waitFor((m) => m.ch === "depth:BTCUSDT")).toMatchObject({ d: { bids: [["50000", "1"]] } });
    hub.publishToAccount("acc-1", "order", { id: "o-1" });
    expect(await client.waitFor((m) => m.ch === "order")).toMatchObject({ d: { id: "o-1" } });

    client.socket.close();
    await client.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.size).toBe(0);
    hub.publish("depth:BTCUSDT", { bids: [] }); // 不该抛错
  });

  it("心跳：服务端发 ping，客户端不回 pong 就被断开", async () => {
    const { url } = await startServer({ heartbeatMs: 30, pongTimeoutMs: 60 });
    const client = connect(`${url}/ws`);
    await client.opened;
    expect(await client.waitFor((m) => m.op === "ping")).toEqual({ op: "ping" });
    expect(await client.closed).toMatchObject({ code: 1001, reason: "心跳超时" });
  });

  it("连别的路径连不上", async () => {
    const { url } = await startServer();
    const client = connect(`${url}/nope`);
    await expect(client.opened).rejects.toThrow();
  });
});
