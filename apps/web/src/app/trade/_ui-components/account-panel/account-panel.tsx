"use client";

import { parse } from "@binance-contract-trading-full-stack/shared";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { DirectionText } from "@/components/direction-text";
import { formatRatioAsPercent, formatUsdt, PLACEHOLDER } from "@/lib/format/number";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { ResetAccountDialog } from "../../../_shared/ui-components/reset-account-dialog";

/**
 * T-08 账户概览（Figma 4:5824）。
 *
 * 所有数都用服务端给的，不在前端算（强平价、可用余额、保证金率的口径必须和风控一致）。
 * 有仓位但缺标记价时（`missingMarkPrices` 非空）相关项显示 `--` 并说明原因，不拿 0 顶替。
 */
export function AccountPanel() {
  const status = useAuthStore((s) => s.status);
  const account = useAccountStore((s) => s.account);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);
  const [resetOpen, setResetOpen] = useState(false);

  if (status !== "authenticated") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-3.5 text-center">
        <p className="text-[12px] text-muted-foreground">登录后领取 10,000 USDT 模拟资金</p>
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="rounded-[5px] bg-brand px-4 py-1.5 font-bold text-[12px] text-black"
        >
          登录 / 注册
        </button>
      </div>
    );
  }

  const missing = account?.missingMarkPrices ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[12px] text-foreground leading-[18px]">账户（USDT）</span>
        <button
          type="button"
          onClick={() => setResetOpen(true)}
          className="rounded-[4px] border px-2 py-0.5 text-[11px] text-muted-foreground leading-[16.5px] hover:border-brand/60 hover:text-foreground"
        >
          重置
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-3">
        <Row label="钱包余额" value={formatUsdt(account?.walletBalance)} />
        <Row label="保证金余额" value={formatUsdt(account?.marginBalance)} />
        <Row label="可用余额" value={formatUsdt(account?.availableBalance)} />
        <Row
          label="未实现盈亏"
          value={
            <DirectionText value={account?.unrealizedPnl}>
              {formatUsdt(account?.unrealizedPnl, { signed: true })}
            </DirectionText>
          }
        />
        <Row label="维持保证金" value={formatUsdt(account?.totalMaintMargin)} muted />
        <Row label="委托冻结" value={formatUsdt(account?.openOrderMargin)} muted />
        <MarginRatio ratio={account?.marginRatio ?? null} />
      </div>

      {missing.length > 0 && (
        <p className="pt-3 text-[10px] text-muted-foreground leading-[15px]">
          {missing.join("、")} 还没有标记价，带 {PLACEHOLDER} 的几项暂时算不出来。
        </p>
      )}

      <ResetAccountDialog open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground leading-[16.5px]">{label}</span>
      <span
        className={cn(
          "num font-medium font-mono text-[12px] leading-[18px]",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** 保证金比率：越高越危险，80% 以上变红；到 100% 触发强平 */
function MarginRatio({ ratio }: { ratio: string | null }) {
  const percentNum = ratio ? Math.min(100, Number((parse(ratio) * 100n) / 100_000_000n)) : 0;
  const danger = percentNum >= 80;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground leading-[16.5px]">保证金比率</span>
        <span
          className={cn("num font-mono text-[12px] leading-[18px]", danger ? "text-down" : "text-up")}
          title="维持保证金 ÷ 保证金余额，达到 100% 触发强平"
        >
          {formatRatioAsPercent(ratio, { signed: false })}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-[2px] bg-background">
        <div className={cn("h-1 rounded-[2px]", danger ? "bg-down" : "bg-up")} style={{ width: `${percentNum}%` }} />
      </div>
    </div>
  );
}
