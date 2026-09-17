import { parse } from "@binance-contract-trading-full-stack/shared";
import type {
  EngineConfig,
  EngineInput,
  LeverageBracket,
  Level,
  Order,
  PlaceOrderRequest,
  Position,
  SymbolSpec,
} from "../types";

/**
 * 测试专用的冻结配置。
 *
 * ⚠️ 故意不读 packages/db 里从币安官方接口同步进数据库的真实分层表：
 * 币安会调表（BTCUSDT 第 1 层上限已经从文档里的 50,000 变成了 300,000），
 * 测试如果跟着真实数据走，币安一调表就全红，而且红得毫无意义。
 * 这里用的是 01-domain-knowledge.md 里那张示例表——所有文档算例都基于它。
 */
/**
 * 交易规则取自币安 `GET /fapi/v1/exchangeInfo` 2026-09-17 的 BTCUSDT，
 * 只有 minNotional 例外：币安现在是 50，这里保留文档算例里的 5，让 0.001 BTC 这种小单的测试不用改。
 */
export const BTCUSDT: SymbolSpec = {
  symbol: "BTCUSDT",
  status: "TRADING",
  enabled: true,
  tickSize: parse("0.1"),
  minPrice: parse("556.8"),
  maxPrice: parse("4529764"),
  stepSize: parse("0.001"),
  minQty: parse("0.001"),
  maxQty: parse("1000"),
  marketStepSize: parse("0.001"),
  marketMinQty: parse("0.001"),
  marketMaxQty: parse("120"),
  minNotional: parse("5"),
  percentPriceUp: parse("1.05"),
  percentPriceDown: parse("0.95"),
  maxNumOrdersNum: 200,
  liquidationFeeRate: parse("0.0125"),
};

function bracket(
  bracketNum: number,
  floor: string,
  cap: string,
  maxLeverageNum: number,
  mmr: string,
  cum: string,
): LeverageBracket {
  return {
    bracketNum,
    notionalFloor: parse(floor),
    notionalCap: parse(cap),
    maxLeverageNum,
    mmr: parse(mmr),
    cum: parse(cum),
  };
}

export const BTCUSDT_BRACKETS: LeverageBracket[] = [
  bracket(1, "0", "50000", 125, "0.004", "0"),
  bracket(2, "50000", "600000", 100, "0.005", "50"),
  bracket(3, "600000", "3000000", 50, "0.01", "3050"),
  bracket(4, "3000000", "12000000", 20, "0.025", "48050"),
  bracket(5, "12000000", "70000000", 10, "0.05", "348050"),
  bracket(6, "70000000", "100000000", 5, "0.1", "3848050"),
  bracket(7, "100000000", "230000000", 4, "0.125", "6348050"),
  bracket(8, "230000000", "480000000", 3, "0.15", "12098050"),
  bracket(9, "480000000", "600000000", 2, "0.25", "60098050"),
  bracket(10, "600000000", "800000000", 1, "0.5", "210098050"),
];

/** 每次调用返回一份新对象，测试之间互不污染。 */
export function testConfig(): EngineConfig {
  return {
    symbols: [BTCUSDT],
    brackets: { BTCUSDT: BTCUSDT_BRACKETS },
    fees: {
      makerFeeRate: parse("0.0002"),
      takerFeeRate: parse("0.0005"),
    },
    limits: {
      marketDepthRatio: parse("0.5"),
      maxConditionalOrdersNum: 200,
    },
  };
}

/** 一个固定的起始时间戳，测试里的时间都从它往后推。 */
export const T0 = 1_789_344_000_000;

export function registerAccountInput(
  accountId: string,
  walletBalance = "10000",
  ts = T0,
): Extract<EngineInput, { t: "registerAccount" }> {
  return { t: "registerAccount", accountId, walletBalance: parse(walletBalance), positionMode: "ONE_WAY", ts };
}

/** 一张 BTCUSDT 限价买单，状态 NEW。需要别的字段就用 overrides 覆盖。 */
export function testOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "o-1",
    clientOrderId: "c-1",
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    timeInForce: "GTC",
    price: parse("50000"),
    stopPrice: null,
    workingType: "CONTRACT_PRICE",
    qty: parse("1"),
    executedQty: 0n,
    avgPrice: 0n,
    reduceOnly: false,
    closePosition: false,
    status: "NEW",
    triggered: false,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n,
    rejectReason: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function levels(rows: [string, string][]): Level[] {
  return rows.map(([price, qty]) => ({ price: parse(price), qty: parse(qty) }));
}

/**
 * BTCUSDT 的一份盘口。卖方前三档就是 04-backend-design.md 5.3 节"市价买 5 BTC"算例用的那三档，
 * 两边各 7 BTC 可见深度——按 50% 算，市价单最多 3.5 BTC（校验链第 11 步）。
 */
export function bookInput(ts = T0): Extract<EngineInput, { t: "book" }> {
  return {
    t: "book",
    symbol: "BTCUSDT",
    bids: levels([
      ["49999.9", "2"],
      ["49999.5", "2"],
      ["49999", "3"],
    ]),
    asks: levels([
      ["50000", "2"],
      ["50000.5", "2"],
      ["50001", "3"],
    ]),
    ts,
  };
}

/**
 * 更深的盘口：前三档和 bookInput 一样，后面各加一档 10 BTC，两边可见深度 17 BTC（市价单最多 8.5 BTC）。
 * 用来测 04-backend-design.md 5.3 节"市价买 5 BTC"——bookInput 只有 7 BTC 深度，5 BTC 会被第 11 步拒掉。
 */
export function deepBookInput(ts = T0): Extract<EngineInput, { t: "book" }> {
  const book = bookInput(ts);
  return {
    ...book,
    bids: [...book.bids, { price: parse("49998"), qty: parse("10") }],
    asks: [...book.asks, { price: parse("50002"), qty: parse("10") }],
  };
}

export function markPriceInput(markPrice = "50000", ts = T0): Extract<EngineInput, { t: "markPrice" }> {
  return {
    t: "markPrice",
    symbol: "BTCUSDT",
    markPrice: parse(markPrice),
    fundingRate: parse("0.0001"),
    nextFundingTs: ts + 8 * 3600 * 1000,
    ts,
  };
}

/** 单向模式下限价买 1 BTC @ 50,000。需要别的字段就用 overrides 覆盖（设成 undefined 等于没传）。 */
export function orderRequest(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return {
    clientOrderId: "c-1",
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    timeInForce: "GTC",
    price: parse("50000"),
    qty: parse("1"),
    ...overrides,
  };
}

export function placeOrderInput(
  req: PlaceOrderRequest,
  accountId = "acc-1",
  orderId = "o-1",
  ts = T0,
): Extract<EngineInput, { t: "placeOrder" }> {
  return { t: "placeOrder", accountId, orderId, req, ts };
}

/** 全仓多头 1 BTC @ 50,000、20x。单向模式也存成 LONG / SHORT（见 validate-order.ts 顶部注释）。 */
export function testPosition(overrides: Partial<Position> = {}): Position {
  return {
    accountId: "acc-1",
    symbol: "BTCUSDT",
    positionSide: "LONG",
    marginMode: "CROSS",
    leverageNum: 20,
    qty: parse("1"),
    entryPrice: parse("50000"),
    isolatedMargin: 0n,
    openedAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}
