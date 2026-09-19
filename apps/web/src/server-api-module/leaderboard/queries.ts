import { queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";

import type { Leaderboard, LeaderboardPeriod } from "./types";

/** 排行榜的 queryKey */
export const leaderboardKeys = {
  all: ["leaderboard"] as const,
  list: (period: LeaderboardPeriod) => [...leaderboardKeys.all, period] as const,
};

/** GET /leaderboard：前 limit 名（1～100）；带 token 时多返回自己的名次 */
export const fetchLeaderboard = (period: LeaderboardPeriod = "all", limit = 100) =>
  request.get<Leaderboard>("/leaderboard", { period, limit });

/** 排行榜 */
export const leaderboardQuery = (period: LeaderboardPeriod) =>
  queryOptions({ queryKey: leaderboardKeys.list(period), queryFn: () => fetchLeaderboard(period) });
