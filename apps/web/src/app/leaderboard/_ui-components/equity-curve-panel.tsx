"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";

import { equityCurveQuery } from "@/server-api-module/account/queries";
import { useAuthStore } from "@/stores/auth-store";

import { buildCurve } from "../_lib/curve";
import { CURVE_DAYS, type CurveDays } from "../_lib/period";
import { EquityChart } from "./equity-chart";

/**
 * B-04 我的权益曲线。近 7 / 30 / 90 天的每日快照 + 最右端此刻的实时权益。
 *
 * **缺的日子断开，不插值**：服务端某天没拍到快照，我们就不知道那天权益是多少，
 * 连一条直线过去等于编数字（几何计算在 `_lib/curve.ts`，有测试）。
 */
export function EquityCurvePanel({ days, onDaysChange }: { days: CurveDays; onDaysChange: (days: CurveDays) => void }) {
  const status = useAuthStore((s) => s.status);
  const authed = status === "authenticated";
  const { data, isPending, isError, error } = useQuery({ ...equityCurveQuery(days), enabled: authed });
  const curve = buildCurve(data);

  return (
    <div className="flex flex-col rounded-[8px] border bg-surface">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <p className="font-semibold text-[13px] text-foreground">我的权益曲线</p>
        <div className="flex gap-1">
          {CURVE_DAYS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDaysChange(option)}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[11px] transition-colors",
                option === days ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option} 天
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3">
        {!authed ? (
          <Note>登录后看自己的权益曲线</Note>
        ) : isPending ? (
          <Note>加载中…</Note>
        ) : isError ? (
          <Note>{error.message}</Note>
        ) : curve === null ? (
          <Note>还没有权益快照。快照每天 UTC 00:00 拍一次，开户后第二天开始有</Note>
        ) : (
          <EquityChart curve={curve} />
        )}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="py-14 text-center text-[12px] text-muted-foreground">{children}</p>;
}
