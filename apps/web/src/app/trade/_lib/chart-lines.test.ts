import { describe, expect, it } from "vitest";

import type { SymbolSpec } from "@/server-api-module/market/types";
import type { Order } from "@/server-api-module/order/types";
import type { Position } from "@/server-api-module/position/types";

import { chartLines, toChartPrice } from "./chart-lines";

const spec = { tickSize: "0.10000000", stepSize: "0.00100000" } as SymbolSpec;

const position = (over: Partial<Position> = {}): Position =>
  ({
    symbol: "BTCUSDT",
    positionSide: "BOTH",
    positionAmt: "1",
    entryPrice: "50000",
    unrealizedPnl: "123.456",
    liquidationPrice: "45180.72",
    ...over,
  }) as Position;

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "o-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "49000",
    stopPrice: null,
    qty: "0.5",
    reduceOnly: false,
    closePosition: false,
    trackedPrice: null,
    callbackRate: null,
    ...over,
  }) as Order;

describe("chartLines", () => {
  it("一个多头仓位画两条线：开仓均价 + 强平价", () => {
    const lines = chartLines("BTCUSDT", [position()], [], spec);
    expect(lines.map((l) => l.kind)).toEqual(["position", "liquidation"]);
    expect(lines[0]).toMatchObject({ price: "50000", tone: "up" });
    expect(lines[0]?.label).toBe("多 1.000 @ 50,000.0 · +123.46");
    expect(lines[1]).toMatchObject({ price: "45180.72", tone: "warn", dashed: true });
  });

  it("空头是红的，数量取绝对值", () => {
    const lines = chartLines("BTCUSDT", [position({ positionAmt: "-0.5" })], [], spec);
    expect(lines[0]?.tone).toBe("down");
    expect(lines[0]?.label).toContain("空 0.500");
  });

  it("未实现盈亏算不出来时不写 0，只是不提", () => {
    const lines = chartLines("BTCUSDT", [position({ unrealizedPnl: null })], [], spec);
    expect(lines[0]?.label).toBe("多 1.000 @ 50,000.0");
  });

  it("强平价为 null 时不画那条线（不编一个价）", () => {
    const lines = chartLines("BTCUSDT", [position({ liquidationPrice: null })], [], spec);
    expect(lines.map((l) => l.kind)).toEqual(["position"]);
  });

  it("数量为 0 的仓位（推送里的删除标记）不画", () => {
    expect(chartLines("BTCUSDT", [position({ positionAmt: "0" })], [], spec)).toEqual([]);
  });

  it("别的币对的仓位和挂单都不画", () => {
    const lines = chartLines("BTCUSDT", [position({ symbol: "ETHUSDT" })], [order({ symbol: "ETHUSDT" })], spec);
    expect(lines).toEqual([]);
  });

  it("限价单画在委托价上，带撤单动作", () => {
    const lines = chartLines("BTCUSDT", [], [order()], spec);
    expect(lines[0]).toMatchObject({ kind: "order", price: "49000", dashed: false, key: "order:o-1" });
    expect(lines[0]?.label).toBe("限价买入 0.500 @ 49,000.0");
  });

  it("条件单画在触发价上，画成虚线", () => {
    const lines = chartLines("BTCUSDT", [], [order({ type: "STOP_MARKET", price: null, stopPrice: "48000" })], spec);
    expect(lines[0]).toMatchObject({ price: "48000", dashed: true });
    expect(lines[0]?.label).toContain("止损市价");
  });

  it("只减仓标出来", () => {
    const lines = chartLines("BTCUSDT", [], [order({ reduceOnly: true })], spec);
    expect(lines[0]?.label).toContain("只减仓");
  });

  it("跟踪委托画在按跟踪价算出来的止损线上，虚线 + 说明可能略旧", () => {
    const lines = chartLines(
      "BTCUSDT",
      [],
      [order({ type: "TRAILING_STOP_MARKET", side: "SELL", price: null, trackedPrice: "52000", callbackRate: "1" })],
      spec,
    );
    expect(lines[0]).toMatchObject({ price: "51480.00000000", dashed: true });
    expect(lines[0]?.label).toBe("跟踪卖出 0.500 · 回调 1%（会移动）");
  });

  it("跟踪委托还没收到过行情（没有跟踪价）时不画", () => {
    const lines = chartLines(
      "BTCUSDT",
      [],
      [order({ type: "TRAILING_STOP_MARKET", price: null, trackedPrice: null, callbackRate: "1" })],
      spec,
    );
    expect(lines).toEqual([]);
  });

  it("市价单（没有委托价也没有触发价）不画", () => {
    expect(chartLines("BTCUSDT", [], [order({ type: "MARKET", price: null })], spec)).toEqual([]);
  });

  it("key 稳定：同一个仓位 / 同一张单，价格变了 key 不变", () => {
    const a = chartLines("BTCUSDT", [position()], [order()], spec).map((l) => l.key);
    const b = chartLines("BTCUSDT", [position({ entryPrice: "51000" })], [order({ price: "48000" })], spec).map(
      (l) => l.key,
    );
    expect(a).toEqual(b);
  });
});

describe("toChartPrice", () => {
  it("只在交给图表库那一步转 number", () => {
    expect(toChartPrice("45180.72")).toBe(45180.72);
  });
});
