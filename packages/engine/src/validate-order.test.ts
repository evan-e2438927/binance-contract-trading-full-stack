import { parse, type ErrorCode, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { applyInput } from "./apply";
import { putAccount, putOrder, putPosition, putSetting } from "./journal";
import { createState, type EngineState } from "./state";
import {
  BTCUSDT,
  BTCUSDT_BRACKETS,
  bookInput,
  markPriceInput,
  orderRequest,
  registerAccountInput,
  testConfig,
  testOrder,
  testPosition,
} from "./testing/fixtures";
import type { EngineConfig, PlaceOrderRequest } from "./types";
import { maxNotionalFor, validateOrder, type OrderValidation, type ValidatedOrder } from "./validate-order";

// ─────────────────────────────────────────────────────────────
// 测试工具
// ─────────────────────────────────────────────────────────────

interface SetupOptions {
  wallet?: string;
  mode?: PositionMode;
  config?: EngineConfig;
  /** false = 不喂盘口和标记价（测第 2 步用） */
  market?: boolean;
}

/** 一个开好户、有盘口（两边各 7 BTC）、标记价 50,000 的引擎状态。默认单向模式、钱包 10,000、杠杆默认 20x。 */
function setup({ wallet = "10000", mode = "ONE_WAY", config = testConfig(), market = true }: SetupOptions = {}) {
  const state = createState(config);
  applyInput(state, { ...registerAccountInput("acc-1", wallet), positionMode: mode });
  if (market) {
    applyInput(state, bookInput());
    applyInput(state, markPriceInput("50000"));
  }
  return state;
}

function validate(state: EngineState, overrides: Partial<PlaceOrderRequest> = {}): OrderValidation {
  return validateOrder(state, "acc-1", orderRequest(overrides));
}

function expectRejected(result: OrderValidation, code: ErrorCode, message?: string | RegExp): void {
  if (result.ok) {
    throw new Error(`期望被拒（${code}），实际通过了`);
  }
  expect(result.code).toBe(code);
  if (message !== undefined) expect(result.message).toMatch(message);
}

function expectAccepted(result: OrderValidation): ValidatedOrder {
  if (!result.ok) {
    throw new Error(`期望通过，实际被拒：${result.code} ${result.message}`);
  }
  return result.order;
}

function setLeverage(state: EngineState, leverageNum: number): void {
  putSetting(state, { accountId: "acc-1", symbol: "BTCUSDT", leverageNum, marginMode: "CROSS" });
}

// ─────────────────────────────────────────────────────────────
// 13 步，每步至少一条
// ─────────────────────────────────────────────────────────────

describe("① SYMBOL_NOT_TRADING", () => {
  it("不存在的币对", () => {
    expectRejected(validate(setup(), { symbol: "DOGEUSDT" }), "SYMBOL_NOT_TRADING", "不支持的交易对 DOGEUSDT");
  });

  it("币安状态不是 TRADING", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, status: "SETTLING" }];
    expectRejected(validate(setup({ config })), "SYMBOL_NOT_TRADING", "BTCUSDT 暂停交易");
  });

  it("我们没有对用户开放", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, enabled: false }];
    expectRejected(validate(setup({ config })), "SYMBOL_NOT_TRADING");
  });
});

describe("② MARKET_NOT_READY", () => {
  it("没有盘口", () => {
    const state = setup({ market: false });
    applyInput(state, markPriceInput());
    expectRejected(validate(state), "MARKET_NOT_READY", "行情尚未就绪");
  });

  it("没有标记价", () => {
    const state = setup({ market: false });
    applyInput(state, bookInput());
    expectRejected(validate(state), "MARKET_NOT_READY");
  });

  it("盘口有一边是空的", () => {
    const state = setup();
    applyInput(state, { ...bookInput(), asks: [] });
    expectRejected(validate(state), "MARKET_NOT_READY");
  });
});

