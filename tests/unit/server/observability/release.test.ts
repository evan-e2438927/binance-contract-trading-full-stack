import { describe, expect, it } from "vitest";
import pkg from "../../../../apps/server/package.json" with { type: "json" };
import { resolveRelease } from "../../../../apps/server/src/observability/release";

describe("resolveRelease", () => {
  it("没配 SENTRY_RELEASE 时用 package.json 的版本号", () => {
    expect(resolveRelease(undefined, "0.1.0")).toBe("server@0.1.0");
  });

  it("SENTRY_RELEASE 是空串时同样回落到版本号", () => {
    expect(resolveRelease("", "0.1.0")).toBe("server@0.1.0");
  });

  it("手动配了 SENTRY_RELEASE 就原样使用", () => {
    expect(resolveRelease("a1b2c3d", "0.1.0")).toBe("a1b2c3d");
  });

  it("默认读取 apps/server/package.json 的 version", () => {
    expect(resolveRelease(undefined)).toBe(`server@${pkg.version}`);
  });
});
