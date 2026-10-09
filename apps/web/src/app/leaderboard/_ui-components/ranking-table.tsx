import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

import { avatarInitial } from "@/app/_shared/ui-components/app-header/account-display";
import { DirectionText } from "@/components/direction-text";
import { LetterAvatar } from "@/components/letter-avatar";
import { formatRatioAsPercent, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import type { LeaderboardItem } from "@/server-api-module/leaderboard/types";

import { isMyRow } from "../_lib/my-row";

/** B-02 收益率榜。前三名给奖牌 emoji，我自己那一行高亮 */
const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const COLS = "grid grid-cols-[52px_minmax(90px,1.4fr)_repeat(4,minmax(74px,1fr))] items-center gap-x-3 px-4";

export function RankingTable({ items, myRank }: { items: LeaderboardItem[]; myRank: LeaderboardItem | null }) {
  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-[12px] text-muted-foreground">
        这一期还没有人上榜（要有成交、而且拍到过权益快照）
      </p>
    );
  }

  return (
    <div className="num overflow-x-auto">
      <div className="min-w-[560px]">
        <div className={cn(COLS, "border-b py-2.5 text-[11px] text-muted-foreground")}>
          <span>排名</span>
          <span>昵称</span>
          <span className="text-right">总收益率</span>
          <span className="text-right">账户权益</span>
          <span className="text-right">胜率</span>
          <span className="text-right">交易次数</span>
        </div>
        {items.map((item, index) => {
          const mine = isMyRow(item, myRank);
          const medal = MEDAL[item.rank];
          return (
            <div
              // 名次会并列（收益率相同就同名次），单独拿它当 key 会重复；这份列表每次整体替换、
              // 不会增删或重排，用下标最稳
              // biome-ignore lint/suspicious/noArrayIndexKey: 榜单整体替换，不增删不重排
              key={index}
              className={cn(
                COLS,
                "border-b py-2.5 text-[12px] last:border-b-0",
                mine ? "bg-brand/8" : "hover:bg-elevated/50",
              )}
            >
              <span className="font-mono text-[14px] text-muted-foreground">{medal ?? `#${item.rank}`}</span>
              <span className="flex items-center gap-2.5 truncate">
                <LetterAvatar text={avatarInitial(item.nickname ?? "")} tone={mine ? "brand" : "flat"} size="sm" />
                <span className="truncate">
                  {item.nickname ?? <span className="text-muted-foreground">未设置昵称</span>}
                  {mine && <span className="ml-1.5 rounded-[3px] bg-brand/20 px-1 text-[10px] text-brand">我</span>}
                </span>
              </span>
              <DirectionText value={item.roi} className="text-right font-mono">
                {formatRatioAsPercent(item.roi)}
              </DirectionText>
              <span className="text-right font-mono">{formatUsdt(item.equity)}</span>
              {/* 没有平仓成交时胜率是 null，显示 "--" 而不是 0% */}
              <span className="text-right font-mono text-muted-foreground">
                {item.winRate === null ? PLACEHOLDER : formatRatioAsPercent(item.winRate, { signed: false })}
              </span>
              <span className="text-right font-mono text-muted-foreground">{item.tradeCount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
