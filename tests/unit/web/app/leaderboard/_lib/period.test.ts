import { describe, expect, it } from "vitest";

import { DEFAULT_PERIOD, leaderboardHref, parseLeaderboardQuery } from "../../../../../../apps/web/src/app/leaderboard/_lib/period";

const params = (search: string) => new URLSearchParams(search);

describe("parseLeaderboardQuery", () => {
  it("没有参数时用默认值", () => {
    expect(parseLeaderboardQuery(params(""))).toEqual({ period: DEFAULT_PERIOD });
  });

  it("认得出三个周期", () => {
    expect(parseLeaderboardQuery(params("period=daily")).period).toBe("daily");
    expect(parseLeaderboardQuery(params("period=weekly")).period).toBe("weekly");
  });

  it("不认识的周期退回默认值", () => {
    expect(parseLeaderboardQuery(params("period=monthly")).period).toBe(DEFAULT_PERIOD);
  });

  it("历史遗留的 days 参数被静默忽略，不影响 period 解析", () => {
    expect(parseLeaderboardQuery(params("period=daily&days=90"))).toEqual({ period: "daily" });
  });
});

describe("leaderboardHref", () => {
  it("默认值不写进 URL", () => {
    expect(leaderboardHref({ period: DEFAULT_PERIOD })).toBe("/leaderboard");
  });

  it("带上周期", () => {
    expect(leaderboardHref({ period: "daily" })).toBe("/leaderboard?period=daily");
  });

  it("转一圈回到原样", () => {
    const href = leaderboardHref({ period: "weekly" });
    expect(parseLeaderboardQuery(params(href.split("?")[1] ?? ""))).toEqual({ period: "weekly" });
  });
});