describe("③ INVALID_PARAMS", () => {
  it.each<[string, Partial<PlaceOrderRequest>, string]>([
    ["限价单没有委托价", { price: undefined }, "LIMIT 单必须填委托价"],
    ["委托价为 0", { price: 0n }, "委托价必须大于 0"],
    ["市价单带委托价", { type: "MARKET", timeInForce: undefined }, "MARKET 单不接受委托价"],
    ["市价单带 TIF", { type: "MARKET", price: undefined }, "MARKET 单不接受 timeInForce"],
    ["限价单带触发价", { stopPrice: parse("49000") }, "LIMIT 单不接受触发价"],
    [
      "止损市价单没有触发价",
      { type: "STOP_MARKET", price: undefined, timeInForce: undefined },
      "STOP_MARKET 单必须填触发价",
    ],
    ["非触发单指定 workingType", { workingType: "CONTRACT_PRICE" }, "只有触发单才能指定 workingType"],
    ["限价单用 closePosition", { closePosition: true, qty: undefined }, "closePosition 只能用于"],
    [
      "closePosition 同时设 reduceOnly",
      {
        type: "STOP_MARKET",
        side: "SELL",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("48000"),
        closePosition: true,
        reduceOnly: true,
        qty: undefined,
      },
      "不要同时设置 reduceOnly",
    ],
    [
      "closePosition 还填了数量",
      {
        type: "STOP_MARKET",
        side: "SELL",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("48000"),
        closePosition: true,
      },
      "不要填数量",
    ],
    ["没有数量", { qty: undefined }, "必须填数量"],
    ["数量为 0", { qty: 0n }, "数量必须大于 0"],
  ])("%s", (_name, overrides, message) => {
    expectRejected(validate(setup(), overrides), "INVALID_PARAMS", message);
  });

  it("双向模式传 reduceOnly：币安不允许（Cannot be sent in Hedge Mode），传 false 也算传了", () => {
    const state = setup({ mode: "HEDGE" });
    putPosition(state, testPosition());
    const close = { side: "SELL", positionSide: "LONG" } as const;
    expectRejected(validate(state, { ...close, reduceOnly: true }), "INVALID_PARAMS", "双向持仓模式下不能传 reduceOnly");
    expectRejected(validate(state, { ...close, reduceOnly: false }), "INVALID_PARAMS", "双向持仓模式下不能传 reduceOnly");
    expectAccepted(validate(state, close));
  });

  it("双向模式 closePosition 用在开仓方向（SELL + SHORT）：拒", () => {
    const state = setup({ mode: "HEDGE" });
    putPosition(state, testPosition({ positionSide: "SHORT" }));
    expectRejected(
      validate(state, {
        type: "STOP_MARKET",
        side: "SELL",
        positionSide: "SHORT",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("52000"),
        closePosition: true,
        qty: undefined,
      }),
      "INVALID_PARAMS",
      "SELL + SHORT 是开仓方向，不能用 closePosition",
    );
  });

  it("三种典型下单都能过第 3 步：限价开多、市价、止损市价全平", () => {
    const state = setup();
    putPosition(state, testPosition());
    expectAccepted(validate(state));
    expectAccepted(validate(state, { type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("0.1") }));
    expectAccepted(
      validate(state, {
        type: "STOP_MARKET",
        side: "SELL",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("48000"),
        closePosition: true,
        qty: undefined,
      }),
    );
  });
});

describe("④ POSITION_SIDE_MISMATCH", () => {
  it("单向模式传 LONG", () => {
    expectRejected(validate(setup(), { positionSide: "LONG" }), "POSITION_SIDE_MISMATCH", "必须是 BOTH");
  });

  it("双向模式传 BOTH", () => {
    expectRejected(
      validate(setup({ mode: "HEDGE" }), { positionSide: "BOTH" }),
      "POSITION_SIDE_MISMATCH",
      "必须是 LONG 或 SHORT",
    );
  });
});

