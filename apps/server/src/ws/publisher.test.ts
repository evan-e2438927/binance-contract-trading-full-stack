import type { AccountView, EngineEvent, Fill, Order, Position, PositionView } from "@binance-contract-trading-full-stack/engine";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { createMarketState } from "../market/market-state";
import { toDbId } from "../persistence/ids";
import type { WsHub } from "./hub";
import { createWsPublisher } from "./publisher";

const T = Date.parse("2026-09-18T08:00:00Z");

const accountView = (accountId: string): AccountView => ({
  accountId,
  positionMode: "ONE_WAY",
  walletBalance: parse("10000"),
  crossWalletBalance: parse("10000"),
  unrealizedPnl: parse("5"),
  crossUnrealizedPnl: parse("5"),
  marginBalance: parse("10005"),
  positionInitialMargin: parse("500"),
  openOrderMargin: 0n,
  maintMargin: parse("40"),
  availableBalance: parse("9500"),
  marginRatio: parse("0.004"),
  missingMarkPrices: [],
});

const positionView = (): PositionView => ({
  symbol: "BTCUSDT",
  positionSide: "LONG",
  marginMode: "CROSS",
  leverageNum: 20,
  qty: parse("0.1"),
  entryPrice: parse("50000"),
  markPrice: parse("50050"),
  notional: parse("5005"),
  breakEvenPrice: parse("50025"),
  marginRatio: parse("0.004"),
  unrealizedPnl: parse("5"),
  initialMargin: parse("250.25"),
  maintMargin: parse("20.02"),
  isolatedMargin: 0n,
  liquidationPrice: parse("45000"),
  liquidationUnavailableReason: null,
  roe: parse("0.02"),
  openedAt: T,
  updatedAt: T,
});

const testOrder = (overrides: Partial<Order> = {}): Order => ({
  id: "11111111-1111-4111-8111-111111111111",
  clientOrderId: "c-1",
  accountId: "acc-1",
  symbol: "BTCUSDT",
  side: "BUY",
  positionSide: "BOTH",
  type: "LIMIT",
  timeInForce: "GTC",
  price: parse("49000"),
  stopPrice: null,
  workingType: "CONTRACT_PRICE",
  activationPrice: null,
  callbackRate: null,
  trackedPrice: null,
  qty: parse("0.1"),
  executedQty: 0n,
  avgPrice: 0n,
  reduceOnly: false,
  closePosition: false,
  status: "NEW",
  triggered: false,
  queueAhead: parse("3"),
  queueEstimated: true,
  frozenMargin: parse("250"),
  rejectReason: null,
  createdAt: T,
  updatedAt: T,
  ...overrides,
});

const testPosition = (overrides: Partial<Position> = {}): Position => ({
  accountId: "acc-1",
  symbol: "BTCUSDT",
  positionSide: "LONG",
  marginMode: "CROSS",
  leverageNum: 20,
  qty: parse("0.1"),
  entryPrice: parse("50000"),
  isolatedMargin: 0n,
  costBasis: parse("5002.5"),
  openedAt: T,
  updatedAt: T,
  ...overrides,
});

function setup() {
  const publicMsgs: { channel: string; data: any }[] = [];
  const privateMsgs: { accountId: string; channel: string; data: any }[] = [];
  // 假装这些 depth 频道有人订（publisher 只给被订阅的精度做聚合）
  const subscribed = new Set<string>(["depth:BTCUSDT"]);
  const hub = {
    publish: (channel: string, data: unknown) => publicMsgs.push({ channel, data }),
    publishToAccount: (accountId: string, channel: string, data: unknown) => privateMsgs.push({ accountId, channel, data }),
    activeChannels: (prefix: string) => [...subscribed].filter((c) => c.startsWith(prefix)),
  } as unknown as WsHub;
  const marketState = createMarketState();
  const publisher = createWsPublisher({
    hub,
    engine: { accountView: (id: string) => accountView(id), positionViews: () => [positionView()] },
    marketState,
    positionModeOf: () => "ONE_WAY",
    tickSizeOf: () => "0.1",
  });
  return { publisher, publicMsgs, privateMsgs, marketState, subscribed };
}

