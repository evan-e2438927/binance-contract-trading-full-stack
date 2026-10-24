import { describe, expect, it } from "vitest";
import { parseClientMessage, parsePublicChannel } from "../../../../apps/server/src/ws/protocol";

const open = (s: string) => s === "BTCUSDT" || s === "ETHUSDT";

describe("WebSocket 协议", () => {
  it("客户端消息：四种 op，多余字段和未知 op 都拒", () => {
    expect(parseClientMessage('{"op":"auth","token":"abc"}')).toEqual({ ok: true, message: { op: "auth", token: "abc" } });
    expect(parseClientMessage('{"op":"sub","channels":["depth:BTCUSDT"]}')).toEqual({ ok: true, message: { op: "sub", channels: ["depth:BTCUSDT"] } });
    expect(parseClientMessage('{"op":"pong"}').ok).toBe(true);
    for (const bad of ['{"op":"subscribe"}', '{"op":"sub"}', '{"op":"sub","channels":[]}', '{"op":"auth","token":"a","extra":1}', "not json", "[]", '{"op":"pong","x":1}']) {
      expect(parseClientMessage(bad).ok, bad).toBe(false);
    }
  });

  it("频道名：币对统一大写；没开放的币对、未知类型、K 线周期不对都返回 null", () => {
    expect(parsePublicChannel("depth:btcusdt", open)).toEqual({ name: "depth:BTCUSDT", kind: "depth", symbol: "BTCUSDT" });
    expect(parsePublicChannel("kline:BTCUSDT:15m", open)).toEqual({ name: "kline:BTCUSDT:15m", kind: "kline", symbol: "BTCUSDT", interval: "15m" });
    expect(parsePublicChannel("market", open)).toEqual({ name: "market", kind: "market" });
    for (const bad of ["depth:FOOUSDT", "depth", "depth:BTCUSDT:1m", "kline:BTCUSDT", "kline:BTCUSDT:1s", "account", "trade:BTCUSDT:x:y", ""]) {
      expect(parsePublicChannel(bad, open), bad).toBeNull();
    }
  });
});
