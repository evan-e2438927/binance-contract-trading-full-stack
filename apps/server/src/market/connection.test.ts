import { describe, expect, it } from "vitest";
import { defaultBackoffMs, openConnection, type ConnectionState } from "./connection";
import { FakeSocket, fakeClock } from "./testing";

const silent = { log: () => {}, error: () => {} };

function setup(staleMs = 10_000) {
  const clock = fakeClock();
  const sockets: FakeSocket[] = [];
  const states: ConnectionState[] = [];
  const messages: string[] = [];
  const connection = openConnection({
    name: "market",
    url: "wss://example/market/stream?streams=btcusdt@aggTrade",
    onMessage: (text) => messages.push(text),
    onStateChange: (state) => states.push(state),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    staleMs,
    logger: silent,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, sockets, states, messages, connection, last: () => sockets[sockets.length - 1]! };
}

describe("重连", () => {
  it("退避：1s, 2s, 4s, 8s, 16s, 30s, 30s（04-backend-design.md 第 2 节）", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(defaultBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("一直连不上：按退避时间一次次重试", () => {
    const { clock, sockets, last } = setup();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      last().drop(); // 没 open 就断了
      waits.push(clock.pending()[0]!);
      clock.advance(waits[i]!);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(sockets).toHaveLength(7);
  });

  it("重连后收到数据，退避清零；只连上不推数据不清零", () => {
    const { clock, last } = setup();
    last().drop();
    clock.advance(1000);
    last().open();
    last().drop(); // 连上了但一条数据都没来
    expect(clock.pending()[0]).toBe(2000);
    clock.advance(2000);
    last().open();
    last().message("{}");
    last().drop();
    expect(clock.pending()[0]).toBe(1000);
  });

  it("状态：connecting → open → closed → connecting", () => {
    const { clock, states, last } = setup();
    last().open();
    last().drop();
    clock.advance(1000);
    expect(states).toEqual(["connecting", "open", "closed", "connecting"]);
  });

  it("币安 24 小时主动断开：和普通断线一样，1 秒后重连", () => {
    const { clock, sockets, last } = setup();
    last().open();
    last().message("{}");
    clock.advance(9_000);
    last().message("{}");
    last().drop();
    clock.advance(1000);
    expect(sockets).toHaveLength(2);
  });
});

describe("看门狗：静默断线", () => {
  it("连着但 10 秒没有任何消息：主动关掉并重连", () => {
    const { clock, sockets, connection, last } = setup();
    last().open();
    last().message("{}");
    clock.advance(9_999);
    expect(connection.state()).toBe("open");
    clock.advance(1);
    expect(sockets[0]!.closed).toBe(true);
    expect(connection.state()).toBe("closed");
    clock.advance(1000);
    expect(sockets).toHaveLength(2);
  });

  it("消息持续到来就不会误判", () => {
    const { clock, connection, last } = setup();
    last().open();
    for (let i = 0; i < 100; i++) {
      clock.advance(1000);
      last().message("{}");
    }
    expect(connection.state()).toBe("open");
  });

  it("被看门狗关掉的旧连接，close 事件晚到：忽略，不会多排一次重连", () => {
    const { clock, sockets, last } = setup();
    last().open();
    clock.advance(10_000);
    const stale = sockets[0]!;
    clock.advance(1000); // 新连接已经建起来
    stale.drop();
    expect(clock.pending()).toEqual([]);
    expect(sockets).toHaveLength(2);
  });
});

describe("stop", () => {
  it("关掉连接，之后不再重连", () => {
    const { clock, sockets, connection, messages, last } = setup();
    last().open();
    last().message("hello");
    connection.stop();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.drop();
    clock.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(messages).toEqual(["hello"]);
    expect(connection.state()).toBe("closed");
  });
});