describe("WebSocket 推送", () => {
  it("公共频道：盘口、成交、K 线、ticker（跟着标记价推送走，1 秒一条）", () => {
    const { publisher, publicMsgs, marketState } = setup();
    publisher.onMarketEvent({ t: "book", symbol: "BTCUSDT", bids: [{ price: parse("49999.9"), qty: parse("1.5") }], asks: [{ price: parse("50000"), qty: parse("2") }], ts: T });
    // 服务端已经聚合好（2026-09-20）：不带精度的老频道按 tickSize 0.1 算，带累计量和背景条百分比
    expect(publicMsgs.at(-1)).toEqual({
      channel: "depth:BTCUSDT",
      data: {
        step: "0.1",
        bids: [{ price: "49999.9", qty: "1.5", cumulative: "1.5", percentNum: 100 }],
        asks: [{ price: "50000", qty: "2", cumulative: "2", percentNum: 100 }],
        updateTime: T,
      },
    });

    const trade = { t: "trade" as const, symbol: "BTCUSDT", tradeId: 7, price: parse("50050"), qty: parse("0.3"), buyerIsMaker: true, ts: T + 1 };
    marketState.onEvent(trade);
    publisher.onMarketEvent(trade);
    expect(publicMsgs.at(-1)).toEqual({ channel: "trade:BTCUSDT", data: { tradeId: 7, price: "50050", qty: "0.3", buyerIsMaker: true, time: T + 1 } });

    publisher.onMarketEvent({ t: "kline", symbol: "BTCUSDT", interval: "1m", openTime: T, closeTime: T + 59_999, open: parse("50000"), high: parse("50100"), low: parse("49900"), close: parse("50050"), volume: parse("12.5"), closed: false, ts: T + 2 });
    expect(publicMsgs.at(-1)).toMatchObject({ channel: "kline:BTCUSDT:1m", data: { closed: false, close: "50050" } });

    publisher.onMarketEvent({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse("50040"), indexPrice: parse("50038"), fundingRate: parse("0.0001"), nextFundingTs: T + 3600_000, ts: T + 3 });
    expect(publicMsgs.at(-1)).toEqual({
      channel: "ticker:BTCUSDT",
      data: { lastPrice: "50050", lastTradeTime: T + 1, markPrice: "50040", indexPrice: "50038", fundingRate: "0.0001", nextFundingTime: T + 3600_000, markTime: T + 3, stats24h: null },
    });
  });

  it("ticker 推送带上最新的 24 小时统计（币安 @ticker 流，缺口 #47）；统计本身不单独推", () => {
    const { publisher, publicMsgs, marketState } = setup();
    const stats = {
      t: "stats24h" as const,
      symbol: "BTCUSDT",
      priceChange: parse("-120.5"),
      priceChangePercent: parse("-0.241"),
      openPrice: parse("50170.5"),
      highPrice: parse("51000"),
      lowPrice: parse("49500"),
      lastPrice: parse("50050"),
      volume: parse("123456.789"),
      quoteVolume: parse("6180000000.12"),
      openTime: 1,
      closeTime: 2,
      count: 999,
      ts: T,
    };
    marketState.onEvent(stats);
    publisher.onMarketEvent(stats);
    expect(publicMsgs).toHaveLength(0);

    publisher.onMarketEvent({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse("50040"), indexPrice: parse("50038"), fundingRate: parse("0.0001"), nextFundingTs: T + 3600_000, ts: T + 3 });
    expect(publicMsgs.at(-1)?.data.stats24h).toEqual({
      priceChange: "-120.5",
      priceChangePercent: "-0.241",
      openPrice: "50170.5",
      highPrice: "51000",
      lowPrice: "49500",
      volume: "123456.789",
      quoteVolume: "6180000000.12",
      openTime: 1,
      closeTime: 2,
      count: 999,
    });
  });

  it("行情源状态变化推 market 频道", () => {
    const { publisher, publicMsgs } = setup();
    publisher.onFeedStatus("degraded");
    expect(publicMsgs.at(-1)).toEqual({ channel: "market", data: { status: "degraded", matchingEnabled: false } });
    publisher.onFeedStatus("ready");
    expect(publicMsgs.at(-1)).toEqual({ channel: "market", data: { status: "ready", matchingEnabled: true } });
  });

  it("私有频道：订单、成交、仓位、强平、资金费各推一条；一次 apply 里多条余额变动只推一次账户快照", () => {
    const { publisher, privateMsgs } = setup();
    const fill: Fill = {
      id: "o-1:1",
      orderId: "11111111-1111-4111-8111-111111111111",
      accountId: "acc-1",
      symbol: "BTCUSDT",
      side: "BUY",
      positionSide: "LONG",
      price: parse("50000"),
      qty: parse("0.1"),
      role: "TAKER",
      fee: parse("2.5"),
      realizedPnl: 0n,
      isLiquidation: false,
      ts: T,
    };
    const events: EngineEvent[] = [
      { t: "orderUpdate", order: testOrder({ status: "FILLED", executedQty: parse("0.1") }) },
      { t: "fill", fill },
      { t: "positionUpdate", position: testPosition() },
      { t: "balanceUpdate", accountId: "acc-1", walletBalance: parse("9997.5"), delta: parse("-2.5"), reason: "FEE", symbol: "BTCUSDT", ref: null, ts: T },
      { t: "balanceUpdate", accountId: "acc-1", walletBalance: parse("9997.5"), delta: 0n, reason: "REALIZED_PNL", symbol: "BTCUSDT", ref: null, ts: T },
    ];
    publisher.onCommitted({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50000"), qty: parse("0.1"), buyerIsMaker: false, ts: T }, events);

    expect(privateMsgs.map((m) => m.channel)).toEqual(["order", "fill", "position", "account"]);
    expect(privateMsgs.every((m) => m.accountId === "acc-1")).toBe(true);
    expect(privateMsgs[0]!.data).toMatchObject({ clientOrderId: "c-1", status: "FILLED", queueAhead: "3" });
    // 成交 id 和落库同一套换算，前端拿到的和 REST 查到的是同一个
    expect(privateMsgs[1]!.data).toMatchObject({ id: toDbId("o-1:1"), fee: "2.5", role: "TAKER" });
    expect(privateMsgs[2]!.data).toMatchObject({ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "0.1", liquidationPrice: "45000" });
    expect(privateMsgs[3]!.data).toMatchObject({ walletBalance: "10000", availableBalance: "9500", marginRatio: "0.004" });
  });

  it("仓位平掉推一条数量为 0 的，前端才知道要从列表里去掉；被拒的请求不推", () => {
    const { publisher, privateMsgs } = setup();
    publisher.onCommitted({ t: "cancelOrder", accountId: "acc-1", orderId: "o-1", ts: T }, [
      { t: "positionUpdate", position: testPosition({ qty: 0n }) },
      { t: "rejected", accountId: "acc-1", input: "placeOrder", clientOrderId: "c-9", orderId: "o-9", code: "INSUFFICIENT_MARGIN", message: "余额不足", ts: T },
    ]);
    expect(privateMsgs).toHaveLength(1);
    expect(privateMsgs[0]).toMatchObject({ channel: "position", data: { positionAmt: "0", symbol: "BTCUSDT", markPrice: null } });
    // AC-006b: 已平仓仓位没有意义讨论"为什么算不出强平价"，liquidationUnavailableReason 固定为 null，和 liquidationPrice: null 保持一致
    expect(privateMsgs[0]!.data).toMatchObject({ liquidationPrice: null, liquidationUnavailableReason: null });
  });
});
