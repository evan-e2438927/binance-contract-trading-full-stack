import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init, captureException: vi.fn() }));

describe("instrumentation-client", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("AC-013a: DSN 为空时 Sentry.init 调用 0 次", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    await import("../../../apps/web/src/instrumentation-client");
    expect(init).toHaveBeenCalledTimes(0);
  });

  it("DSN 非空时以 buildSentryClientOptions 的结果 init 1 次，allowUrls 取当前 origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://pub@o0.ingest.sentry.io/0");
    await import("../../../apps/web/src/instrumentation-client");
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]?.[0];
    expect(options.dsn).toBe("https://pub@o0.ingest.sentry.io/0");
    expect(options.allowUrls).toEqual([window.location.origin]);
    expect(options.tracesSampleRate).toBe(0);
  });
});
