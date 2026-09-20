"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { notify } from "@/lib/toast/notify";
import { setPositionMode } from "@/server-api-module/account/mutations";
import { accountKeys } from "@/server-api-module/account/queries";
import type { PositionMode } from "@/server-api-module/common/types";
import { useAccountStore } from "@/stores/account-store";

import { ChoiceList } from "./choice-list";

/**
 * G-07 持仓模式（账户级，不分币对）。账户菜单和交易页下单面板都会打开它，所以放 _shared。
 * 有任何持仓或挂单时服务端会拒（POSITION_MODE_LOCKED），原因原样显示。
 */
export function PositionModeDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PositionMode;
}) {
  const [value, setValue] = useState<PositionMode>(current);
  const [pending, setPending] = useState(false);
  const hydrate = useAccountStore((s) => s.hydrate);
  const queryClient = useQueryClient();

  const confirm = async () => {
    setPending(true);
    try {
      await setPositionMode(value);
      await hydrate();
      // 下单面板的币对配置缓存里也有持仓模式相关的展示，一起失效
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      notify.success(`已切换为${value === "ONE_WAY" ? "单向持仓" : "双向持仓"}`);
      onOpenChange(false);
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[360px] gap-4 rounded-[10px] border bg-elevated p-6 ring-0 sm:max-w-[360px]">
        <DialogTitle className="font-bold text-[15px] text-foreground">持仓模式</DialogTitle>
        <ChoiceList
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
        <Button disabled={pending || value === current} onClick={confirm}>
          确认
        </Button>
      </DialogContent>
    </Dialog>
  );
}
