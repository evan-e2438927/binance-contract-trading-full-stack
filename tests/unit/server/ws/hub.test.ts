import { describe, expect, it } from "vitest";
import { signToken } from "../../../../apps/server/src/auth/tokens";
import { createWsHub, type WsHub } from "../../../../apps/server/src/ws/hub";

const SECRET = "ws-hub-test-secret-0123456789abcdef";

function setup(startMs = Date.parse("2026-09-18T00:00:00Z")) {
  const clock = { t: startMs };
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextTimer = 1;
  const hub: WsHub = createWsHub({
    jwtSecret: SECRET,
    isOpenSymbol: (s) => s === "BTCUSDT",
    now: () => clock.t,
    logger: { log: () => {}, error: () => {} },
    setTimer: (fn, ms) => {
      const timer = { fn, at: clock.t + ms, id: nextTimer++ };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
  });

  function client() {
    const sent: any[] = [];
    const closed: { code: number; reason: string }[] = [];
    const handle = hub.connect((raw) => sent.push(JSON.parse(raw)), (code, reason) => closed.push({ code, reason }));
    return { handle, sent, closed, last: () => sent.at(-1) };
  }

  /** 把时钟推到 ms 之后，触发所有到点的定时器 */
  function advance(ms: number) {
    clock.t += ms;
    for (const timer of timers.filter((t) => t.at <= clock.t)) {
      const i = timers.indexOf(timer);
      if (i >= 0) timers.splice(i, 1);
      timer.fn();
    }
  }

  return { hub, client, clock, advance };
}

const token = (accountId: string, ms = Date.parse("2026-09-18T00:00:00Z")) => signToken(accountId, SECRET, ms);

describe("WebSocket 连接中心", () => {
  it("auth 成功后自动订阅私有频道；推送只到这个账户，频道名不带账户 id", async () => {
    const { hub, client } = setup();
    const a = client();
    const b = client();
    await a.handle.handleMessage(JSON.stringify({ op: "auth", token: await token("acc-a") }));
    await b.handle.handleMessage(JSON.stringify({ op: "auth", token: await token("acc-b") }));
    expect(a.last()).toMatchObject({ ch: "ack", d: { op: "auth", accountId: "acc-a" } });
    expect(a.handle.accountId).toBe("acc-a");

    hub.publishToAccount("acc-a", "order", { id: "o-1" });
    expect(a.last()).toMatchObject({ ch: "order", d: { id: "o-1" } });
    expect(b.sent.filter((m) => m.ch === "order")).toEqual([]);
  });

  it("token 无效 → 错误消息，不订阅私有频道；过期 token 报 TOKEN_EXPIRED", async () => {
    const { hub, client } = setup();
    const c = client();
    await c.handle.handleMessage(JSON.stringify({ op: "auth", token: "garbage" }));
    expect(c.last()).toMatchObject({ ch: "error", d: { code: "UNAUTHORIZED" } });
    expect(c.handle.accountId).toBeNull();
    hub.publishToAccount("acc-a", "order", {});
    expect(c.sent.filter((m) => m.ch === "order")).toEqual([]);

    const old = await signToken("acc-a", SECRET, Date.parse("2026-09-01T00:00:00Z"));
    await c.handle.handleMessage(JSON.stringify({ op: "auth", token: old }));
    expect(c.last()).toMatchObject({ ch: "error", d: { code: "TOKEN_EXPIRED" } });
  });

  it("★ token 到期：私有订阅自动取消，长连接不能绕过有效期", async () => {
    const { hub, client, advance } = setup();
    const c = client();
    await c.handle.handleMessage(JSON.stringify({ op: "auth", token: await token("acc-a") }));
    hub.publishToAccount("acc-a", "order", { id: "o-1" });
    expect(c.sent.filter((m) => m.ch === "order")).toHaveLength(1);

    advance(7 * 24 * 3600_000 + 1000); // 过了 7 天有效期
    expect(c.sent.at(-1)).toMatchObject({ ch: "error", d: { code: "TOKEN_EXPIRED" } });
    hub.publishToAccount("acc-a", "order", { id: "o-2" });
    expect(c.sent.filter((m) => m.ch === "order")).toHaveLength(1);
    expect(c.handle.accountId).toBeNull();
  });

  it("重新 auth 换账户：上一个账户的私有推送立刻收不到", async () => {
    const { hub, client } = setup();
    const c = client();
    await c.handle.handleMessage(JSON.stringify({ op: "auth", token: await token("acc-a") }));
    await c.handle.handleMessage(JSON.stringify({ op: "auth", token: await token("acc-b") }));
    hub.publishToAccount("acc-a", "order", { id: "old" });
    hub.publishToAccount("acc-b", "order", { id: "new" });
    expect(c.sent.filter((m) => m.ch === "order").map((m) => m.d.id)).toEqual(["new"]);
  });

  it("sub / unsub：币对大小写归一，未知频道进 rejected 并回一条错误；私有频道提示不用 sub", async () => {
    const { hub, client } = setup();
    const c = client();
    await c.handle.handleMessage(JSON.stringify({ op: "sub", channels: ["depth:btcusdt", "trade:BTCUSDT", "depth:FOOUSDT", "account"] }));
    expect(c.sent.at(-2)).toMatchObject({ ch: "ack", d: { op: "sub", channels: ["depth:BTCUSDT", "trade:BTCUSDT"], rejected: ["depth:FOOUSDT", "account"] } });
    expect(c.sent.at(-1)).toMatchObject({ ch: "error", d: { code: "INVALID_PARAMS" } });
    expect(c.sent.at(-1).d.message).toContain("私有频道");
    expect([...c.handle.channels]).toEqual(["depth:BTCUSDT", "trade:BTCUSDT"]);

    hub.publish("depth:BTCUSDT", { bids: [] });
    expect(c.last()).toMatchObject({ ch: "depth:BTCUSDT", d: { bids: [] } });

    await c.handle.handleMessage(JSON.stringify({ op: "unsub", channels: ["depth:BTCUSDT"] }));
    hub.publish("depth:BTCUSDT", { bids: [["1", "1"]] });
    expect(c.last()).toMatchObject({ ch: "ack", d: { op: "unsub" } });
  });

  it("★ 心跳：每 30 秒发 ping，60 秒没 pong 就断开；回了 pong 就不断", async () => {
    const { client, advance } = setup();
    const quiet = client();
    const active = client();
    advance(30_000);
    expect(quiet.sent.filter((m) => m.op === "ping")).toHaveLength(1);
    advance(30_000);
    await active.handle.handleMessage(JSON.stringify({ op: "pong" }));
    advance(30_000); // 距离 quiet 上次 pong 已经 90 秒
    expect(quiet.closed).toEqual([{ code: 1001, reason: "心跳超时" }]);
    expect(active.closed).toEqual([]);
  });

  it("连接关掉之后不再收到推送；hub.stop 关掉所有连接", async () => {
    const { hub, client } = setup();
    const c = client();
    await c.handle.handleMessage(JSON.stringify({ op: "sub", channels: ["depth:BTCUSDT"] }));
    c.handle.handleClose();
    hub.publish("depth:BTCUSDT", { bids: [] });
    expect(c.sent.filter((m) => m.ch === "depth:BTCUSDT")).toEqual([]);

    const other = client();
    expect(hub.size).toBe(1);
    hub.stop();
    expect(other.closed).toEqual([{ code: 1001, reason: "服务端关闭" }]);
    expect(hub.size).toBe(0);
  });

  it("消息格式不对回一条 error，不断开连接", async () => {
    const { client } = setup();
    const c = client();
    await c.handle.handleMessage("{oops");
    expect(c.last()).toMatchObject({ ch: "error", d: { code: "INVALID_PARAMS" } });
    expect(c.closed).toEqual([]);
  });
});
