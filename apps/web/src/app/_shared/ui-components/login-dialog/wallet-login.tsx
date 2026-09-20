"use client";

import { notify } from "@/lib/toast/notify";

import { PRIMARY_BUTTON } from "./styles";

/**
 * L-02 钱包登录（Figma 5:6852）。这次只做样式：Reown AppKit 还没接（要 Project ID），
 * 点了先提示；接入时这里换成「连接钱包 → 签名 → 登录」（docs/frontend/README.md M05）。
 */
export function WalletLogin() {
  return (
    <button type="button" className={PRIMARY_BUTTON} onClick={() => notify.info("钱包登录即将开放")}>
      <span aria-hidden className="text-[18px] leading-[27px]">
        🔗
      </span>
      连接 Web3 钱包
    </button>
  );
}