describe("⑤ PRICE_FILTER / LOT_SIZE（BTCUSDT：价格 556.8 ~ 4529764，限价单数量 0.001 ~ 1000，市价单数量 0.001 ~ 120）", () => {
  it("委托价不是 tickSize 0.1 的整数倍", () => {
    expectRejected(
      validate(setup(), { price: parse("50000.05") }),
      "PRICE_FILTER",
      "委托价 50000.05 不是最小价格变动 0.1 的整数倍",
    );
  });

  it("触发价也要对齐", () => {
    expectRejected(
      validate(setup(), { type: "STOP", stopPrice: parse("51000.01") }),
      "PRICE_FILTER",
      "触发价 51000.01",
    );
  });

  it.each(["556.7", "4529764.1"])("价格 %s 超出 minPrice / maxPrice（币安 -4013 / -4002）", (price) => {
    expectRejected(
      validate(setup(), { price: parse(price) }),
      "PRICE_FILTER",
      `委托价 ${price} 超出允许范围 556.8 ~ 4529764`,
    );
  });

  it("触发价超出范围也拒（币安 -4007）", () => {
    expectRejected(
      validate(setup(), { type: "STOP", stopPrice: parse("5000000") }),
      "PRICE_FILTER",
      "触发价 5000000 超出允许范围",
    );
  });

  it("数量不是 stepSize 0.001 的整数倍", () => {
    expectRejected(
      validate(setup(), { qty: parse("0.0015") }),
      "LOT_SIZE",
      "数量 0.0015 不是最小数量变动 0.001 的整数倍",
    );
  });

  it("数量低于 minQty（币安 -4004）", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, minQty: parse("0.002") }];
    expectRejected(
      validate(setup({ config }), { qty: parse("0.001") }),
      "LOT_SIZE",
      "数量 0.001 BTC 低于最小下单量 0.002 BTC",
    );
  });

  it("限价单数量超过 maxQty 1000（币安 -4005）", () => {
    expectRejected(validate(setup(), { qty: parse("1000.001") }), "LOT_SIZE", "数量 1000.001 BTC 超过最大下单量 1000 BTC");
  });

  it("市价单用 MARKET_LOT_SIZE：120.001 BTC 超过市价单上限 120，限价单同样数量不受这条限制", () => {
    const market = { type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("120.001") } as const;
    expectRejected(validate(setup(), market), "LOT_SIZE", "市价单数量 120.001 BTC 超过最大下单量 120 BTC");
    // 同样的数量挂限价单，第 5 步放行（后面会卡在余额上）
    expectRejected(validate(setup(), { qty: parse("120.001") }), "INSUFFICIENT_MARGIN");
  });
});

describe("⑥ MIN_NOTIONAL", () => {
  it("名义价值低于 minNotional", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, minNotional: parse("100") }];
    expectRejected(
      validate(setup({ config }), { qty: parse("0.001") }),
      "MIN_NOTIONAL",
      "名义价值 50 USDT 低于最小下单金额 100 USDT",
    );
  });

  it("减仓单不查最小名义价值（币安 -4164：unless you choose reduce only）：剩下的小仓位必须能平掉", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, minNotional: parse("100") }];
    const state = setup({ config });
    putPosition(state, testPosition({ qty: parse("0.001") }));

    expectAccepted(validate(state, { side: "SELL", qty: parse("0.001"), reduceOnly: true }));
  });
});

describe("⑦ PERCENT_PRICE（标记价 50,000，BTCUSDT 上下限 ×1.05 / ×0.95）", () => {
  it.each(["47500", "52500"])("恰好在边界上：%s 放行", (price) => {
    expectAccepted(validate(setup(), { price: parse(price) }));
  });

  it.each(["47499.9", "52500.1"])("超出边界：%s 拒绝", (price) => {
    expectRejected(
      validate(setup(), { price: parse(price) }),
      "PERCENT_PRICE",
      `委托价 ${price} 超出价格保护范围：标记价 50000 下允许范围 47500 ~ 52500`,
    );
  });

  it("上下限按币对配置：有的币对是 ×1.15 / ×0.85", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, percentPriceUp: parse("1.15"), percentPriceDown: parse("0.85") }];
    const state = setup({ config, wallet: "100000" });
    expectAccepted(validate(state, { price: parse("57500") }));
    expectRejected(validate(state, { price: parse("57500.1") }), "PERCENT_PRICE", "允许范围 42500 ~ 57500");
  });

  it("市价单查对手方最优价（币安 -4131）：标记价 47,000 时对手方最优价超出上限 49,350，市价单被拒", () => {
    const state = setup();
    applyInput(state, markPriceInput("47000"));
    const market = { type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("0.1") } as const;
    expectRejected(
      validate(state, market),
      "PERCENT_PRICE",
      "对手方最优价 50000 超出价格保护范围，市价单暂不接受：标记价 47000 下允许范围 44650 ~ 49350",
    );
    // 市价卖看的是买一 49,999.9，同样超出上限
    expectRejected(validate(state, { ...market, side: "SELL" }), "PERCENT_PRICE", "对手方最优价 49999.9");
    // 标记价回到 50,000，两边都放行
    applyInput(state, markPriceInput("50000"));
    expectAccepted(validate(state, market));
    expectAccepted(validate(state, { ...market, side: "SELL" }));
  });

  it("止损限价单的委托价不在下单时检查（触发时才挂出去）", () => {
    expectAccepted(validate(setup(), { type: "STOP", price: parse("40000"), stopPrice: parse("51000") }));
  });
});

