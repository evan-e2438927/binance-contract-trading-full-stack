import { describe, expect, it } from "vitest";

import { nextDirection } from "../../../../apps/web/src/hooks/use-price-direction";

describe("nextDirection", () => {
  it("比上一笔高是 up、低是 down", () => {
    expect(nextDirection("80715.1", "80715.2", "flat")).toBe("up");
    expect(nextDirection("80715.1", "80715.0", "up")).toBe("down");
  });

  it("价格没变保持上一次的方向", () => {
    expect(nextDirection("80715.1", "80715.1", "down")).toBe("down");
  });

  it("按数值比，不按字符串比", () => {
    expect(nextDirection("9.9", "10.0", "flat")).toBe("up");
    expect(nextDirection("100", "99.99999999", "flat")).toBe("down");
  });

  it("没有上一笔或新价为空时不变", () => {
    expect(nextDirection(null, "1", "flat")).toBe("flat");
    expect(nextDirection("1", null, "up")).toBe("up");
  });
});
