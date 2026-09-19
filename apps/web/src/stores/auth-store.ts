import { create } from "zustand";

import { ApiError } from "@/lib/axios-client/api-error";
import { getToken, onTokenChange, setToken } from "@/lib/session/token";
import { fetchMe } from "@/server-api-module/auth/queries";
import type { Me } from "@/server-api-module/auth/types";

/**
 * 登录态（05-frontend-design.md 第 12.4 节）。token 本身存在 lib/session，这里是它派生出来的状态。
 *
 * - unknown：页面刚加载，还没验证本地 token
 * - anonymous：未登录（也能看行情）
 * - authenticated：GET /auth/me 通过
 *
 * 恢复登录态时 401 只清 token 回到未登录，不自动弹钱包签名、不跳 Google（用户会以为被钓鱼）。
 * 登出不调用钱包的 disconnect：那是用户和钱包之间的事，我们只管自己的会话。
 */

export type AuthStatus = "unknown" | "anonymous" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  me: Me | null;
  /** 页面加载时调一次 */
  restore(): Promise<void>;
  /** 三种登录方式拿到 token 后都走这里 */
  login(token: string): Promise<void>;
  logout(): void;
  setNickname(nickname: string): void;
}

export const useAuthStore = create<AuthState>()((set, get) => {
  async function loadMe() {
    try {
      const me = await fetchMe();
      set({ status: "authenticated", me });
    } catch (error) {
      // 401 时 api.ts 已经清掉 token（onTokenChange 会把状态置成 anonymous）；网络问题保留 token，下次再试
      if (error instanceof ApiError && error.status === 401) return;
      set({ status: getToken() ? "unknown" : "anonymous" });
      throw error;
    }
  }

  onTokenChange((token) => {
    if (!token) set({ status: "anonymous", me: null });
  });

  return {
    status: "unknown",
    me: null,

    async restore() {
      if (!getToken()) {
        set({ status: "anonymous", me: null });
        return;
      }
      await loadMe();
    },

    async login(token) {
      setToken(token);
      await loadMe();
    },

    logout() {
      setToken(null);
    },

    setNickname(nickname) {
      const me = get().me;
      if (me) set({ me: { ...me, account: { ...me.account, nickname } } });
    },
  };
});