describe("⑧ REDUCE_ONLY_REJECTED", () => {
  it("没有仓位时下只减仓单", () => {
    expectRejected(
      validate(setup(), { side: "SELL", reduceOnly: true }),
      "REDUCE_ONLY_REJECTED",
      "没有可以减少的多头仓位",
    );
  });

  it("单向模式持多，只减仓的方向却是买（只能减空）", () => {
    const state = setup();
    putPosition(state, testPosition());
    expectRejected(validate(state, { side: "BUY", reduceOnly: true }), "REDUCE_ONLY_REJECTED", "空头仓位");
  });

  it("减仓数量超过仓位", () => {
    const state = setup();
    putPosition(state, testPosition());
    expectRejected(
      validate(state, { side: "SELL", qty: parse("1.5"), reduceOnly: true }),
      "REDUCE_ONLY_REJECTED",
      "减仓数量 1.5 BTC 超过了多头仓位剩余 1 BTC",
    );
  });

  it("双向模式：SELL + LONG 天生是平多，不勾 reduceOnly 也不能超过仓位（双向模式禁止反手）", () => {
    const state = setup({ mode: "HEDGE" });
    putPosition(state, testPosition());
    expectRejected(
      validate(state, { side: "SELL", positionSide: "LONG", qty: parse("2") }),
      "REDUCE_ONLY_REJECTED",
      "超过了多头仓位剩余 1 BTC",
    );
  });

  it("没有仓位时下 closePosition 止损单", () => {
    expectRejected(
      validate(setup(), {
        type: "STOP_MARKET",
        side: "SELL",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("48000"),
        closePosition: true,
        qty: undefined,
      }),
      "REDUCE_ONLY_REJECTED",
    );
  });
});

