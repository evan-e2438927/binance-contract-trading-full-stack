import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SocketLike } from "../../../../../apps/web/src/lib/ws-client/socket";
import { WsClient } from "../../../../../apps/web/src/lib/ws-client/ws-client";

/** 假连接：手动触发 open / close / message，记录发出去的消息 */
class FakeSocket implements SocketLike {
  readyState = 3;
  sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, ((event: Event) => void)[]>();

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  reconnect() {}
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open() {
    this.readyState = 1;
    for (const l of this.listeners.get("open") ?? []) l(new Event("open"));
  }
  drop() {
    this.readyState = 3;
    for (const l of this.listeners.get("close") ?? []) l(new Event("close"));
  }
  receive(message: unknown) {
    this.receiveRaw(JSON.stringify(message));
  }
  receiveRaw(data: string) {
    for (const l of this.listeners.get("message") ?? []) l(new MessageEvent("message", { data }));
  }
  takeSent() {
    const sent = this.sent;
    this.sent = [];
    return sent;
  }
}

let socket: FakeSocket;
let client: WsClient;

beforeEach(() => {
  socket = new FakeSocket();
  client = new WsClient("ws://test/ws", () => socket);
});

describe("WsClient", () => {
  it("连上时先 auth 再按订阅集 sub", () => {
    client.setToken("t1");
    client.subscribe(["depth:BTCUSDT", "trade:BTCUSDT"]);
    client.connect();
    expect(socket.takeSent()).toEqual([]);

    socket.open();
    expect(socket.takeSent()).toEqual([
      { op: "auth", token: "t1" },
      { op: "sub", channels: ["depth:BTCUSDT", "trade:BTCUSDT"] },
    ]);
  });

  it("★ 重连后重新 auth + sub，并通知 onOpen（reconnect = true，调用方据此 hydrate）", () => {
    const onOpen = vi.fn();
    client.onOpen(onOpen);
    client.setToken("t1");
    client.subscribe(["ticker:ETHUSDT"]);
    client.connect();
    socket.open();
    socket.takeSent();

    socket.drop();
    expect(client.getStatus()).toBe("reconnecting");
    socket.open();

    expect(socket.takeSent()).toEqual([
      { op: "auth", token: "t1" },
      { op: "sub", channels: ["ticker:ETHUSDT"] },
    ]);
    expect(onOpen.mock.calls).toEqual([[{ reconnect: false }], [{ reconnect: true }]]);
    expect(client.getStatus()).toBe("open");
  });

  it("订阅引用计数：同一频道只 sub 一次，最后一个退订才 unsub", () => {
    client.connect();
    socket.open();
    socket.takeSent();

    const offA = client.subscribe(["depth:BTCUSDT"]);
    const offB = client.subscribe(["depth:BTCUSDT"]);
    expect(socket.takeSent()).toEqual([{ op: "sub", channels: ["depth:BTCUSDT"] }]);

    offA();
    offA(); // 重复调用无副作用
    expect(socket.takeSent()).toEqual([]);
    offB();
    expect(socket.takeSent()).toEqual([{ op: "unsub", channels: ["depth:BTCUSDT"] }]);
    expect(client.subscribedChannels()).toEqual([]);
  });

  it("收到 ping 立刻回 pong", () => {
    client.connect();
    socket.open();
    socket.takeSent();
    socket.receive({ op: "ping" });
    expect(socket.takeSent()).toEqual([{ op: "pong" }]);
  });

  it("按频道名精确分发推送，坏消息忽略", () => {
    const depth = vi.fn();
    const account = vi.fn();
    client.on("depth:BTCUSDT", depth);
    client.on("account", account);
    client.connect();
    socket.open();

    socket.receive({ ch: "depth:BTCUSDT", ts: 1, d: { bids: [], asks: [] } });
    socket.receive({ ch: "depth:ETHUSDT", ts: 2, d: {} });
    socket.receive({ nope: true });
    socket.receiveRaw("not json");

    expect(depth).toHaveBeenCalledWith({ ch: "depth:BTCUSDT", ts: 1, d: { bids: [], asks: [] } });
    expect(depth).toHaveBeenCalledTimes(1);
    expect(account).not.toHaveBeenCalled();
  });

  it("登录后立刻 auth；登出时断开重连，让私有订阅随旧连接消失", () => {
    const reconnect = vi.spyOn(socket, "reconnect");
    client.connect();
    socket.open();
    socket.takeSent();

    client.setToken("t2");
    expect(socket.takeSent()).toEqual([{ op: "auth", token: "t2" }]);

    reconnect.mockClear();
    client.setToken(null);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
