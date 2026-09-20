"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@binance-contract-trading-full-stack/ui/components/dropdown-menu";
import { Skeleton } from "@binance-contract-trading-full-stack/ui/components/skeleton";
import { useState } from "react";
import { LetterAvatar } from "@/components/letter-avatar";
import { formatUsdt } from "@/lib/format/number";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { LoginDialog } from "../login-dialog/login-dialog";
import { NicknameDialog } from "../nickname-dialog";
import { PositionModeDialog } from "../position-mode-dialog";
import { ResetAccountDialog } from "../reset-account-dialog";
import { avatarInitial, displayName, shortId } from "./account-display";

const PROVIDER_LABEL = {
  wallet_evm: "EVM 钱包",
  wallet_solana: "Solana 钱包",
  email: "邮箱",
  google: "Google",
} as const;

/**
 * G-04 登录入口 / G-05 账户菜单（Figma 2:33 未登录 / 5:8093 已登录）。
 * 设计稿已登录只画了头像 + 昵称；余额、身份、退出登录放进点开后的菜单（spec 一·2）。
 */
export function AccountEntry() {
  const status = useAuthStore((s) => s.status);
  const me = useAuthStore((s) => s.me);
  const logout = useAuthStore((s) => s.logout);
  const walletBalance = useAccountStore((s) => s.account?.walletBalance);
  const positionMode = useAccountStore((s) => s.account?.positionMode) ?? "ONE_WAY";
  const [dialog, setDialog] = useState<"nickname" | "positionMode" | "reset" | null>(null);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  // 登录态还在校验：占位，不要闪一下「登录」按钮再变成账户名
  if (status === "unknown") return <Skeleton className="h-[26px] w-24 rounded-[5px]" />;

  if (status === "anonymous" || !me) {
    return (
      <>
        <Button
          size="sm"
          onClick={() => setLoginOpen(true)}
          className="h-auto rounded-[5px] border-0 px-3.5 py-[5px] font-bold text-[12px] text-black leading-[18px]"
        >
          登录 / 注册
        </Button>
        <LoginDialog />
      </>
    );
  }

  const name = displayName(me);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-[5px] px-1 py-0.5 transition-colors hover:bg-elevated aria-expanded:bg-elevated"
          />
        }
      >
        <LetterAvatar text={avatarInitial(name)} tone="brand" size="sm" />
        <span className="max-w-32 truncate text-[12px] text-muted-foreground leading-[18px]">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* base-ui 的 Label 必须放在 Group 里（Menu.GroupLabel），否则运行时报 MenuGroupContext is missing */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {PROVIDER_LABEL[me.identity.provider]} · {shortId(me.identity.providerId)}
          </DropdownMenuLabel>
          <DropdownMenuLabel className="num flex items-center justify-between text-xs">
            <span className="font-sans text-muted-foreground">钱包余额</span>
            <span>{formatUsdt(walletBalance)} USDT</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setDialog("nickname")}>修改昵称</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDialog("positionMode")}>
          持仓模式（{positionMode === "ONE_WAY" ? "单向" : "双向"}）
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDialog("reset")}>重置模拟账户</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>

      <NicknameDialog open={dialog === "nickname"} onOpenChange={(open) => setDialog(open ? "nickname" : null)} />
      <PositionModeDialog
        open={dialog === "positionMode"}
        onOpenChange={(open) => setDialog(open ? "positionMode" : null)}
        current={positionMode}
      />
      <ResetAccountDialog open={dialog === "reset"} onOpenChange={(open) => setDialog(open ? "reset" : null)} />
    </DropdownMenu>
  );
}