describe("⑨ LEVERAGE_TOO_HIGH（示例分层表：≤50,000 最高 125x，≤600,000 最高 100x）", () => {
  it("125x 开 50,000 名义价值：恰好在第 1 层上限，放行", () => {
    const state = setup();
    setLeverage(state, 125);
    expectAccepted(validate(state, { qty: parse("1") }));
  });

  it("125x 开 50,050 名义价值：跨进第 2 层，拒单（和币安 -2027 一致）", () => {
    const state = setup();
    setLeverage(state, 125);
    expectRejected(
      validate(state, { qty: parse("1.001") }),
      "LEVERAGE_TOO_HIGH",
      "当前杠杆 125x 下，BTCUSDT 最大可开名义价值 50000 USDT；本单成交后将达到 50050 USDT，该档位最高 100x",
    );
  });

  it("已有同方向仓位按标记价算进去", () => {
    const state = setup({ wallet: "100000" });
    setLeverage(state, 125);
    putPosition(state, testPosition({ qty: parse("0.5"), leverageNum: 125 }));
    expectRejected(validate(state, { qty: parse("0.6") }), "LEVERAGE_TOO_HIGH", "本单成交后将达到 55000 USDT");
  });

  it("同方向的其它开仓挂单也算进去：拆成小单绕不过去", () => {
    const state = setup();
    setLeverage(state, 125);
    putOrder(state, testOrder({ id: "o-pending", qty: parse("0.5"), price: parse("50000") }));
    expectRejected(validate(state, { qty: parse("0.6") }), "LEVERAGE_TOO_HIGH", "本单成交后将达到 55000 USDT");
  });

  it("反方向的挂单、只减仓挂单不算", () => {
    const state = setup();
    setLeverage(state, 125);
    putPosition(state, testPosition({ qty: parse("1"), positionSide: "SHORT", leverageNum: 125 }));
    putOrder(state, testOrder({ id: "o-sell", side: "SELL", qty: parse("0.5") }));
    putOrder(state, testOrder({ id: "o-ro", side: "BUY", qty: parse("0.5"), reduceOnly: true }));
    // 持空 1 BTC，买 2 BTC = 平 1 + 开 1 → 开仓部分 50,000，恰好在第 1 层
    const order = expectAccepted(validate(state, { qty: parse("2") }));
    expect(order.openQty).toBe(parse("1"));
  });

  it("超出分层表最后一层的上限", () => {
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, maxQty: parse("100000") }]; // 放宽数量上限，让单子走到第 9 步
    const state = setup({ config, wallet: "1000000000" });
    setLeverage(state, 1);
    expectRejected(
      validate(state, { qty: parse("16001") }),
      "LEVERAGE_TOO_HIGH",
      "超出 BTCUSDT 最大可持仓名义价值 800000000 USDT",
    );
  });

  it("maxNotionalFor：给定杠杆下最多能开多大", () => {
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 125)).toBe(parse("50000"));
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 101)).toBe(parse("50000"));
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 100)).toBe(parse("600000"));
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 20)).toBe(parse("12000000"));
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 1)).toBe(parse("800000000"));
    expect(maxNotionalFor(BTCUSDT_BRACKETS, 126)).toBe(0n);
  });
});

