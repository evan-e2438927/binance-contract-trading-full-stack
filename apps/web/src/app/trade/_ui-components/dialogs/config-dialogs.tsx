"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { formatUsdt } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import { setPositionMode } from "@/server-api-module/account/mutations";
import { accountKeys } from "@/server-api-module/account/queries";
import type { SymbolConfig } from "@/server-api-module/account/types";
import type { MarginMode, PositionMode } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { setLeverage, setMarginMode } from "@/server-api-module/position/mutations";
import { useAccountStore } from "@/stores/account-store";

/**
 * T-09 调整杠杆 / T-10 保证金模式 / G-07 持仓模式（设计稿没画这三个，先用基础样式，功能按 08 做）。
 *
 * 三个都是"改完立刻生效"的账户设置：成功后失效 symbol-config 缓存，面板上的按钮跟着变。
 * 锁定规则（有持仓 / 挂单时不能切）由服务端判，这里把服务端的中文原因原样显示。
 */

function DialogShell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[360px] gap-4 rounded-[10px] border bg-elevated p-6 ring-0 sm:max-w-[360px]">
        <DialogTitle className="font-bold text-[15px] text-foreground">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function useApply(symbol: string, onDone: () => void) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const apply = async (run: () => Promise<unknown>, successText: string) => {
    setPending(true);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: accountKeys.symbolConfig(symbol) });
      notify.success(successText);
      onDone();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };
  return { pending, apply };
}

/** T-09 调整杠杆：滑块 + 输入框，显示这个杠杆下的最大可开名义价值 */
export function LeverageDialog({
  open,
  onOpenChange,
  spec,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: SymbolSpec;
  config: SymbolConfig;
}) {
  const [value, setValue] = useState(config.leverage);
  const { pending, apply } = useApply(spec.symbol, () => onOpenChange(false));
  const max = config.maxLeverage;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="调整杠杆">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{spec.symbol} 永续</span>
        <span className="num font-bold font-mono text-[18px] text-foreground">{value}x</span>
      </div>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-brand"
        aria-label="杠杆倍数"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>1x</span>
        <span>{max}x</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        当前杠杆下最大可开 <span className="num font-mono text-foreground">{formatUsdt(config.maxNotional)} USDT</span>
        。杠杆越高，强平价离开仓价越近。
      </p>
      <Button
        disabled={pending || value === config.leverage}
        onClick={() => apply(() => setLeverage(spec.symbol, value), `杠杆已调整为 ${value}x`)}
      >
        确认
      </Button>
    </DialogShell>
  );
}

/** T-10 保证金模式：全仓 / 逐仓 */
export function MarginModeDialog({
  open,
  onOpenChange,
  symbol,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  current: MarginMode;
}) {
  const [value, setValue] = useState<MarginMode>(current);
  const { pending, apply } = useApply(symbol, () => onOpenChange(false));

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="保证金模式">
      <Choice
        options={[
          {
            value: "CROSS" as const,
            label: "全仓",
            hint: "整个账户的余额都给这个仓位垫着，不容易被强平，但爆的时候是全账户",
          },
          { value: "ISOLATED" as const, label: "逐仓", hint: "亏损最多是这个仓位的保证金，其余资金不受影响" },
        ]}
        value={value}
        onChange={setValue}
      />
      <p className="text-[11px] text-muted-foreground">该币对有持仓或挂单时不能切换。</p>
      <Button
        disabled={pending || value === current}
        onClick={() => apply(() => setMarginMode(symbol, value), `已切换为${value === "CROSS" ? "全仓" : "逐仓"}`)}
      >
        确认
      </Button>
    </DialogShell>
  );
}

/** G-07 持仓模式：单向 / 双向（账户级，不分币对） */
export function PositionModeDialog({
  open,
  onOpenChange,
  symbol,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  current: PositionMode;
}) {
  const [value, setValue] = useState<PositionMode>(current);
  const { pending, apply } = useApply(symbol, () => onOpenChange(false));
  const hydrate = useAccountStore((s) => s.hydrate);

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="持仓模式">
      <Choice
        options={[
          { value: "ONE_WAY" as const, label: "单向持仓", hint: "一个币对只有一个方向的仓位，反向下单会先平后开" },
          { value: "HEDGE" as const, label: "双向持仓", hint: "多头、空头各一个仓位，可以同时持有" },
        ]}
        value={value}
        onChange={setValue}
      />
      <p className="text-[11px] text-muted-foreground">
        账户有任何持仓或挂单时不能切换（账户级设置，对所有币对生效）。
      </p>
      <Button
        disabled={pending || value === current}
        onClick={() =>
          apply(
            async () => {
              await setPositionMode(value);
              await hydrate();
            },
            `已切换为${value === "ONE_WAY" ? "单向持仓" : "双向持仓"}`,
          )
        }
      >
        确认
      </Button>
    </DialogShell>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[6px] border p-3 text-left transition-colors",
            option.value === value ? "border-brand bg-surface" : "hover:border-brand/50",
          )}
        >
          <div className="font-semibold text-[13px] text-foreground">{option.label}</div>
          <div className="pt-1 text-[11px] text-muted-foreground leading-[16px]">{option.hint}</div>
        </button>
      ))}
    </div>
  );
}
