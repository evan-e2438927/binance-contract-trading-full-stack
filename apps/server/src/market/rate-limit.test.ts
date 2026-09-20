import { AppError } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it, vi } from "vitest";

import { createBinanceRest } from "./binance-rest";
import { createRateLimitGate } from "./rate-limit";

/**
 * 限流闸门（2026-09-20）。这里守的是**接线**，不是逻辑：
 * 逻辑早就写对了，出事是因为每个调用点各建了一个实例，pausedUntil 永远是 0。
 */

const silent = { error: () => {} };
const banned = () => new Response("", { status: 418, headers: { "Retry-After": "600" } });

describe("币安限流闸门", () => {
  it("★ 被封之后一个包都不发（不是靠对方拒绝，是自己根本不发）", async () => {
    const fetchMock = vi.fn(async () => banned());
    const gate = createRateLimitGate({ fetch: fetchMock, logger: silent });

    await expect(gate.fetch("https://fapi.binance.com/x")).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 50; i++) {
      await expect(gate.fetch("https://fapi.binance.com/x")).rejects.toBeInstanceOf(AppError);
    }
    // 关键：50 次全被闸门挡下，没有一次真的打到币安——继续撞会把封禁越撞越久
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gate.pausedForMs()).toBeGreaterThan(0);
  });

  it("★ 同一道闸门下，所有调用方一起停：行情拉快照撞出来的封禁，分层表同步也得认", async () => {
    const fetchMock = vi.fn(async () => banned());
    const gate = createRateLimitGate({ fetch: fetchMock, logger: silent });
    // 行情层的客户端
    const rest = createBinanceRest({ gate, logger: silent });
    // 分层表同步那种直接拿 gate.fetch 用的调用方
    const otherCaller = gate.fetch;

    await expect(rest.depthSnapshot({ symbol: "BTCUSDT", limit: 500 })).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 另一个调用方立刻也被挡住，不会自己再去撞一次
    await expect(otherCaller("https://fapi.binance.com/fapi/v1/leverageBracket")).rejects.toBeInstanceOf(AppError);
    await expect(rest.klines({ symbol: "BTCUSDT", interval: "1m", limit: 10 })).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("★ 各建各的闸门就等于没装（2026-09-20 的原始 bug，留着当反例）", async () => {
    const fetchMock = vi.fn(async () => banned());
    const make = () => createRateLimitGate({ fetch: fetchMock, logger: silent });

    for (let i = 0; i < 10; i++) {
      await expect(make().fetch("https://fapi.binance.com/x")).rejects.toBeInstanceOf(AppError);
    }
    // 每次都是新实例 → pausedUntil 永远是 0 → 10 次全打到了币安
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("暂停到期之后恢复放行", async () => {
    let clock = 0;
    let status = 418;
    const fetchMock = vi.fn(async () =>
      status === 418 ? banned() : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const gate = createRateLimitGate({ fetch: fetchMock, now: () => clock, logger: silent });

    await expect(gate.fetch("https://fapi.binance.com/x")).rejects.toBeInstanceOf(AppError);
    clock += 599_000;
    await expect(gate.fetch("https://fapi.binance.com/x")).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 还在暂停里

    clock += 2_000; // 过了 Retry-After 的 600 秒
    status = 200;
    expect((await gate.fetch("https://fapi.binance.com/x")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gate.pausedForMs()).toBe(0);
  });
});
