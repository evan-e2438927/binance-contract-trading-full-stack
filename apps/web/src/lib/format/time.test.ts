import { describe, expect, it } from "vitest";

import { formatCountdown } from "./time";

describe("formatCountdown", () => {
  it("时:分:秒，负数归零", () => {
    expect(formatCountdown(3 * 3600_000 + 42 * 60_000 + 15_000)).toBe("03:42:15");
    expect(formatCountdown(-1)).toBe("00:00:00");
  });
});
