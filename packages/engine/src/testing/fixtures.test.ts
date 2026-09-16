import { mul } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { BTCUSDT_BRACKETS } from "./fixtures";

describe("测试夹具", () => {
  // 夹具本身抄错了，后面所有强平价测试都会建立在错数字上，所以夹具也要测
  it("BTCUSDT 分层表：相邻层首尾相接，边界上维持保证金相等", () => {
    for (let i = 0; i < BTCUSDT_BRACKETS.length - 1; i++) {
      const lower = BTCUSDT_BRACKETS[i]!;
      const upper = BTCUSDT_BRACKETS[i + 1]!;
      const n = lower.notionalCap;

      expect(upper.notionalFloor, `第 ${upper.bracketNum} 层下限`).toBe(lower.notionalCap);
      expect(mul(n, lower.mmr) - lower.cum, `第 ${lower.bracketNum}/${upper.bracketNum} 层边界`).toBe(
        mul(n, upper.mmr) - upper.cum,
      );
    }
  });
});
