import { describe, expect, it, vi } from "vitest";

import { buildSentryClientOptions } from "../../../../../apps/web/src/lib/sentry/client-options";

const ORIGIN = "https://trade.example.org";
const build = () =>
  buildSentryClientOptions({ dsn: "https://pub@o0.ingest.sentry.io/0", environment: "production", origin: ORIGIN });

describe("buildSentryClientOptions", () => {
  it("AC-011: ignoreErrors 含两种 ResizeObserver 文案，allowUrls 恰为入参 origin", () => {
    const options = build();
    expect(options.ignoreErrors).toContain("ResizeObserver loop limit exceeded");
    expect(options.ignoreErrors).toContain("ResizeObserver loop completed with undelivered notifications");
    expect(options.allowUrls).toEqual([ORIGIN]);
  });

  it("AC-011: denyUrls 命中三种扩展协议，不误伤本站脚本", () => {
    const { denyUrls } = build();
    for (const url of ["chrome-extension://abc/x.js", "moz-extension://abc/x.js", "safari-extension://abc/x.js"]) {
      expect(denyUrls.some((re) => re.test(url))).toBe(true);
    }
    expect(denyUrls.some((re) => re.test(`${ORIGIN}/_next/app.js`))).toBe(false);
  });

  it("AC-004a: 不收 PII、不开 tracing、无 Replay 采样率", () => {
    const options = build() as unknown as Record<string, unknown>;
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
  });

  it("AC-004a (security): v11 已没有 sendDefaultPii，必须用 dataCollection 显式关掉用户信息、Cookie、请求头、请求体、查询串", () => {
    expect(build().dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
  });

  it("AC-004a: beforeSend 走 scrubSentryEvent（脱敏邮箱、删 user），并透传 dsn/environment", () => {
    const options = build();
    expect(options.dsn).toBe("https://pub@o0.ingest.sentry.io/0");
    expect(options.environment).toBe("production");
    const scrubbed = options.beforeSend({ message: "failed for a@b.com", user: { id: "1" } });
    expect(scrubbed?.message).toBe("failed for [email]");
    expect(scrubbed?.user).toBeUndefined();
  });
});

describe("instrumentation-client 依赖的 SENTRY_DSN", () => {
  it("AC-020f: 未设置时为空串", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { SENTRY_DSN } = await import("@/lib/config/env");
    expect(SENTRY_DSN).toBe("");
    vi.unstubAllEnvs();
  });
});
