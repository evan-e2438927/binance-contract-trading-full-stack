import { describe, expect, it } from "vitest";

import { DEFAULT_TAB, ordersHref, parseOrdersQuery, symbolOptions } from "./tabs";

const params = (search: string) => new URLSearchParams(search);
const KNOWN = ["BTCUSDT", "ETHUSDT"];

describe("parseOrdersQuery", () => {
  it("没有参数时用默认 tab、不筛选", () => {
    expect(parseOrdersQuery(params(""), KNOWN)).toEqual({ tab: DEFAULT_TAB, symbol: undefined, ledgerType: undefined });
  });

  it("认得出五个 tab", () => {
    expect(parseOrdersQuery(params("tab=fills"), KNOWN).tab).toBe("fills");
    expect(parseOrdersQuery(params("tab=liquidations"), KNOWN).tab).toBe("liquidations");
  });

  it("不认识的 tab 退回默认值，而不是空白页", () => {
    expect(parseOrdersQuery(params("tab=nope"), KNOWN).tab).toBe(DEFAULT_TAB);
  });

  it("币对统一转大写", () => {
    expect(parseOrdersQuery(params("symbol=btcusdt"), KNOWN).symbol).toBe("BTCUSDT");
  });

  it("不在开放名单里的币对当成没筛", () => {
    expect(parseOrdersQuery(params("symbol=FOOUSDT"), KNOWN).symbol).toBeUndefined();
  });

  it("币对列表还没加载完时不判断合法性（否则首屏会把筛选条件抹掉）", () => {
    expect(parseOrdersQuery(params("symbol=FOOUSDT"), undefined).symbol).toBe("FOOUSDT");
  });

  it("流水类型只在资金流水 tab 上有效", () => {
    expect(parseOrdersQuery(params("tab=ledger&type=FEE"), KNOWN).ledgerType).toBe("FEE");
    expect(parseOrdersQuery(params("tab=fills&type=FEE"), KNOWN).ledgerType).toBeUndefined();
  });

  it("不认识的流水类型当成没筛", () => {
    expect(parseOrdersQuery(params("tab=ledger&type=BONUS"), KNOWN).ledgerType).toBeUndefined();
  });
});

describe("ordersHref", () => {
  it("默认 tab 不写进 URL", () => {
    expect(ordersHref({ tab: DEFAULT_TAB })).toBe("/orders");
  });

  it("带上 tab 和币对", () => {
    expect(ordersHref({ tab: "fills", symbol: "BTCUSDT" })).toBe("/orders?tab=fills&symbol=BTCUSDT");
  });

  it("流水类型只跟着资金流水 tab 走", () => {
    expect(ordersHref({ tab: "ledger", ledgerType: "FUNDING" })).toBe("/orders?tab=ledger&type=FUNDING");
    expect(ordersHref({ tab: "fills", ledgerType: "FUNDING" })).toBe("/orders?tab=fills");
  });

  it("解析和生成是一对：转一圈回到原样", () => {
    const href = ordersHref({ tab: "ledger", symbol: "ETHUSDT", ledgerType: "FEE" });
    expect(parseOrdersQuery(params(href.split("?")[1] ?? ""), KNOWN)).toEqual({
      tab: "ledger",
      symbol: "ETHUSDT",
      ledgerType: "FEE",
    });
  });
});

describe("symbolOptions", () => {
  it("已下架但正在筛的币对补到最前面，不然筛选框显示不出它", () => {
    expect(symbolOptions(KNOWN, "TONUSDT")).toEqual(["TONUSDT", "BTCUSDT", "ETHUSDT"]);
  });

  it("在名单里就不重复加", () => {
    expect(symbolOptions(KNOWN, "BTCUSDT")).toEqual(KNOWN);
  });
});