describe("⑩ INSUFFICIENT_MARGIN（默认 20x，Taker 费率 0.05%）", () => {
  it("限价买 4 BTC @ 50,000：需要 10,000 + 100 = 10,100，钱包 10,000 不够", () => {
    expectRejected(
      validate(setup(), { qty: parse("4") }),
      "INSUFFICIENT_MARGIN",
      "可用余额 10000 USDT 不足，本单需要 10100 USDT（20x 起始保证金 + 预留手续费）",
    );
  });

  it("钱包恰好 10,100：放行，requiredMargin 就是挂单要冻结的保证金", () => {
    const order = expectAccepted(validate(setup({ wallet: "10100" }), { qty: parse("4") }));
    expect(order.requiredMargin).toBe(parse("10100"));
  });

  it("全仓浮亏和全仓起始保证金都从可用余额里扣", () => {
    const state = setup();
    // 持多 1 BTC @ 52,000（20x → 起始保证金 2,600），标记价 50,000 → 浮亏 2,000
    // 可用 = 10,000 − 2,000 − 2,600 = 5,400
    putPosition(state, testPosition({ entryPrice: parse("52000") }));
    expectAccepted(validate(state, { qty: parse("2.1") })); // 5,250 + 52.5 = 5,302.5
    expectRejected(validate(state, { qty: parse("2.2") }), "INSUFFICIENT_MARGIN", "可用余额 5400 USDT"); // 5,555
  });

  it("逐仓保证金和挂单冻结保证金也扣", () => {
    const state = setup();
    putPosition(state, testPosition({ marginMode: "ISOLATED", isolatedMargin: parse("3000") }));
    putOrder(state, testOrder({ id: "o-frozen", side: "SELL", price: parse("52000"), frozenMargin: parse("2000") }));
    // 可用 = 10,000 − 3,000 − 2,000 = 5,000。单向模式持多，BUY 是加仓
    expectRejected(validate(state, { qty: parse("2") }), "INSUFFICIENT_MARGIN", "可用余额 5000 USDT"); // 5,050
  });

  it("市价单按盘口逐档估算：买 3 BTC 吃 2 @ 50,000 + 1 @ 50,000.5", () => {
    // 名义价值 150,000.5 → 起始保证金 7,500.025；手续费逐档向上取整 50 + 25.00025
    const market = { type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("3") } as const;
    const order = expectAccepted(validate(setup({ wallet: "7575.02525" }), market));
    expect(order.requiredMargin).toBe(parse("7575.02525"));
    expectRejected(validate(setup({ wallet: "7575.02524" }), market), "INSUFFICIENT_MARGIN");
  });

  it("单向模式反手：只有开仓部分要保证金，而且按平仓吃剩下的档位估", () => {
    const state = setup({ wallet: "100000" });
    putPosition(state, testPosition()); // 持多 1 BTC
    const order = expectAccepted(
      validate(state, { type: "MARKET", side: "SELL", price: undefined, timeInForce: undefined, qty: parse("2") }),
    );
    expect(order).toMatchObject({ closeSide: "LONG", openSide: "SHORT", closeQty: parse("1"), openQty: parse("1") });
    // 买一 49,999.9 有 2 BTC：第 1 个平多，第 2 个开空 → 名义 49,999.9，保证金 2,499.995，手续费 24.99995
    expect(order.requiredMargin).toBe(parse("2524.99495"));
  });

  it("纯减仓单不需要保证金：可用余额是 0 也能平", () => {
    const state = setup();
    putPosition(state, testPosition({ marginMode: "ISOLATED", isolatedMargin: parse("10000") }));
    const order = expectAccepted(validate(state, { side: "SELL", reduceOnly: true }));
    expect(order.requiredMargin).toBe(0n);
  });

  it("未触发的触发单不占保证金，下单时不查余额", () => {
    const order = expectAccepted(
      validate(setup(), {
        type: "STOP_MARKET",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("51000"),
        qty: parse("100"),
      }),
    );
    expect(order.requiredMargin).toBe(0n);
  });

  it("另一个币对的全仓仓位缺标记价：算不出可用余额就拒，不拿 0 顶替", () => {
    const config = testConfig();
    config.symbols.push({ ...BTCUSDT, symbol: "ETHUSDT" });
    config.brackets.ETHUSDT = BTCUSDT_BRACKETS;
    const state = setup({ config });
    putPosition(state, testPosition({ symbol: "ETHUSDT" }));
    expectRejected(validate(state), "MARKET_NOT_READY", "缺少 ETHUSDT 的标记价");
  });
});

describe("⑪ MARKET_ORDER_TOO_LARGE（卖方可见深度 7 BTC，最多吃 50%）", () => {
  const market = { type: "MARKET", price: undefined, timeInForce: undefined } as const;

  it("3.5 BTC 放行", () => {
    expectAccepted(validate(setup(), { ...market, qty: parse("3.5") }));
  });

  it("3.501 BTC 拒单，提示里给出最大可成交数量", () => {
    expectRejected(
      validate(setup(), { ...market, qty: parse("3.501") }),
      "MARKET_ORDER_TOO_LARGE",
      "当前深度下最大可市价成交 3.5 BTC，请减小数量或用限价单",
    );
  });

  it("只减仓的市价单也受限：深度不够就是不够", () => {
    const state = setup();
    putPosition(state, testPosition({ qty: parse("5") }));
    expectRejected(
      validate(state, { ...market, side: "SELL", qty: parse("4"), reduceOnly: true }),
      "MARKET_ORDER_TOO_LARGE",
    );
  });
});

describe("⑫ POST_ONLY_REJECTED（买一 49,999.9，卖一 50,000）", () => {
  it("GTX 买单挂在卖一价：会立刻成交，拒", () => {
    expectRejected(
      validate(setup(), { timeInForce: "GTX", price: parse("50000") }),
      "POST_ONLY_REJECTED",
      "委托价 50000，对手方最优价 50000",
    );
  });

  it("GTX 买单挂在买一价：不会成交，放行", () => {
    expectAccepted(validate(setup(), { timeInForce: "GTX", price: parse("49999.9") }));
  });

  it("GTX 卖单挂在买一价：拒；挂在卖一价：放行", () => {
    const state = setup({ mode: "HEDGE" });
    const sell = { side: "SELL", positionSide: "SHORT", timeInForce: "GTX" } as const;
    expectRejected(validate(state, { ...sell, price: parse("49999.9") }), "POST_ONLY_REJECTED");
    expectAccepted(validate(state, { ...sell, price: parse("50000") }));
  });

  it("GTC 买单挂在卖一价不受影响（它会作为 Taker 成交，第 05 讲）", () => {
    expectAccepted(validate(setup(), { price: parse("50000") }));
  });
});

