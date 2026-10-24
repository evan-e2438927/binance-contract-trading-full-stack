import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reportRenderError } from "../../../../../apps/web/src/lib/sentry/report-render-error";

describe("reportRenderError", () => {
  beforeEach(() => {
    captureException.mockReset();
  });

  it("AC-008: 带 digest 时上报 1 次并附 digest tag", () => {
    const error = Object.assign(new Error("x"), { digest: "abc" });
    reportRenderError(error);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { digest: "abc" } });
  });

  it("AC-008a: 无 digest 时上报 1 次且不带 tags", () => {
    reportRenderError(new Error("x"));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("AC-010: captureException 抛错时不向外抛，只 warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    captureException.mockImplementation(() => {
      throw new Error("sdk down");
    });
    expect(() => reportRenderError(new Error("x"))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
