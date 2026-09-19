import type { Decimal } from "../common/types";

/**
 * 排行榜模块（/leaderboard，不用登录；带 token 时额外返回自己的名次）的 DTO。
 * 来源：apps/server/src/api/leaderboard.ts。口径：数据截至最近一次权益快照（UTC 00:00）。
 */

/** 统计周期：daily 近 1 天 · weekly 近 7 天 · all 从上次重置起 */
export type LeaderboardPeriod = "daily" | "weekly" | "all";

/** 排行榜的一行 */
export interface LeaderboardItem {
  /** 名次；收益率相同名次相同 */
  rank: number;
  /** 昵称；库里允许为 null */
  nickname: string | null;
  /** 统计期内收益率，比例（0.12 = 12%） */
  roi: Decimal;
  /** 快照时的权益（USDT） */
  equity: Decimal;
  /** 胜率 = 盈利的平仓成交 ÷ 平仓成交，比例；没有平仓成交时为 null（不是 0%） */
  winRate: Decimal | null;
  /** 统计期内全部成交笔数 */
  tradeCount: number;
}

/** GET /leaderboard 响应 */
export interface Leaderboard {
  /** 统计周期 */
  period: LeaderboardPeriod;
  /** 数据截至哪天的快照（UTC，"YYYY-MM-DD"）；还没拍过快照时为 null，榜单为空 */
  asOf: string | null;
  /** 统计期起点（UTC，"YYYY-MM-DD"）；period = all 或没有快照时为 null */
  since: string | null;
  /** 榜单，按名次升序 */
  items: LeaderboardItem[];
  /** 自己的名次；没登录或没上榜时为 null */
  myRank: LeaderboardItem | null;
}
