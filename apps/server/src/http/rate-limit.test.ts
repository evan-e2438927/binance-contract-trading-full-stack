import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";
import { createErrorHandler } from "./respond";

function app(now: () => number) {
  const a = new Hono();
  a.onError(createErrorHandler({ error: () => {} }));
  a.use("*", rateLimit({ name: "t", limit: 3, windowMs: 10_000, key: (c) => c.req.header("X-Key") ?? null, now }));
  a.get("/", (c) => c.text("ok"));
  return a;
}

describe("限流（固定窗口）", () => {
  it("窗口内超过上限返回 429 RATE_LIMITED 和 Retry-After；窗口过了恢复；不同的键各算各的", async () => {
    let t = 1_000_000;
    const a = app(() => t);
    const hit = (key: string) => a.request("/", { headers: { "X-Key": key } });

    for (let i = 0; i < 3; i++) expect((await hit("acc-1")).status).toBe(200);
    const limited = await hit("acc-1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("10");
    expect(((await limited.json()) as any).error.code).toBe("RATE_LIMITED");
    expect((await hit("acc-2")).status).toBe(200);

    t += 9_999;
    expect((await hit("acc-1")).status).toBe(429);
    t += 1;
    expect((await hit("acc-1")).status).toBe(200);
  });

  it("拿不到键（比如取不到 IP）就不限", async () => {
    const a = app(() => 0);
    for (let i = 0; i < 10; i++) expect((await a.request("/")).status).toBe(200);
  });
});
