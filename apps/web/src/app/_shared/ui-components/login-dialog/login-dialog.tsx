"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@binance-contract-trading-full-stack/ui/components/dialog";
import { Tabs, TabsContent } from "@binance-contract-trading-full-stack/ui/components/tabs";

import { SegmentedTabsList, SegmentedTabsTrigger } from "@/components/segmented-tabs";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { useUiStore } from "@/stores/ui-store";

import { EmailLogin } from "./email-login";
import { GoogleLogin } from "./google-login";
import { WalletLogin } from "./wallet-login";

/**
 * L-01 登录弹窗（Figma 5:6852 / 5:7251 / 5:7654）。三种方式各自开户，底部文案说清楚（spec 一·8）。
 * 默认打开邮箱 tab：钱包这次还不能用（spec 一·7）。
 * 弹窗关闭时内容会卸载，邮箱表单和倒计时随之清空，不用手动重置。
 */
export function LoginDialog() {
  const open = useUiStore((s) => s.loginOpen);
  const setOpen = useUiStore((s) => s.setLoginOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/72 supports-backdrop-filter:backdrop-blur-none"
        className="w-[390px] gap-0 rounded-[10px] border bg-elevated p-7 ring-0 sm:max-w-[390px]"
      >
        <div className="flex items-center justify-between">
          <DialogTitle className="font-bold text-[17px] text-foreground leading-[25.5px]">登录 / 注册</DialogTitle>
          <DialogClose
            aria-label="关闭"
            className="text-[20px] text-muted-foreground leading-5 transition-colors hover:text-foreground"
          >
            ×
          </DialogClose>
        </div>
        <Tabs defaultValue="email" className="mt-5 gap-0">
          <SegmentedTabsList>
            <SegmentedTabsTrigger value="wallet">钱包登录</SegmentedTabsTrigger>
            <SegmentedTabsTrigger value="email">邮箱登录</SegmentedTabsTrigger>
            <SegmentedTabsTrigger value="google">Google</SegmentedTabsTrigger>
          </SegmentedTabsList>
          <TabsContent value="wallet" className="pt-[22px]">
            <WalletLogin />
          </TabsContent>
          <TabsContent value="email" className="pt-[22px]">
            <EmailLogin />
          </TabsContent>
          <TabsContent value="google" className="pt-[22px]">
            <GoogleLogin />
          </TabsContent>
        </Tabs>
        <p className="pt-3.5 text-center text-[11px] text-muted-foreground leading-[16.5px]">
          首次登录自动开户并发放 {INITIAL_BALANCE_DISPLAY} USDT；不同登录方式是不同账户
        </p>
      </DialogContent>
    </Dialog>
  );
}
