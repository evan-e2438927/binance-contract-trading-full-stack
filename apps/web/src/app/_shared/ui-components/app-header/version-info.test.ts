import { describe, expect, it } from "vitest";

import { formatUptime } from "./version-info";

describe("formatUptime", () => {
  // AC-007b：uptime 为 0 时显示 "0分钟"，不是 "—"
  it("0 秒 → 0分钟", () => {
    expect(formatUptime(0)).toBe("0分钟");
  });

  it("不足 1 分钟 → 0分钟", () => {
    expect(formatUptime(59)).toBe("0分钟");
  });

  it("恰好 1 分钟 → 1分钟", () => {
    expect(formatUptime(60)).toBe("1分钟");
  });

  it("不足 1 小时（3599s）→ 59分钟", () => {
    expect(formatUptime(3599)).toBe("59分钟");
  });

  it("恰好 1 小时 → 1小时0分钟", () => {
    expect(formatUptime(3600)).toBe("1小时0分钟");
  });

  it("不足 1 天（86399s）→ 23小时59分钟", () => {
    expect(formatUptime(86399)).toBe("23小时59分钟");
  });

  it("恰好 1 天 → 1天0小时0分钟", () => {
    expect(formatUptime(86400)).toBe("1天0小时0分钟");
  });

  it("跨天大数值（90000s）→ 包含「1天」，不是 NaN/负数", () => {
    const result = formatUptime(90000);
    expect(result).toContain("1天");
    expect(result).not.toContain("NaN");
    expect(result).not.toContain("-");
    expect(result).toBe("1天1小时0分钟");
  });
});
