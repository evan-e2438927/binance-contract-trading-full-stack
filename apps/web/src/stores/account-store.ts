import { parse } from "@binance-contract-trading-full-stack/shared";
import { create } from "zustand";

import { fetchAccount, fetchOpenOrders, fetchPositions } from "@/server-api-module/account/queries";
import type { Account, AccountSummary, Liquidation } from "@/server-api-module/account/types";
import type { Order } from "@/server-api-module/order/types";
import type { Position } from "@/server-api-module/position/types";

/**
 * 账户 store（05-frontend-design.md 第 4 节）：余额、仓位、当前挂单。REST 首屏 + WS 增量。
 * 历史类数据（历史委托、成交、流水、资金费、强平记录）不在这里，走 React Query。
 *
 * hydrate() 是对齐机制——增量推送只在连接持续期间可信，下面三种情况必须全量重拉：
 *   1. 登录成功后
 *   2. WebSocket 重连成功后（最容易漏）
 *   3. 页面从后台切回前台超过 30 秒
 * 调用方在 providers/ws-bridge.tsx。
 *
 * 竞态：REST 请求在路上时推送还在来，快照回来直接覆盖会把这段时间的推送冲掉。
 * 所以 hydrate 期间收到的推送先照常应用、同时记下来，快照落地后再按顺序重放一遍。
 */

type Push = { t: "account"; d: AccountSummary } | { t: "position"; d: Position } | { t: "order"; d: Order };

export interface AccountState {
  account: Account | null;
  positions: Position[];
  openOrders: Order[];
  /** 至少完成过一次 hydrate */
  hydrated: boolean;
  /** 还没被用户确认的强平通知（强平要弹 Dialog，不是 Toast——05 第 13 节） */
  liquidationQueue: Liquidation[];

  hydrate(): Promise<void>;
  clear(): void;
  applyAccount(summary: AccountSummary): void;
  applyPosition(position: Position): void;
  applyOrder(order: Order): void;
  pushLiquidation(record: Liquidation): void;
  dismissLiquidation(id: string): void;
}

const OPEN_STATUSES = new Set<Order["status"]>(["NEW", "PARTIALLY_FILLED"]);

const positionKey = (p: Pick<Position, "symbol" | "positionSide">) => `${p.symbol}:${p.positionSide}`;

function upsertPosition(list: Position[], next: Position): Position[] {
  const key = positionKey(next);
  const rest = list.filter((p) => positionKey(p) !== key);
  // 平仓后服务端推一条 positionAmt = "0" 的，据此删掉这一行
  return parse(next.positionAmt) === 0n ? rest : [...rest, next].sort(byOpenedAt);
}

function upsertOrder(list: Order[], next: Order): Order[] {
  const rest = list.filter((o) => o.id !== next.id);
  // 终态（成交完、撤单、过期、拒单）从当前委托里拿掉
  return OPEN_STATUSES.has(next.status) ? [next, ...rest].sort(byCreatedAtDesc) : rest;
}

const byOpenedAt = (a: Position, b: Position) => a.openedAt - b.openedAt;
const byCreatedAtDesc = (a: Order, b: Order) => b.createdAt - a.createdAt;

let hydrating: Promise<void> | null = null;
let replayBuffer: Push[] | null = null;
/** 登出（clear）时加一：登出前发出去的 hydrate 回来了也不许再写进 store */
let generation = 0;

export const useAccountStore = create<AccountState>()((set, get) => {
  function record(push: Push) {
    replayBuffer?.push(push);
  }

  function apply(push: Push) {
    switch (push.t) {
      case "account":
        // 推送里没有 nickname / canReset / resetAvailableAt，沿用 REST 拿到的
        set((s) => (s.account ? { account: { ...s.account, ...push.d } } : {}));
        return;
      case "position":
        set((s) => ({ positions: upsertPosition(s.positions, push.d) }));
        return;
      case "order":
        set((s) => ({ openOrders: upsertOrder(s.openOrders, push.d) }));
        return;
    }
  }

  return {
    account: null,
    positions: [],
    openOrders: [],
    hydrated: false,
    liquidationQueue: [],

    hydrate() {
      if (hydrating) return hydrating;
      replayBuffer = [];
      const startedAt = generation;
      hydrating = Promise.all([fetchAccount(), fetchPositions(), fetchOpenOrders()])
        .then(([account, positions, orders]) => {
          if (startedAt !== generation) return;
          set({
            account,
            positions: [...positions].filter((p) => parse(p.positionAmt) !== 0n).sort(byOpenedAt),
            openOrders: [...orders.items].sort(byCreatedAtDesc),
            hydrated: true,
          });
          for (const push of replayBuffer ?? []) apply(push);
        })
        .finally(() => {
          if (startedAt !== generation) return;
          hydrating = null;
          replayBuffer = null;
        });
      return hydrating;
    },

    clear() {
      generation += 1;
      hydrating = null;
      replayBuffer = null;
      set({ account: null, positions: [], openOrders: [], hydrated: false, liquidationQueue: [] });
    },

    applyAccount(d) {
      const push: Push = { t: "account", d };
      record(push);
      apply(push);
    },
    applyPosition(d) {
      const push: Push = { t: "position", d };
      record(push);
      apply(push);
    },
    applyOrder(d) {
      const push: Push = { t: "order", d };
      record(push);
      apply(push);
    },

    pushLiquidation(record) {
      if (get().liquidationQueue.some((l) => l.id === record.id)) return;
      set((s) => ({ liquidationQueue: [...s.liquidationQueue, record] }));
    },
    dismissLiquidation(id) {
      set((s) => ({ liquidationQueue: s.liquidationQueue.filter((l) => l.id !== id) }));
    },
  };
});
