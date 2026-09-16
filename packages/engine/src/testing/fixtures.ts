import { parse } from "@binance-contract-trading-full-stack/shared";
import type { EngineConfig, EngineInput, LeverageBracket, Order, SymbolSpec } from "../types";

/**
 * 测试专用的冻结配置。
 *
 * ⚠️ 故意不读 packages/db 里从币安官方接口同步进数据库的真实分层表：
 * 币安会调表（BTCUSDT 第 1 层上限已经从文档里的 50,000 变成了 300,000），
 * 测试如果跟着真实数据走，币安一调表就全红，而且红得毫无意义。
 * 这里用的是 01-domain-knowledge.md 里那张示例表——所有文档算例都基于它。
 */
export const BTCUSDT: SymbolSpec = {
  symbol: "BTCUSDT",
  status: "TRADING",
  enabled: true,
  tickSize: parse("0.1"),
  stepSize: parse("0.001"),
  minQty: parse("0.001"),
  minNotional: parse("5"),
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
      liquidationFeeRate: parse("0.005"),
    },
    limits: {
      maxOpenOrdersNum: 200,
      percentPriceLimit: parse("0.05"),
      marketDepthRatio: parse("0.5"),
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
    workingType: "MARK_PRICE",
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
