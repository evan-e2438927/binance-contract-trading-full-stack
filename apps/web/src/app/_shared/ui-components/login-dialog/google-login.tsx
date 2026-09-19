"use client";

import Image from "next/image";

import { RETURN_TO_KEY } from "@/lib/config/constants";
import { SERVER_URL } from "@/lib/config/env";

import { PRIMARY_BUTTON } from "./styles";

/** L-04 Google 登录（Figma 5:7654）：整页跳转到服务端 /auth/google，回跳页 /login/callback 取 token */
export function GoogleLogin() {
  const loginWithGoogle = () => {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname + window.location.search);
    } catch {
      // 存不了就回首页
    }
    // 整页跳转走浏览器原生 OAuth 流程，不用弹窗（会被拦截、第三方 cookie 受限）
    window.location.href = `${SERVER_URL}/auth/google`;
  };

  return (
    <button type="button" className={PRIMARY_BUTTON} onClick={loginWithGoogle}>
      {/* 图标是设计稿导出的资源（Figma 5:8042）；SVG 不走 Next 图片优化 */}
      <Image src="/icons/google.svg" alt="" width={18} height={18} unoptimized className="size-[18px]" />
      使用 Google 账号登录
    </button>
  );
}
