import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import type { MarkPriceEvent } from "../market/parse";
import { createFundingScheduler } from "./funding-scheduler";

const T = Date.parse("2026-09-17T08:00:00Z");
const NEXT = Date.parse("2026-09-17T16:00:00Z");
const silent = { log: () => {}, error: () => {} };

function mark(ts: number, nextFundingTs: number, rate = "0.0001", price = "50000"): MarkPriceEvent {
  return { t: "markPrice", symbol: "BTCUSDT", markPrice: parse(price), fundingRate: parse(rate), nextFundingTs, ts };
}

function setup() {
  const submitted: unknown[] = [];
  const scheduler = createFundingScheduler({ submit: (input) => submitted.push(input), logger: silent });
  return { scheduler, submitted };
}

describe("资金费排期：标记价推送驱动", () => {
  it("下次结算时间变大、推送时间过了旧时间：用旧时间之前最后一条推送的费率和标记价结算", () => {
    const { scheduler, submitted } = setup();
    scheduler.onMarkPrice(mark(T - 2000, T, "0.0002", "50100"));
    scheduler.onMarkPrice(mark(T - 1000, T, "0.0003", "50200")); // 结算前最后一条
    expect(submitted).toEqual([]);
    scheduler.onMarkPrice(mark(T + 1000, NEXT, "0.0001", "50300"));
    expect(submitted).toEqual([{ t: "settleFunding", symbol: "BTCUSDT", rate: parse("0.0003"), markPrice: parse("50200"), ts: T }]);
  });

  it("同一个结算时间只结算一次", () => {
    const { scheduler, submitted } = setup();
    scheduler.onMarkPrice(mark(T - 1000, T));
    scheduler.onMarkPrice(mark(T + 1000, NEXT));
    scheduler.onMarkPrice(mark(T + 2000, NEXT));
    expect(submitted).toHaveLength(1);
  });

  it("结算前最后一条推送太旧（行情断过）：不结算，不编费率", () => {
    const { scheduler, submitted } = setup();
    scheduler.onMarkPrice(mark(T - 60_000, T));
    scheduler.onMarkPrice(mark(T + 30_000, NEXT));
    expect(submitted).toEqual([]);
  });

  it("启动后收到的第一条推送：没有上一条，什么都不做", () => {
    const { scheduler, submitted } = setup();
    scheduler.onMarkPrice(mark(T + 1000, NEXT));
    expect(submitted).toEqual([]);
  });
});
