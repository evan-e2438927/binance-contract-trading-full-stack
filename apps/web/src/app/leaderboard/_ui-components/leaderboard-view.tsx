"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { leaderboardQuery } from "@/server-api-module/leaderboard/queries";

import { type CurveDays, leaderboardHref, parseLeaderboardQuery } from "../_lib/period";
import { EquityCurvePanel } from "./equity-curve-panel";
import { MyRank } from "./my-rank";
import { PeriodTabs } from "./period-tabs";
import { RankingTable } from "./ranking-table";
import { RulesNote } from "./rules-note";

/**
 * B 排行榜页（M11）。榜单公开，不用登录；「我的排名」和「权益曲线」要登录。
 *
 * 周期和曲线天数写进 URL，刷新和分享都保得住（和历史记录页同一套做法）。
 */
export function LeaderboardView() {
  const router = useRouter();
  const params = useSearchParams();
  const query = parseLeaderboardQuery(params);
  const { data, isPending, isError, error, refetch } = useQuery(leaderboardQuery(query.period));

  const go = (next: Partial<typeof query>) => router.replace(leaderboardHref({ ...query, ...next }), { scroll: false });

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <h1 className="font-semibold text-[18px] text-foreground">排行榜</h1>

        <div className="flex flex-col rounded-[8px] border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 pr-4">
            <PeriodTabs period={query.period} onChange={(period) => go({ period })} />
            {/* 设计稿写的是「每 30 分钟更新一次」，那是错的：榜单跟着每日快照走（用户 2026-09-19 定） */}
            <span className="py-2 text-[11px] text-muted-foreground">
              {data?.asOf ? `数据截至 ${data.asOf}（每日 UTC 00:00 快照）` : "每日 UTC 00:00 拍一次权益快照"}
            </span>
          </div>

          {isPending ? (
            <p className="py-16 text-center text-[12px] text-muted-foreground">加载中…</p>
          ) : isError ? (
            <div className="flex flex-col items-center py-16">
              {/* 服务端的中文原因原样显示 */}
              <p className="text-[12px] text-down">{error.message}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 rounded-[4px] border px-3 py-1 text-[12px] text-muted-foreground hover:border-brand/60 hover:text-brand"
              >
                重试
              </button>
            </div>
          ) : (
            <RankingTable items={data.items} myRank={data.myRank} />
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <MyRank data={data} />
        <EquityCurvePanel days={query.days} onDaysChange={(days: CurveDays) => go({ days })} />
        <RulesNote />
      </aside>
    </div>
  );
}
