import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/server-api-module/account/types";
import type { Page } from "@/server-api-module/common/types";
import type { Order } from "@/server-api-module/order/types";
import type { Position } from "@/server-api-module/position/types";

vi.mock("@/server-api-module/account/queries", () => ({
  fetchAccount: vi.fn(),
  fetchPositions: vi.fn(),
  fetchOpenOrders: vi.fn(),
}));

const { fetchAccount, fetchPositions, fetchOpenOrders } = await import("@/server-api-module/account/queries");
const { useAccountStore } = await import("./account-store");

const account = (walletBalance: string): Account => ({
  walletBalance,
  crossWalletBalance: walletBalance,
  unrealizedPnl: "0",
  crossUnrealizedPnl: "0",
  marginBalance: walletBalance,
  availableBalance: walletBalance,
  positionInitialMargin: "0",
  openOrderMargin: "0",
  totalMaintMargin: "0",
  marginRatio: "0",
  positionMode: "ONE_WAY",
  missingMarkPrices: [],
  nickname: "trader",
  canReset: true,
  resetAvailableAt: null,
});

const position = (symbol: string, positionAmt: string, openedAt = 1): Position => ({
  symbol,
  positionSide: "BOTH",
  positionAmt,
  marginMode: "CROSS",
  leverage: 10,
  entryPrice: "50000",
  markPrice: "50000",
  notional: "50000",
  unrealizedPnl: "0",
  initialMargin: "5000",
  maintMargin: "200",
  isolatedMargin: "0",
  liquidationPrice: null,
  roe: "0",
  breakEvenPrice: null,
  marginRatio: null,
  openedAt,
  updatedAt: openedAt,
});

const order = (id: string, status: Order["status"], createdAt = 1): Order => ({
  id,
  clientOrderId: id,
  symbol: "BTCUSDT",
  side: "BUY",
  positionSide: "BOTH",
  type: "LIMIT",
  timeInForce: "GTC",
  price: "49000",
  stopPrice: null,
  activationPrice: null,
  callbackRate: null,
  trackedPrice: null,
  workingType: null,
  qty: "1",
  executedQty: "0",
  avgPrice: "0",
  reduceOnly: false,
  closePosition: false,
  status,
  triggered: false,
  queueAhead: "3",
  queueEstimated: false,
  frozenMargin: "4900",
  rejectReason: null,
  createdAt,
  updatedAt: createdAt,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useAccountStore.getState().clear();
  vi.mocked(fetchAccount).mockResolvedValue(account("10000"));
  vi.mocked(fetchPositions).mockResolvedValue([]);
  vi.mocked(fetchOpenOrders).mockResolvedValue({ items: [], nextCursor: null });
});

describe("account-store", () => {
  it("hydrate 用 REST 全量覆盖本地状态", async () => {
    useAccountStore.getState().applyPosition(position("ETHUSDT", "2"));
    vi.mocked(fetchPositions).mockResolvedValue([position("BTCUSDT", "1")]);
    await useAccountStore.getState().hydrate();
    const s = useAccountStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.account?.walletBalance).toBe("10000");
    expect(s.positions.map((p) => p.symbol)).toEqual(["BTCUSDT"]);
  });

  it("★ hydrate 期间到达的推送，快照落地后重放，不会被旧快照冲掉", async () => {
    const orders = deferred<Page<Order>>();
    vi.mocked(fetchOpenOrders).mockReturnValue(orders.promise);

    const pending = useAccountStore.getState().hydrate();
    // 请求在路上：一张单成交完了、一张新单挂上了
    useAccountStore.getState().applyOrder(order("o1", "FILLED"));
    useAccountStore.getState().applyOrder(order("o2", "NEW", 2));
    // 快照是请求发出时的状态：o1 还挂着、o2 还不存在
    orders.resolve({ items: [order("o1", "NEW")], nextCursor: null });
    await pending;

    expect(useAccountStore.getState().openOrders.map((o) => o.id)).toEqual(["o2"]);
  });

  it("仓位推送 positionAmt = 0 时删掉这一行", async () => {
    await useAccountStore.getState().hydrate();
    const store = useAccountStore.getState();
    store.applyPosition(position("BTCUSDT", "1"));
    store.applyPosition(position("BTCUSDT", "-0.5"));
    expect(useAccountStore.getState().positions).toHaveLength(1);
    expect(useAccountStore.getState().positions[0]?.positionAmt).toBe("-0.5");
    store.applyPosition(position("BTCUSDT", "0"));
    expect(useAccountStore.getState().positions).toEqual([]);
  });

  it("账户推送合并进来，保留 REST 才有的 nickname 等字段", async () => {
    await useAccountStore.getState().hydrate();
    const { nickname: _n, canReset: _c, resetAvailableAt: _r, ...summary } = account("9500");
    useAccountStore.getState().applyAccount(summary);
    const a = useAccountStore.getState().account;
    expect(a?.walletBalance).toBe("9500");
    expect(a?.nickname).toBe("trader");
  });

  it("登出（clear）之后，之前发出的 hydrate 回来也不写进 store", async () => {
    const acc = deferred<Account>();
    vi.mocked(fetchAccount).mockReturnValue(acc.promise);
    const pending = useAccountStore.getState().hydrate();
    useAccountStore.getState().clear();
    acc.resolve(account("10000"));
    await pending;
    expect(useAccountStore.getState().account).toBeNull();
    expect(useAccountStore.getState().hydrated).toBe(false);
  });

  it("强平通知排队、按 id 去重、逐条确认", () => {
    const store = useAccountStore.getState();
    const record = {
      id: "l1",
      symbol: "BTCUSDT",
      positionSide: "BOTH" as const,
      marginMode: "CROSS" as const,
      qty: "1",
      entryPrice: "50000",
      markPrice: "45180.72",
      realizedPnl: "-4819.28",
      liquidationFee: "225.9",
      marginBalanceBefore: "180",
      maintMarginAt: "200",
      createdAt: 1,
    };
    store.pushLiquidation(record);
    store.pushLiquidation(record);
    store.pushLiquidation({ ...record, id: "l2" });
    expect(useAccountStore.getState().liquidationQueue.map((l) => l.id)).toEqual(["l1", "l2"]);
    store.dismissLiquidation("l1");
    expect(useAccountStore.getState().liquidationQueue.map((l) => l.id)).toEqual(["l2"]);
  });
});