describe("⑬ TOO_MANY_ORDERS（币安 MAX_NUM_ORDERS：每个币对 200）", () => {
  function withOpenOrders(count: number) {
    const state = setup();
    for (let i = 0; i < count; i++) {
      putOrder(state, testOrder({ id: `o-${i}`, side: "SELL", price: parse("52000"), qty: parse("0.001") }));
    }
    return state;
  }

  it("已有 199 张：还能再挂一张", () => {
    expectAccepted(validate(withOpenOrders(199)));
  });

  it("已有 200 张：拒", () => {
    expectRejected(
      validate(withOpenOrders(200)),
      "TOO_MANY_ORDERS",
      "BTCUSDT 上已有 200 张挂单，达到该币对上限 200 张",
    );
  });

  it("触发单也占挂单位", () => {
    expectRejected(
      validate(withOpenOrders(200), { type: "STOP", stopPrice: parse("51000") }),
      "TOO_MANY_ORDERS",
    );
  });

  it("市价单、IOC、FOK 不留在挂单簿里，不受限——挂满了也能市价平仓", () => {
    const state = withOpenOrders(200);
    expectAccepted(validate(state, { type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("0.1") }));
    expectAccepted(validate(state, { timeInForce: "IOC" }));
    expectAccepted(validate(state, { timeInForce: "FOK" }));
  });

  it("按币对分别计数：ETHUSDT 挂满 200 张，不影响在 BTCUSDT 下单", () => {
    const config = testConfig();
    config.symbols.push({ ...BTCUSDT, symbol: "ETHUSDT" });
    config.brackets.ETHUSDT = BTCUSDT_BRACKETS;
    const state = setup({ config });
    for (let i = 0; i < 200; i++) {
      putOrder(state, testOrder({ id: `o-${i}`, symbol: "ETHUSDT", side: "SELL", qty: parse("0.001") }));
    }
    expectAccepted(validate(state));
  });

  it("只数自己账户的挂单", () => {
    const state = setup();
    applyInput(state, registerAccountInput("acc-2"));
    for (let i = 0; i < 200; i++) {
      putOrder(state, testOrder({ id: `o-${i}`, accountId: "acc-2" }));
    }
    expectAccepted(validate(state));
  });
});

// ─────────────────────────────────────────────────────────────
// 顺序
// ─────────────────────────────────────────────────────────────

