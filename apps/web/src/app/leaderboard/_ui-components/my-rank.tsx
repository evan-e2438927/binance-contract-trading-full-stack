"use client";

import { DirectionText } from "@/components/direction-text";
import { formatRatioAsPercent, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import type { Leaderboard } from "@/server-api-module/leaderboard/types";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * B-03 我的排名。
 *
 * 没上榜时**不猜原因**：接口只给 `myRank: null`，没说是因为没成交、期内重置过，
 * 还是快照没拍到。所以把三种可能都列出来，让用户自己对号——
 * 编一个「因为你期内没有成交」出来，说错了更糟（要服务端加字段才能说准，见 M11 后端可选项）。
 */
export function MyRank({ data }: { data: Leaderboard | undefined }) {
  const status = useAuthStore((s) => s.status);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  if (status !== "authenticated") {
    return (
      <Card>
        <p className="text-[12px] text-muted-foreground">登录后看自己的名次和权益曲线</p>
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="mt-3 rounded-[5px] bg-brand px-4 py-1.5 font-bold text-[12px] text-black"
        >
          登录 / 注册
        </button>
      </Card>
    );
  }

  const mine = data?.myRank;
  if (!mine) {
    return (
      <Card>
        <p className="font-semibold text-[13px] text-foreground">我的排名</p>
        <p className="pt-2 text-[12px] text-muted-foreground leading-[20px]">这一期还没上榜。可能是：</p>
        <ul className="flex flex-col gap-1 pt-1.5 text-[12px] text-muted-foreground leading-[20px]">
          <li>· 这一期还没有成交</li>
          <li>· 这一期重置过账户（重置后不进日榜、周榜）</li>
          <li>· 权益快照还没拍到（每天 UTC 00:00 拍一次）</li>
        </ul>
      </Card>
    );
  }

  return (
    <Card>
      <p className="font-semibold text-[13px] text-foreground">我的排名</p>
      <div className="num flex items-end gap-3 pt-3">
        <span className="font-bold text-[28px] text-brand leading-none">{mine.rank}</span>
        <DirectionText value={mine.roi} className="pb-0.5 font-mono text-[15px]">
          {formatRatioAsPercent(mine.roi)}
        </DirectionText>
      </div>
      <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-3 text-[12px]">
        <dt className="text-muted-foreground">权益</dt>
        <dd className="text-right font-mono text-foreground">{formatUsdt(mine.equity)}</dd>
        <dt className="text-muted-foreground">胜率</dt>
        <dd className="text-right font-mono text-foreground">
          {mine.winRate === null ? PLACEHOLDER : formatRatioAsPercent(mine.winRate, { signed: false })}
        </dd>
        <dt className="text-muted-foreground">成交笔数</dt>
        <dd className="text-right font-mono text-foreground">{mine.tradeCount}</dd>
      </dl>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[8px] border bg-surface p-4">{children}</div>;
}
