import { divRound, parse } from "@binance-contract-trading-full-stack/shared";
import { expect, it } from "vitest";
import { T0, markPriceInput, orderRequest, placeOrderInput, registerAccountInput, testConfig } from "../../../../packages/engine/src/testing/fixtures";
import { createTestEngine } from "../../../../packages/engine/src/testing/harness";
import type { EngineEvent, Level } from "../../../../packages/engine/src/types";

/**
 * 引擎内核的毕业考试：01-domain-knowledge.md 第十二节"一笔完整交易的资金流水"整张表，
 * 全部用真实输入重放（调设置、下单、行情、资金费结算、挂单成交），不用快照手改状态。
 *
 * | 步骤 | 动作                                         | 钱包余额 |
 * | 1    | 市价开多 1 BTC @ 50,000，10x，逐仓            | 9,975    |
 * | 2    | 价格涨到 51,000（浮盈不进钱包）               | 9,975    |
 * | 3    | 资金费结算，费率 +0.01%，标记价 51,000        | 9,969.9  |
 * | 4    | 限价 52,000 平多，Maker 成交                  | 11,959.5 |
 */
function levels(rows: [string, string][]): Level[] {
  return rows.map(([price, qty]) => ({ price: parse(price), qty: parse(qty) }));
}

it("01-domain-knowledge.md 第十二节整张资金流水表：净收益 +1,959.5，ROE +39.19%", () => {
  const t = createTestEngine(testConfig());
  const wallet = () => t.engine.snapshot().accounts[0]!.walletBalance;
  const ledger = (events: EngineEvent[]) =>
    events.flatMap((e) => (e.t === "balanceUpdate" ? [[e.reason, e.delta, e.walletBalance]] : []));

  // 开户 10,000，设成 10x 逐仓
  expect(ledger(t.apply(registerAccountInput("acc-1", "10000")))).toEqual([["INITIAL", parse("10000"), parse("10000")]]);
  t.apply({ t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode: "ISOLATED", ts: T0 });
  t.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, ts: T0 });
  t.apply({ t: "book", symbol: "BTCUSDT", bids: levels([["49999.9", "5"]]), asks: levels([["50000", "5"]]), ts: T0 });
  t.apply(markPriceInput("50000"));

  // ① 市价开多 1 BTC @ 50,000：Taker 费 25，逐仓保证金 5,000（不从钱包扣，缺口 #6）
  const step1 = t.apply(placeOrderInput(orderRequest({ type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("1") })));
  expect(ledger(step1)).toEqual([["FEE", parse("-25"), parse("9975")]]);
  expect(t.engine.snapshot().positions[0]).toMatchObject({ marginMode: "ISOLATED", leverageNum: 10, isolatedMargin: parse("5000") });

  // ② 价格涨到 51,000：浮盈 +1,000 不进钱包，没有任何流水
  expect(t.apply(markPriceInput("51000", T0 + 1))).toEqual([]);
  expect(wallet()).toBe(parse("9975"));

  // ③ 资金费：51,000 × 0.01% = 5.1，从逐仓仓位付
  const step3 = t.apply({ t: "settleFunding", symbol: "BTCUSDT", rate: parse("0.0001"), markPrice: parse("51000"), ts: T0 + 2 });
  expect(ledger(step3)).toEqual([["FUNDING", parse("-5.1"), parse("9969.9")]]);

  // ④ 限价 52,000 平多：挂单排在这一档 2 BTC 后面，主动买单吃掉 3 BTC → Maker 成交
  t.apply({ t: "book", symbol: "BTCUSDT", bids: levels([["51000", "5"]]), asks: levels([["51000.5", "3"], ["52000", "2"]]), ts: T0 + 3 });
  t.apply(placeOrderInput(orderRequest({ clientOrderId: "c-2", side: "SELL", price: parse("52000") }), "acc-1", "o-2", T0 + 3));
  const step4 = t.apply({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("52000"), qty: parse("3"), buyerIsMaker: false, ts: T0 + 4 });
  expect(ledger(step4)).toEqual([
    ["REALIZED_PNL", parse("2000"), parse("11969.9")],
    ["FEE", parse("-10.4"), parse("11959.5")],
  ]);

  // 结果：钱包 11,959.5，仓位平完，流水之和 = 钱包
  expect(wallet()).toBe(parse("11959.5"));
  expect(t.engine.snapshot().positions).toEqual([]);
  expect(t.ledgerSum("acc-1")).toBe(parse("11959.5"));

  // 净收益 +1,959.5；ROE = 1,959.5 ÷ 起始保证金 5,000 = 39.19%；摩擦成本 = 手续费 35.4 + 资金费 5.1 = 40.5
  expect(wallet() - parse("10000")).toBe(parse("1959.5"));
  expect(divRound(wallet() - parse("10000"), parse("5000"))).toBe(parse("0.3919"));
  const friction = [...ledger(step1), ...ledger(step3), ...ledger(step4)]
    .filter(([reason]) => reason === "FEE" || reason === "FUNDING")
    .reduce((sum, [, delta]) => sum - (delta as bigint), 0n);
  expect(friction).toBe(parse("40.5"));
});