describe("顺序", () => {
  it("第 9 步在第 10 步之前：杠杆不允许时，不会给出'余额不足'这种误导提示", () => {
    const state = setup({ wallet: "100" });
    setLeverage(state, 125);
    // 1.001 BTC 在 125x 下既跨层（LEVERAGE_TOO_HIGH）又远超 100 USDT 的余额（INSUFFICIENT_MARGIN）
    expectRejected(validate(state, { qty: parse("1.001") }), "LEVERAGE_TOO_HIGH");

    // 对照组：把杠杆调到允许的 100x，同一张单才轮到余额检查
    setLeverage(state, 100);
    expectRejected(validate(state, { qty: parse("1.001") }), "INSUFFICIENT_MARGIN");
  });

  it("一张同时违反第 4～13 步（第 8 步除外）的单：每修好一处，才暴露出下一步的错误", () => {
    // 第 8 步不放进来：只减仓单不查第 6 步的最小名义价值，也不走第 9、10 步，和这条链上的其它错误无法同时出现。
    // 它在第 9 步之前，由下一条测试单独证明。
    const config = testConfig();
    config.symbols = [{ ...BTCUSDT, minNotional: parse("100") }];
    const state = setup({ config, wallet: "100" });
    setLeverage(state, 125);
    for (let i = 0; i < 200; i++) {
      putOrder(state, testOrder({ id: `o-${i}`, side: "SELL", price: parse("52000"), qty: parse("0.001") }));
    }

    let req = orderRequest({
      positionSide: "LONG", // ④ 单向模式应为 BOTH
      price: parse("44000.05"), // ⑤ 没对齐；对齐后 ⑦ 超出价格保护范围
      qty: parse("0.0005"), // ⑤ 低于最小下单量；改成 0.001 后 ⑥ 名义价值 44 < 100
      timeInForce: "GTX", // ⑫ 价格改到卖一之后会立刻成交
    });
    const next = (fix: Partial<PlaceOrderRequest>) => {
      req = { ...req, ...fix };
      return validateOrder(state, "acc-1", req);
    };

    expectRejected(next({}), "POSITION_SIDE_MISMATCH");
    expectRejected(next({ positionSide: "BOTH" }), "PRICE_FILTER");
    expectRejected(next({ price: parse("44000") }), "LOT_SIZE");
    expectRejected(next({ qty: parse("0.001") }), "MIN_NOTIONAL");
    expectRejected(next({ qty: parse("1.001") }), "PERCENT_PRICE");
    expectRejected(next({ price: parse("50000") }), "LEVERAGE_TOO_HIGH");
    setLeverage(state, 100);
    expectRejected(next({}), "INSUFFICIENT_MARGIN");
    putAccount(state, { ...state.accounts.get("acc-1")!, walletBalance: parse("100000") });
    expectRejected(next({}), "POST_ONLY_REJECTED");
    expectRejected(next({ price: parse("49999.9") }), "TOO_MANY_ORDERS");
    expectRejected(
      next({ type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("3.501") }),
      "MARKET_ORDER_TOO_LARGE",
    );
    expectAccepted(next({ qty: parse("3.5") }));
  });

  it("第 8 步在第 9 步之前：125x 下超量的只减仓单报 REDUCE_ONLY_REJECTED，而不是杠杆问题", () => {
    const state = setup();
    setLeverage(state, 125);
    putPosition(state, testPosition({ leverageNum: 125 }));
    expectRejected(validate(state, { side: "SELL", qty: parse("2"), reduceOnly: true }), "REDUCE_ONLY_REJECTED");
  });
});

// ─────────────────────────────────────────────────────────────
// 通过时带出来的东西
// ─────────────────────────────────────────────────────────────

describe("校验通过后的结果", () => {
  it("限价单不传 TIF 默认 GTC；workingType 默认 CONTRACT_PRICE（和币安一致）；默认 20x 全仓", () => {
    const order = expectAccepted(validate(setup(), { timeInForce: undefined }));
    expect(order).toMatchObject({
      timeInForce: "GTC",
      workingType: "CONTRACT_PRICE",
      leverageNum: 20,
      marginMode: "CROSS",
      openSide: "LONG",
      closeSide: "SHORT",
      openQty: parse("1"),
      closeQty: 0n,
      requiredMargin: parse("2525"), // 50,000 ÷ 20 + 50,000 × 0.05%
    });
  });

  it("closePosition 止损单：数量为 0，平仓数量取当前全部仓位", () => {
    const state = setup();
    putPosition(state, testPosition({ qty: parse("0.7") }));
    const order = expectAccepted(
      validate(state, {
        type: "STOP_MARKET",
        side: "SELL",
        price: undefined,
        timeInForce: undefined,
        stopPrice: parse("48000"),
        closePosition: true,
        qty: undefined,
      }),
    );
    expect(order).toMatchObject({ qty: 0n, closeQty: parse("0.7"), openQty: 0n, closePosition: true });
  });

  it("账户不存在是宿主的 bug，抛错", () => {
    const state = setup();
    expect(() => validateOrder(state, "ghost", orderRequest())).toThrow(/不在引擎里/);
  });

  it("单向模式下同时存在多空两个仓位：状态已损坏，抛错", () => {
    const state = setup();
    putPosition(state, testPosition());
    putPosition(state, testPosition({ positionSide: "SHORT" }));
    expect(() => validate(state, { side: "SELL", reduceOnly: true })).toThrow(/状态已损坏/);
  });
});
