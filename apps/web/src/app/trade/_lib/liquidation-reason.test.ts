import { describe, expect, it } from "vitest";

import { liquidationReasonTitle } from "./liquidation-reason";

describe("liquidationReasonTitle", () => {
  it("AC-001 happy-path：MARGIN_SUFFICIENT 返回保证金过于充足的具体文案", () => {
    const title = liquidationReasonTitle("MARGIN_SUFFICIENT", []);
    expect(title).toContain("保证金相对仓位过于充足");
  });

  it("AC-002 happy-path：HEDGE_OFFSET 返回对冲相关文案，且与 MARGIN_SUFFICIENT 不同", () => {
    const hedgeTitle = liquidationReasonTitle("HEDGE_OFFSET", []);
    const marginTitle = liquidationReasonTitle("MARGIN_SUFFICIENT", []);
    expect(hedgeTitle).toContain("对冲");
    expect(hedgeTitle).not.toBe(marginTitle);
  });

  it("AC-003 happy-path：MARK_PRICE_MISSING 且 missingMarkPrices 非空时点名具体币对", () => {
    const title = liquidationReasonTitle("MARK_PRICE_MISSING", ["ETHUSDT"]);
    expect(title).toContain("ETHUSDT");
  });

  it("AC-003 happy-path：多个缺失币对用顿号分隔", () => {
    const title = liquidationReasonTitle("MARK_PRICE_MISSING", ["ETHUSDT", "BTCUSDT"]);
    expect(title).toContain("ETHUSDT、BTCUSDT");
  });

  it("AC-003-boundary：missingMarkPrices 为空数组时只给基础文案，不拼出空列表痕迹", () => {
    const title = liquidationReasonTitle("MARK_PRICE_MISSING", []);
    expect(title).not.toContain("[]");
    expect(title).not.toContain("还缺");
    expect(title).toContain("全仓模式下");
  });

  it("AC-006 ui-state：reason 为 null 时返回 undefined", () => {
    expect(liquidationReasonTitle(null, [])).toBeUndefined();
  });

  it("AC-005 boundary：reason 为 NO_LEGS 时返回非空兜底文案，不抛异常", () => {
    expect(() => liquidationReasonTitle("NO_LEGS", [])).not.toThrow();
    const title = liquidationReasonTitle("NO_LEGS", []);
    expect(title).toBeTruthy();
  });

  it("AC-005 boundary：未识别的字符串值返回非空兜底文案，不抛异常", () => {
    const unknownReason = "SOME_UNKNOWN_REASON" as unknown as Parameters<typeof liquidationReasonTitle>[0];
    expect(() => liquidationReasonTitle(unknownReason, [])).not.toThrow();
    const title = liquidationReasonTitle(unknownReason, []);
    expect(title).toBeTruthy();
  });
});
