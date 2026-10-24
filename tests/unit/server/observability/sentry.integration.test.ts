// Covers: AC-001b (happy-path / security), AC-002a (error), AC-003a (boundary)
// 真实 initSentry + 真实 createErrorHandler + Hono；仅把 Sentry 的 transport 换成内存收集器。
// 断言作用于「beforeSend 脱敏之后、真正发出之前」的 envelope。
import { AppError } from "@binance-contract-trading-full-stack/shared";
import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../../../../apps/server/src/http/respond";
import { initSentry } from "../../../../apps/server/src/observability/sentry";

const sent: unknown[] = [];

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    init: (options: Record<string, unknown>) =>
      actual.init({
        ...options,
        // 内存传输层：不发网络请求，把 envelope 存下来
        transport: () => ({
          send: async (envelope: unknown) => {
            sent.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
        // 关掉会带来额外 envelope / 网络行为的默认集成，只保留本测试关心的链路
        integrations: [],
        defaultIntegrations: false,
      } as never),
  };
});

const FULL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const MASKED_ADDRESS = "0x1234…5678";
const silentLogger = { error: () => {} };

/** 事件条目：envelope = [header, [[itemHeader, payload], ...]]，只取 event 类型 */
function capturedEvents(): unknown[] {
  return sent.flatMap((envelope) => {
    const items = (envelope as [unknown, [{ type?: string }, unknown][]])[1] ?? [];
    return items.filter(([header]) => header?.type === "event").map(([, payload]) => payload);
  });
}

function buildApp() {
  const reporter = initSentry({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "test" });
  expect(reporter).not.toBeNull();
  const app = new Hono();
  // 模拟 SDK 的 HTTP 集成：把请求头挂到事件上，验证 beforeSend 确实会删掉它们
  app.use("*", (c, next) =>
    Sentry.withIsolationScope((scope) => {
      scope.addEventProcessor((event) => {
        event.request = {
          url: `http://localhost${c.req.path}`,
          headers: {
            Authorization: c.req.header("authorization") ?? "",
            Cookie: c.req.header("cookie") ?? "",
            "User-Agent": "vitest",
          },
        };
        return event;
      });
      return next();
    }),
  );
  app.get("/boom", () => {
    throw new Error(`boom ${FULL_ADDRESS}`);
  });
  app.get("/bad", () => {
    throw new AppError("INVALID_PARAMS");
  });
  app.get("/notready", () => {
    throw new AppError("MARKET_NOT_READY");
  });
  app.onError(createErrorHandler(silentLogger, (error, ctx) => reporter!.report(error, ctx)));
  return { app, reporter: reporter! };
}

let app: Hono;
let reporter: ReturnType<typeof buildApp>["reporter"];

beforeAll(() => {
  ({ app, reporter } = buildApp());
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await Sentry.close(500);
});

describe("server Sentry 装配后行为", () => {
  it("AC-001b (happy-path): 意外异常产生 1 个事件，响应仍为 500 INTERNAL_ERROR", async () => {
    const res = await app.request("/boom?x=1", { headers: { Authorization: "Bearer x", Cookie: "a=b" } });
    await reporter.flush(1000);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试" },
    });
    expect(capturedEvents()).toHaveLength(1);
  });

  it("AC-001b (security): 发出的 envelope 不含 Bearer x、a=b、完整钱包地址，含 0x1234…5678，User-Agent 保留", async () => {
    await app.request("/boom", { headers: { Authorization: "Bearer x", Cookie: "a=b" } });
    await reporter.flush(1000);
    const events = capturedEvents() as { request?: { headers?: Record<string, string> } }[];
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(sent);
    expect(serialized).not.toContain("Bearer x");
    expect(serialized).not.toContain("a=b");
    expect(serialized).not.toContain(FULL_ADDRESS);
    expect(serialized).toContain(MASKED_ADDRESS);
    // 前置：确认模拟的请求头确实挂到了事件上并被脱敏，而不是压根没有
    expect(events[0]!.request?.headers).toEqual({ "User-Agent": "vitest" });
  });

  it("AC-002a (error): AppError(INVALID_PARAMS) 不产生事件", async () => {
    const res = await app.request("/bad");
    await reporter.flush(1000);
    expect(res.status).toBe(400);
    expect(capturedEvents()).toHaveLength(0);
  });

  it("AC-003a (boundary): AppError(MARKET_NOT_READY) 返回 503 且不产生事件", async () => {
    const res = await app.request("/notready");
    await reporter.flush(1000);
    expect(res.status).toBe(503);
    expect(capturedEvents()).toHaveLength(0);
  });
});
