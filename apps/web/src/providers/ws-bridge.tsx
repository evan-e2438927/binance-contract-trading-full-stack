"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ApiError } from "@/lib/axios-client/api-error";
import { getToken, onTokenChange, setToken } from "@/lib/session/token";
import { notify } from "@/lib/toast/notify";
import { wsClient } from "@/lib/ws-client/instance";
import { systemChannels, type WsErrorPayload } from "@/lib/ws-client/protocol";
import { accountKeys } from "@/server-api-module/account/queries";
import {
  onAccount,
  onFill,
  onFunding,
  onLiquidation,
  onOrder,
  onPosition,
} from "@/server-api-module/account/subscriptions";
import { marketChannels, onMarketStatus } from "@/server-api-module/market/subscriptions";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { useMarketStore } from "@/stores/market-store";

/** 页面在后台超过这么久，切回来就全量重新对齐账户（05 第 4 节第 3 条） */
const HIDDEN_REHYDRATE_MS = 30_000;

/**
 * 把 WS 连接、登录态、各个 store 接到一起。挂在根布局上，全站只有一个，不渲染任何东西。
 *
 * - 启动：恢复登录态 → 连 WS → 订 market 频道（行情源状态）
 * - 每次（重）连上：已登录就 hydrate（对齐机制，第 2 条最容易漏）
 * - token 变化：同步给 WS；登录 → hydrate；登出 → 清账户 store 和账户类查询缓存
 * - 私有推送 → account-store；强平 → 进强平通知队列（由 LiquidationDialog 弹出）
 * - 成交 / 资金费 / 强平 → 让对应的历史查询失效，下次打开历史页是新的
 * - 从后台切回来超过 30 秒 → hydrate
 *
 * 各币对的 depth / trade / ticker 订阅不在这里，由用到它们的页面按需订（hooks/use-symbol-market）。
 */
export function WsBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const account = useAccountStore.getState();
    const rehydrate = () => {
      if (!getToken()) return;
      account.hydrate().catch(() => {
        // 失败时界面保留旧数据；下一次重连 / 切回前台会再对齐。错误已经在 api 层转成 ApiError
      });
    };

    const cleanups: (() => void)[] = [];

    void useAuthStore
      .getState()
      .restore()
      .catch(() => {});
    wsClient.setToken(getToken());

    cleanups.push(
      wsClient.onOpen(() => rehydrate()),
      onMarketStatus((d) => useMarketStore.getState().setFeedStatus(d.status, d.matchingEnabled)),
      wsClient.subscribe([marketChannels.market]),

      onAccount((d) => account.applyAccount(d)),
      onPosition((d) => account.applyPosition(d)),
      onOrder((d) => account.applyOrder(d)),
      onFill(() => {
        void queryClient.invalidateQueries({ queryKey: accountKeys.fillsRoot });
        void queryClient.invalidateQueries({ queryKey: accountKeys.orderHistoryRoot });
      }),
      onFunding(() => {
        void queryClient.invalidateQueries({ queryKey: accountKeys.fundingRoot });
        void queryClient.invalidateQueries({ queryKey: accountKeys.ledgerRoot });
      }),
      onLiquidation((d) => {
        account.pushLiquidation(d);
        void queryClient.invalidateQueries({ queryKey: accountKeys.liquidations });
      }),
      wsClient.on<WsErrorPayload>(systemChannels.error, ({ d }) => {
        // 提示由下面的 onTokenChange 统一发，这里只负责把本地 token 作废
        if (d.code === "TOKEN_EXPIRED") setToken(null, "expired");
      }),

      onTokenChange((token, reason) => {
        wsClient.setToken(token);
        if (token) {
          rehydrate();
          return;
        }
        account.clear();
        queryClient.removeQueries({ queryKey: accountKeys.all });
        // 过期是"被动登出"，要说一声；用户自己点退出就不用了
        if (reason === "expired") notify.error(new ApiError("TOKEN_EXPIRED", "登录已过期，请重新登录", 401));
      }),
    );

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_REHYDRATE_MS) rehydrate();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

    wsClient.connect();

    return () => {
      for (const cleanup of cleanups) cleanup();
      wsClient.disconnect();
    };
  }, [queryClient]);

  return null;
}
