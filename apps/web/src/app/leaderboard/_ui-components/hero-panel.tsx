"use client";

import { useQuery } from "@tanstack/react-query";

import { DirectionText } from "@/components/direction-text";
import { formatRatioAsPercent, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import { equityCurveQuery } from "@/server-api-module/account/queries";
import type { Leaderboard } from "@/server-api-module/leaderboard/types";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { buildCurve } from "../_lib/curve";
import { Sparkline } from "./sparkline";

/**
 * 顶部 hero 卡片（R-001/R-002）。取代原 `MyRank` + `EquityCurvePanel` 的组合职责，三种状态：
 *
 * - 未登录 / 已登录未上榜：文案沿用旧 `MyRank`，只是套进新的渐变金边框卡片外观（ASM-002），
 *   不展示统计区和曲线（没有数据可展示）
 * - 已登录且已上榜：排名 + 四项统计（总收益率/账户权益/胜率/交易次数）+ 固定 30 天 sparkline
 *
 * sparkline 换成了纯展示的迷你曲线（`Sparkline`），原来可切 7/30/90 天、可悬停看数值的
 * `EquityCurvePanel` 整体移除（ASM-001，已征得用户同意）。
 */
export function HeroPanel({ data }: { data: Leaderboard | undefined }) {
  const status = useAuthStore((s) => s.status);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);
  const authed = status === "authenticated";
  const mine = data?.myRank ?? null;

  // 只有会渲染 sparkline（已登录且已上榜）时才发请求，不多打一次接口
  const {
    data: curveData,
    isPending,
    isError,
    error,
  } = useQuery({ ...equityCurveQuery(30), enabled: authed && mine !== null });
  const curve = buildCurve(curveData);

  if (!authed) {
    return (
      <Card>
        <p className="text-[13px] text-muted-foreground">登录后看自己的名次和权益曲线</p>
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="mt-3 self-start rounded-[5px] bg-brand px-4 py-1.5 font-bold text-[12px] text-black"
        >
          登录 / 注册
        </button>
      </Card>
    );
  }

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
      <div className="flex flex-wrap items-center gap-6 lg:flex-nowrap">
        <Stat label="我的排名">
          <span className="font-mono font-bold text-[32px] text-brand leading-none">#{mine.rank}</span>
        </Stat>

        <div className="hidden h-[60px] w-px shrink-0 bg-border sm:block" />

        <div className="flex flex-1 flex-wrap gap-x-8 gap-y-3">
          <Stat label="总收益率">
            <DirectionText value={mine.roi} className="font-mono font-bold text-[18px]">
              {formatRatioAsPercent(mine.roi)}
            </DirectionText>
          </Stat>
          <Stat label="账户权益">
            <span className="font-mono font-bold text-[18px] text-foreground">{formatUsdt(mine.equity)}</span>
          </Stat>
          <Stat label="胜率">
            <span className="font-mono font-bold text-[18px] text-foreground">
              {mine.winRate === null ? PLACEHOLDER : formatRatioAsPercent(mine.winRate, { signed: false })}
            </span>
          </Stat>
          <Stat label="交易次数">
            <span className="font-mono font-bold text-[18px] text-foreground">{mine.tradeCount}</span>
          </Stat>
        </div>

        <div className="w-full shrink-0 sm:w-[240px] lg:w-[320px]">
          <p className="text-[11px] text-muted-foreground">权益曲线（30 天）</p>
          <div className="pt-1.5">
            {isPending ? (
              <SparkNote>加载中…</SparkNote>
            ) : isError ? (
              <SparkNote>{error.message}</SparkNote>
            ) : curve === null ? (
              <SparkNote>还没有权益快照</SparkNote>
            ) : (
              <Sparkline curve={curve} />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-brand/30 bg-gradient-to-b from-brand/10 to-brand/[0.03] px-6 py-5">
      {children}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SparkNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[11px] text-muted-foreground">{children}</p>;
}
