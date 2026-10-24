import { describe, expect, it } from "vitest";
import { createErrorHandler } from "../../../../apps/server/src/http/respond";
import { createSystemRoutes } from "../../../../apps/server/src/api/system";
import { Hono } from "hono";

function app(now: () => number, startedAt: number) {
  const a = new Hono();
  a.onError(createErrorHandler({ error: () => {} }));
  a.route("/system", createSystemRoutes({ now, startedAt }));
  return a;
}

describe("GET /system/version", () => {
  it("AC-001 (happy-path): 启动 30 秒后返回 version + uptime=30", async () => {
    const startedAt = 1_700_000_000_000;
    const a = app(() => startedAt + 30_000, startedAt);
    const res = await a.request("/system/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true, data: { version: "0.1.0", uptime: 30 } });
  });

  it("AC-002 (error): 路由只注册 GET，POST /system/version 返回 404", async () => {
    const startedAt = 1_700_000_000_000;
    const a = app(() => startedAt, startedAt);
    const res = await a.request("/system/version", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("AC-002 (error, 补充): 404 响应体不泄露 version/uptime 等业务字段", async () => {
    const startedAt = 1_700_000_000_000;
    const a = app(() => startedAt, startedAt);
    const res = await a.request("/system/version", { method: "POST" });
    const text = await res.text();
    expect(text).not.toContain("version");
    expect(text).not.toContain("uptime");
    expect(text).not.toMatch(/"ok"\s*:\s*true/);
  });

  it("AC-003 (boundary): 进程刚启动，uptime 为 0（非负整数）", async () => {
    const startedAt = 1_700_000_000_000;
    const a = app(() => startedAt, startedAt);
    const res = await a.request("/system/version");
    const body = (await res.json()) as any;
    expect(body.data.uptime).toBe(0);
    expect(Number.isInteger(body.data.uptime)).toBe(true);
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
  });

  it("AC-004 (security): 不带 Authorization 头也能访问，data 只含 version、uptime 两个字段", async () => {
    const startedAt = 1_700_000_000_000;
    const a = app(() => startedAt + 5_000, startedAt);
    const res = await a.request("/system/version"); // 不带 Authorization
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Object.keys(body.data).sort()).toEqual(["uptime", "version"]);
  });
});
