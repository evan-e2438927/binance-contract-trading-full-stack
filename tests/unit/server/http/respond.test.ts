import { AppError } from "@binance-contract-trading-full-stack/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../../../../apps/server/src/http/respond";

const INTERNAL_BODY = { ok: false, error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试" } };

type Report = (e: unknown, ctx: { method: string; path: string }) => void;

function build(thrown: unknown, logger: Pick<Console, "error"> = { error: vi.fn() }, reportError?: Report) {
  const app = new Hono();
  app.onError(createErrorHandler(logger, reportError));
  app.get("/x", () => {
    throw thrown;
  });
  return { app };
}

describe("createErrorHandler", () => {
  it("AC-001 (happy-path): 意外错误返回 500 + INTERNAL_ERROR，reportError 调用 1 次且 path 不含查询串", async () => {
    const reportError = vi.fn<Report>();
    const err = new Error("boom");
    const { app } = build(err, undefined, reportError);
    const res = await app.request("/x?token=secret");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(INTERNAL_BODY);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(err, { method: "GET", path: "/x" });
  });

  it.each([
    ["INVALID_PARAMS", 400],
    ["UNAUTHORIZED", 401],
  ] as const)("AC-002 (error): AppError(%s) 返回 %i，不上报", async (code, status) => {
    const reportError = vi.fn<Report>();
    const { app } = build(new AppError(code, "x"), undefined, reportError);
    const res = await app.request("/x");
    expect(res.status).toBe(status);
    expect(reportError).not.toHaveBeenCalled();
  });

  it.each(["MARKET_NOT_READY", "SERVICE_UNAVAILABLE"] as const)("AC-003 (boundary): AppError(%s) 返回 503，不上报", async (code) => {
    const reportError = vi.fn<Report>();
    const { app } = build(new AppError(code, "x"), undefined, reportError);
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("AC-007a (error): reportError 自己抛异常时响应不变，logger.error 额外记录 1 次", async () => {
    const reportError = vi.fn<Report>(() => {
      throw new Error("sentry down");
    });
    const logger = { error: vi.fn() };
    const { app } = build(new Error("boom"), logger, reportError);
    const res = await app.request("/x");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(INTERNAL_BODY);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("AC-005a (boundary): 不传 reportError 时与改动前一致，只记 1 次日志", async () => {
    const logger = { error: vi.fn() };
    const { app } = build(new Error("boom"), logger);
    const res = await app.request("/x");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(INTERNAL_BODY);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
