import * as Sentry from "@sentry/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSentry } from "../../../../apps/server/src/observability/sentry";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initSentry", () => {
  it("AC-004 (happy-path): 传入 dsn 时 Sentry.init 调用 1 次，隐私与采样参数正确", () => {
    const reporter = initSentry({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "production", release: "r1" });
    expect(reporter).not.toBeNull();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    expect((options as Record<string, unknown>).sendDefaultPii).toBe(false);
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(options.tracesSampleRate).toBe(0);
    expect(options.defaultIntegrations).toBeUndefined();
    expect(options.environment).toBe("production");
    expect(options.release).toBe("r1");
    expect(typeof options.beforeSend).toBe("function");
  });

  it("AC-004 (security): beforeSend 调用脱敏，邮箱被替换、认证头被删除", () => {
    initSentry({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "test" });
    const options = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    const event = {
      message: "failed for alice@example.com",
      request: { headers: { Authorization: "Bearer x", "User-Agent": "ua" } },
    };
    const result = options.beforeSend!(event as never, {}) as unknown as typeof event;
    expect(result.message).toBe("failed for [email]");
    expect(result.request.headers).toEqual({ "User-Agent": "ua" });
  });

  it("AC-004 (error): 脱敏失败（返回 null）时 beforeSend 丢弃事件", () => {
    initSentry({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "test" });
    const options = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    const broken = { exception: { values: {} } };
    expect(options.beforeSend!(broken as never, {})).toBeNull();
  });

  it.each([undefined, ""])("AC-005 (boundary): dsn 为 %j 时返回 null 且不调用 Sentry.init", (dsn) => {
    expect(initSentry({ dsn, environment: "test" })).toBeNull();
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});

describe("ErrorReporter", () => {
  const make = () => initSentry({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "test" })!;

  it("AC-001a (happy-path): report 调用 captureException 1 次，只带 method、path 两个 tag", () => {
    const err = new Error("boom");
    make().report(err, { method: "GET", path: "/orders" });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { method: "GET", path: "/orders" } });
  });

  it("AC-007 (error): captureException 抛出时 report 不向外抛", () => {
    vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    expect(() => make().report(new Error("x"), { method: "GET", path: "/x" })).not.toThrow();
  });

  it("AC-006 (boundary): flush 把超时时间传给 Sentry.flush；flush 抛错时不向外抛", async () => {
    const reporter = make();
    await reporter.flush(2000);
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
    vi.mocked(Sentry.flush).mockRejectedValueOnce(new Error("net"));
    await expect(reporter.flush(2000)).resolves.toBeUndefined();
  });
});
