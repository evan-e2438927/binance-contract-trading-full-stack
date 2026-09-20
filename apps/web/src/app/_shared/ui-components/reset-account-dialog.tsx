"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { useState } from "react";

import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { formatDateTime } from "@/lib/format/time";
import { notify } from "@/lib/toast/notify";
import { resetAccount } from "@/server-api-module/account/mutations";
import { useAccountStore } from "@/stores/account-store";

/**
 * G-08 重置模拟账户。危险操作，二次确认（08 G-08）。
 *
 * 重置不是"直接把余额改回 10,000"：服务端走正常流程——撤掉全部挂单、按标记价平掉全部仓位、
 * 再补一笔 RESET 流水，这样"余额 == 流水之和"这条不变式才守得住（CLAUDE.md）。
 */
export function ResetAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const account = useAccountStore((s) => s.account);
  const hydrate = useAccountStore((s) => s.hydrate);
  const [pending, setPending] = useState(false);

  // canReset / resetAvailableAt 来自 REST 的 GET /account（WS 推送里没有，store 会沿用）
  const availableAt = account?.resetAvailableAt ?? null;
  const cooling = account ? !account.canReset : false;

  const confirm = async () => {
    setPending(true);
    try {
      await resetAccount();
      await hydrate();
      notify.success(`账户已重置，余额恢复到 ${INITIAL_BALANCE_DISPLAY} USDT`);
      onOpenChange(false);
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[380px] gap-4 rounded-[10px] border bg-elevated p-6 ring-0 sm:max-w-[380px]">
        <DialogTitle className="font-bold text-[15px] text-foreground">重置模拟账户</DialogTitle>
        <ul className="flex flex-col gap-1.5 text-[12px] text-muted-foreground leading-[18px]">
          <li>· 撤掉全部挂单，按标记价平掉全部仓位</li>
          <li>· 余额恢复到 {INITIAL_BALANCE_DISPLAY} USDT</li>
          <li>· 重置后本期不进日榜、周榜（排行榜规则）</li>
          <li>· 24 小时只能重置一次</li>
        </ul>
        {cooling && <p className="text-[12px] text-brand">{formatDateTime(availableAt)} 之后可以再次重置</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={pending || cooling} onClick={confirm}>
            确认重置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
