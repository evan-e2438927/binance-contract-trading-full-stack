import { describe, expect, it } from "vitest";

import { KLINE_INTERVALS } from "@/server-api-module/market/types";

import { intervalOf, resolutionOf, SUPPORTED_RESOLUTIONS } from "./tv-resolution";

describe("周期互转", () => {
  it("分钟是纯数字、小时换算成分钟", () => {
    expect(resolutionOf("1m")).toBe("1");
    expect(resolutionOf("1h")).toBe("60");
    expect(resolutionOf("4h")).toBe("240");
  });

  it("1M 是一个月，不是一分钟", () => {
    expect(resolutionOf("1M")).toBe("1M");
    expect(intervalOf("1M")).toBe("1M");
    expect(intervalOf("1")).toBe("1m");
  });

  it("每个币安周期都能转回来", () => {
    for (const interval of KLINE_INTERVALS) {
      expect(intervalOf(resolutionOf(interval))).toBe(interval);
    }
  });

  it("不支持的周期返回 null", () => {
    expect(intervalOf("45")).toBeNull();
    expect(intervalOf("")).toBeNull();
  });

  it("支持列表和币安周期一一对应", () => {
    expect(SUPPORTED_RESOLUTIONS).toHaveLength(KLINE_INTERVALS.length);
  });
});
