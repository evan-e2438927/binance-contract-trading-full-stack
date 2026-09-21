import { describe, expect, it } from "vitest";

import type { LeaderboardItem } from "@/server-api-module/leaderboard/types";

import { isMyRow } from "./my-row";

const row = (over: Partial<LeaderboardItem> = {}): LeaderboardItem => ({
  rank: 3,
  nickname: "我",
  roi: "0.12",
  equity: "11200.00000000",
  winRate: "0.5",
  tradeCount: 8,
  ...over,
});

describe("isMyRow", () => {
  it("没登录 / 没上榜时一行都不高亮", () => {
    expect(isMyRow(row(), null)).toBe(false);
  });

  it("名次、权益、笔数都对上才是我", () => {
    expect(isMyRow(row(), row())).toBe(true);
  });

  it("并列同名次但权益不同的，不是我", () => {
    expect(isMyRow(row({ equity: "9000.00000000" }), row())).toBe(false);
  });

  it("并列同名次、权益也相同但成交笔数不同的，不是我", () => {
    expect(isMyRow(row({ tradeCount: 2 }), row())).toBe(false);
  });
});
