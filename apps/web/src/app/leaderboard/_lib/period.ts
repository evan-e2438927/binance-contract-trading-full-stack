import type { Route } from "next";

import type { LeaderboardPeriod } from "@/server-api-module/leaderboard/types";

/**
 * 排行榜页的 URL 参数（B-01 周期）。和历史记录页一样：
 * 状态写进网址，刷新和分享都保得住；认不出来的参数当成没传。
 */

export const PERIODS = [
  { value: "daily", label: "日榜", hint: "最近 1 天" },
  { value: "weekly", label: "周榜", hint: "最近 7 天" },
  { value: "all", label: "总榜", hint: "从上次重置算起" },
] as const satisfies readonly { value: LeaderboardPeriod; label: string; hint: string }[];

/** 打开页面默认看总榜：日榜周榜要有快照才有内容，总榜最不容易空 */
export const DEFAULT_PERIOD: LeaderboardPeriod = "all";

export interface LeaderboardQuery {
  period: LeaderboardPeriod;
}

interface ParamsLike {
  get(key: string): string | null;
}

const PERIOD_VALUES = PERIODS.map((p) => p.value) as readonly string[];

export function parseLeaderboardQuery(params: ParamsLike): LeaderboardQuery {
  const rawPeriod = params.get("period");
  const period =
    rawPeriod !== null && PERIOD_VALUES.includes(rawPeriod) ? (rawPeriod as LeaderboardPeriod) : DEFAULT_PERIOD;

  return { period };
}

/** 状态 → 链接。默认值不写进 URL */
export function leaderboardHref(query: LeaderboardQuery): Route {
  const params = new URLSearchParams();
  if (query.period !== DEFAULT_PERIOD) params.set("period", query.period);
  const search = params.toString();
  // Next 16 的类型化路由推不出带查询串的模板字面量，断言收在这一处
  return (search ? `/leaderboard?${search}` : "/leaderboard") as Route;
}
