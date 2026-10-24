import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import {
  type PositionBasis,
  pnlAtTrigger,
  roeAtPnl,
  triggerAtPnl,
  triggerDirectionHint,
  triggerPriceOf,
} from "../../../../../../apps/web/src/app/trade/_lib/tpsl-math";

const long: PositionBasis = { entryPrice: "80000", qty: "0.5", isLong: true, initialMargin: "5000" };
const short: PositionBasis = { entryPrice: "80000", qty: "0.5", isLong: false, initialMargin: "5000" };

describe("pnlAtTrigger", () => {
  it("多头：涨到 82,000 赚 1,000", () => {
    expect(format(pnlAtTrigger("82000", long) ?? 0n, 2)).toBe("1000.00");
  });

  it("空头：涨到 82,000 亏 1,000", () => {
    expect(format(pnlAtTrigger("82000", short) ?? 0n, 2)).toBe("-1000.00");
  });

  it("空输入返回 null", () => {
    expect(pnlAtTrigger("", long)).toBeNull();
  });
});

describe("triggerAtPnl", () => {
  it("多头想赚 1,000 → 82,000", () => {
    expect(triggerAtPnl("1000", long, "0.1")).toBe("82000");
  });

  it("空头想赚 1,000 → 78,000", () => {
    expect(triggerAtPnl("1000", short, "0.1")).toBe("78000");
  });

  it("按 tickSize 向下对齐（委托价必须是整数倍）", () => {
    // 多头赚 1，触发价 80,002，tickSize 100 → 80,000
    expect(triggerAtPnl("1", long, "100")).toBe("80000");
  });

  it("算出来 ≤ 0 时返回空串，不给一个负价", () => {
    expect(triggerAtPnl("-100000", long, "0.1")).toBe("");
  });
});

describe("roeAtPnl", () => {
  it("赚 1,000、起始保证金 5,000 → 20%", () => {
    expect(format(roeAtPnl(parse("1000"), long) ?? 0n, 4)).toBe("0.2000");
  });

  it("没有起始保证金时算不了", () => {
    expect(roeAtPnl(parse("1000"), { ...long, initialMargin: null })).toBeNull();
  });
});

describe("triggerPriceOf", () => {
  it("按价格填就原样用", () => {
    expect(triggerPriceOf("82000", "PRICE", long, "0.1")).toBe("82000");
  });

  it("按盈亏填：换算成触发价", () => {
    expect(triggerPriceOf("1000", "PNL", long, "0.1")).toBe("82000");
  });

  it("按回报率填：20 表示 20%，先换成盈亏再反推", () => {
    expect(triggerPriceOf("20", "ROE", long, "0.1")).toBe("82000");
  });

  it("空输入返回空串", () => {
    expect(triggerPriceOf("  ", "PNL", long, "0.1")).toBe("");
  });
});

describe("triggerDirectionHint", () => {
  it("多头止盈填到亏损一侧会提醒", () => {
    expect(triggerDirectionHint("78000", "TP", long)).toContain("方向");
  });

  it("多头止损填到盈利一侧会提醒", () => {
    expect(triggerDirectionHint("82000", "SL", long)).toContain("方向");
  });

  it("方向正确时不提醒", () => {
    expect(triggerDirectionHint("82000", "TP", long)).toBeUndefined();
    expect(triggerDirectionHint("78000", "SL", long)).toBeUndefined();
  });
});
