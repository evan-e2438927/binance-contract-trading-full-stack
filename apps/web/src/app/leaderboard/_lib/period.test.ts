import { describe, expect, it } from "vitest";

import { DEFAULT_DAYS, DEFAULT_PERIOD, leaderboardHref, parseLeaderboardQuery } from "./period";

const params = (search: string) => new URLSearchParams(search);

describe("parseLeaderboardQuery", () => {
  it("没有参数时用默认值", () => {
    expect(parseLeaderboardQuery(params(""))).toEqual({ period: DEFAULT_PERIOD, days: DEFAULT_DAYS });
  });

  it("认得出三个周期", () => {
    expect(parseLeaderboardQuery(params("period=daily")).period).toBe("daily");
    expect(parseLeaderboardQuery(params("period=weekly")).period).toBe("weekly");
  });

  it("不认识的周期退回默认值", () => {
    expect(parseLeaderboardQuery(params("period=monthly")).period).toBe(DEFAULT_PERIOD);
  });

  it("天数只收 7 / 30 / 90，别的当成没传", () => {
    expect(parseLeaderboardQuery(params("days=7")).days).toBe(7);
    expect(parseLeaderboardQuery(params("days=365")).days).toBe(DEFAULT_DAYS);
    expect(parseLeaderboardQuery(params("days=abc")).days).toBe(DEFAULT_DAYS);
  });
});

describe("leaderboardHref", () => {
  it("默认值不写进 URL", () => {
    expect(leaderboardHref({ period: DEFAULT_PERIOD, days: DEFAULT_DAYS })).toBe("/leaderboard");
  });

  it("带上周期和天数", () => {
    expect(leaderboardHref({ period: "daily", days: 90 })).toBe("/leaderboard?period=daily&days=90");
  });

  it("转一圈回到原样", () => {
    const href = leaderboardHref({ period: "weekly", days: 7 });
    expect(parseLeaderboardQuery(params(href.split("?")[1] ?? ""))).toEqual({ period: "weekly", days: 7 });
  });
});
