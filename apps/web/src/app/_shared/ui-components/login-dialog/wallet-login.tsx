"use client";

import dynamic from "next/dynamic";

import { PRIMARY_BUTTON } from "./styles";

/**
 * L-02 钱包登录（Figma 5:6852）。真正的 Reown AppKit（wagmi + solana adapter）整体懒加载：
 * 只有这个 tab 被渲染（Radix Tabs 默认不挂载非激活 TabsContent）时才会去下载/初始化 AppKit，
 * 首屏（未打开登录弹窗）网络请求里不会出现 AppKit 相关 chunk（requirements.md AC-008）。
 * 连接 → 签名 → nonce/verify 的具体流程在 lib/wallet/wallet-connect-panel.tsx。
 */
const WalletConnectPanel = dynamic(() => import("@/lib/wallet/wallet-connect-panel"), {
  ssr: false,
  loading: () => (
    <button type="button" className={PRIMARY_BUTTON} disabled>
      <span aria-hidden className="text-[18px] leading-[27px]">
        🔗
      </span>
      连接中…
    </button>
  ),
});

export function WalletLogin() {
  return <WalletConnectPanel />;
}
