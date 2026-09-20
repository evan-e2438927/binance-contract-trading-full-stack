"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { formatUsdt } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import { accountKeys } from "@/server-api-module/account/queries";
import type { SymbolConfig } from "@/server-api-module/account/types";
import type { MarginMode } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { setLeverage, setMarginMode } from "@/server-api-module/position/mutations";

import { ChoiceList } from "../../../_shared/ui-components/choice-list";

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
      <ChoiceList
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
