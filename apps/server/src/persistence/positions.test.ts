import { parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";
import { fromDbPosition, toDbPosition } from "./positions";

describe("仓位两种表示法互转（缺口 #12）", () => {
  it.each([
    ["ONE_WAY", "LONG", "1.5", "BOTH", "1.5"],
    ["ONE_WAY", "SHORT", "1.5", "BOTH", "-1.5"],
    ["HEDGE", "LONG", "2", "LONG", "2"],
    ["HEDGE", "SHORT", "2", "SHORT", "-2"],
  ] as const)("%s %s %s ↔ 数据库 %s %s", (mode, side, qty, dbSide, amt) => {
    const db = toDbPosition(mode, side, parse(qty));
    expect(db).toEqual({ positionSide: dbSide, positionAmt: parse(amt) });
    expect(fromDbPosition(mode, db)).toEqual({ positionSide: side, qty: parse(qty) });
  });

  it("平掉的仓位（数量 0）落库成 0，但不加载", () => {
    expect(toDbPosition("ONE_WAY", "LONG", 0n)).toEqual({ positionSide: "BOTH", positionAmt: 0n });
    expect(() => fromDbPosition("ONE_WAY", { positionSide: "BOTH", positionAmt: 0n })).toThrow(/不该加载/);
  });

  it("数据不一致就抛错，不猜", () => {
    expect(() => fromDbPosition("ONE_WAY", { positionSide: "LONG", positionAmt: parse("1") })).toThrow(/单向/);
    expect(() => fromDbPosition("HEDGE", { positionSide: "SHORT", positionAmt: parse("1") })).toThrow(/符号不对/);
    expect(() => toDbPosition("ONE_WAY", "BOTH", parse("1"))).toThrow(/BOTH/);
  });
});
