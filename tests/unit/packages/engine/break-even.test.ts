import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import { createEngine } from "../../../../packages/engine/src/create-engine";
import { bookInput, markPriceInput, orderRequest, placeOrderInput, registerAccountInput, testConfig } from "../../../../packages/engine/src/testing/fixtures";
import type { Engine, EngineConfig, EngineInput } from "../../../../packages/engine/src/types";

/**
 * 损益两平价（币安 breakEvenPrice）。
 *
 * 公式和算例来自币安 FAQ「How to Visualize the Breakeven Price of Open Positions on Binance Futures (App)」
 * （2026-09-20 核对）：损益两平价 =（Σ开仓花的钱 + Σ手续费 − Σ平仓收回的钱）÷ 当前有符号数量，
 * 不含资金费。下面第一条就是 FAQ 里那个三笔开仓 + 一笔部分平仓的算例，逐字复算。
 */

function run(engine: Engine, input: EngineInput) {
  const events = engine.apply(input);
  engine.commit();
  return events;
}

/** FAQ 算例用 0.02% 的费率，且价格远离我们默认盘口，所以自己摆一个配置和盘口 */
function faqEngine(): Engine {
  const config: EngineConfig = { ...testConfig(), fees: { makerFeeRate: parse("0.0002"), takerFeeRate: parse("0.0002") } };
  const engine = createEngine(config);
  run(engine, registerAccountInput("acc-1", "1000000"));
  run(engine, markPriceInput("22000"));
  return engine;
}

/** 按指定价格成交：标记价和盘口都摆到这个价（市价单有价格保护，偏离标记价太多会被拒），再用市价单吃掉 */
function fillAt(engine: Engine, price: string, qty: string, side: "BUY" | "SELL", ts: number) {
  run(engine, markPriceInput(price, ts));
  run(engine, {
    t: "book",
    symbol: "BTCUSDT",
    bids: [{ price: parse(price), qty: parse("100") }],
    asks: [{ price: parse(price), qty: parse("100") }],
    ts,
  });
  const events = run(
    engine,
    placeOrderInput(
      orderRequest({ clientOrderId: `c-${ts}`, type: "MARKET", price: undefined, timeInForce: undefined, side, qty: parse(qty) }),
      "acc-1",
      `o-${ts}`,
      ts,
    ),
  );
  const rejected = events.find((e) => e.t === "rejected");
  if (rejected?.t === "rejected") throw new Error(`成交失败：${rejected.message}`);
}

describe("损益两平价（币安 FAQ 算例）", () => {
  it("三笔开多之后：22,204.44", () => {
    const engine = faqEngine();
    fillAt(engine, "20000", "0.5", "BUY", 1);
    fillAt(engine, "22000", "1.5", "BUY", 2);
    fillAt(engine, "25000", "0.5", "BUY", 3);

    const [position] = engine.positionViews("acc-1");
    expect(position?.qty).toBe(parse("2.5"));
    expect(format(position!.breakEvenPrice!, 2)).toBe("22204.44");
  });

  it("再按 25,000 平掉 0.5 之后：21,506.80（平仓收回的钱要减掉，平仓手续费要加上）", () => {
    const engine = faqEngine();
    fillAt(engine, "20000", "0.5", "BUY", 1);
    fillAt(engine, "22000", "1.5", "BUY", 2);
    fillAt(engine, "25000", "0.5", "BUY", 3);
    fillAt(engine, "25000", "0.5", "SELL", 4);

    const [position] = engine.positionViews("acc-1");
    expect(position?.qty).toBe(parse("2"));
    expect(format(position!.breakEvenPrice!, 2)).toBe("21506.80");
  });

  it("空头：两平价在开仓价下方（手续费要靠价格继续跌才赚回来）", () => {
    const engine = faqEngine();
    fillAt(engine, "20000", "1", "SELL", 1);

    const [position] = engine.positionViews("acc-1");
    expect(position?.positionSide).toBe("SHORT");
    // 20,000 − 20,000 × 0.02% = 19,996
    expect(format(position!.breakEvenPrice!, 2)).toBe("19996.00");
  });

  it("平完再开：累计成本跟着仓位一起清掉，不把上一轮的手续费算进来", () => {
    const engine = faqEngine();
    fillAt(engine, "20000", "1", "BUY", 1);
    fillAt(engine, "21000", "1", "SELL", 2); // 全平
    fillAt(engine, "22000", "1", "BUY", 3); // 新的一轮

    const [position] = engine.positionViews("acc-1");
    expect(position?.qty).toBe(parse("1"));
    // 只有这一轮：22,000 + 22,000 × 0.02% = 22,004.4
    expect(format(position!.breakEvenPrice!, 2)).toBe("22004.40");
  });

  it("单向模式反手：新仓位只带反手那一段的成本", () => {
    const engine = faqEngine();
    fillAt(engine, "20000", "1", "BUY", 1);
    fillAt(engine, "21000", "3", "SELL", 2); // 平掉 1 张、反手开 2 张空

    const [position] = engine.positionViews("acc-1");
    expect(position?.positionSide).toBe("SHORT");
    expect(position?.qty).toBe(parse("2"));
    // 反手开的 2 张：21,000 − 21,000 × 0.02% = 20,995.8
    expect(format(position!.breakEvenPrice!, 2)).toBe("20995.80");
  });

  it("盘口没成交时仓位不存在，不会算出两平价", () => {
    const engine = createEngine(testConfig());
    run(engine, registerAccountInput("acc-1"));
    run(engine, bookInput());
    expect(engine.positionViews("acc-1")).toEqual([]);
  });
});
