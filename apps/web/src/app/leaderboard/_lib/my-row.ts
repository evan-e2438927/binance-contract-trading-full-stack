import type { LeaderboardItem } from "@/server-api-module/leaderboard/types";

/**
 * 榜单里哪一行是我自己的（B-02 要高亮）。
 *
 * 接口把「我的名次」单独给一份，没给账户 id，所以只能按内容比。名次会并列，
 * 光比名次会把同名次的别人也高亮，所以三样都比上：名次 + 权益 + 成交笔数。
 * 万一真撞上（同名次、权益和笔数一模一样），最多多高亮一行，不影响数据本身。
 */
export function isMyRow(item: LeaderboardItem, myRank: LeaderboardItem | null): boolean {
  if (!myRank) return false;
  return item.rank === myRank.rank && item.equity === myRank.equity && item.tradeCount === myRank.tradeCount;
}
