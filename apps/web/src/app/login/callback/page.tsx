"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RETURN_TO_KEY } from "@/lib/config/constants";
import { useAuthStore } from "@/stores/auth-store";

/** Google 回跳时服务端放在 fragment 里的错误码 → 给用户看的话 */
const ERROR_TEXT: Record<string, string> = {
  SERVICE_UNAVAILABLE: "服务端没有配置 Google 登录",
  OAUTH_STATE_MISMATCH: "登录校验失败（可能等待太久），请重新登录",
  UNAUTHORIZED: "Google 授权被取消或失败，请重新登录",
  INTERNAL_ERROR: "登录时服务器出错，请稍后重试",
};

/**
 * L-04 Google 登录回跳页（05 第 12.3 节）。
 * 服务端 302 回 /login/callback#token=xxx&isNew=1（或 #error=CODE）。
 * token 在 fragment 里：不发给服务端、不进访问日志。拿到后立刻 replaceState 清掉，不留在地址栏和历史记录里。
 */
export default function LoginCallbackPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);

    const token = params.get("token");
    if (!token) {
      const code = params.get("error") ?? "UNAUTHORIZED";
      setError(ERROR_TEXT[code] ?? "登录失败，请重新登录");
      return;
    }

    let returnTo = "/";
    try {
      returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? "/";
      sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      // 读不到就回首页
    }
    // 只允许站内路径，防止被拼成跳去外站
    if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

    login(token)
      .then(() => router.replace(returnTo as "/"))
      .catch(() => setError("登录状态校验失败，请重新登录"));
  }, [login, router]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      {error ? (
        <>
          <p className="text-down">{error}</p>
          <Link href="/" className="text-brand">
            返回首页
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground">正在登录…</p>
      )}
    </div>
  );
}
