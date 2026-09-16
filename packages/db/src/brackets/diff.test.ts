import { describe, expect, it } from "vitest";
import { describeBracketChange, diffBrackets } from "./diff";
import type { BracketRow } from "./types";

const TABLE: BracketRow[] = [
  { bracket: 1, notionalFloor: "0", notionalCap: "300000", maxLeverage: 150, mmr: "0.004", cum: "0" },
  { bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300" },
];

describe("diffBrackets", () => {
  it("完全相同返回空数组", () => {
    expect(diffBrackets(TABLE, structuredClone(TABLE))).toEqual([]);
  });

  it("按数值比较，不按字符串：'300000' 和 '300000.00000000' 视为相同", () => {
    const padded = TABLE.map((r) => ({ ...r, notionalCap: `${r.notionalCap}.00000000` }));
    expect(diffBrackets(TABLE, padded)).toEqual([]);
  });

  it("列出变化的层和字段，带前后值", () => {
    const after = TABLE.map((r) =>
      r.bracket === 2 ? { ...r, maxLeverage: 75, cum: "350" } : r,
    );
    expect(diffBrackets(TABLE, after)).toEqual([
      {
        bracket: 2,
        kind: "changed",
        fields: [
          { field: "maxLeverage", before: "100", after: "75" },
          { field: "cum", before: "300", after: "350" },
        ],
      },
    ]);
  });

  it("新增的层标为 added", () => {
    const extra: BracketRow = {
      bracket: 3, notionalFloor: "800000", notionalCap: "3000000", maxLeverage: 75, mmr: "0.0065", cum: "1500",
    };
    expect(diffBrackets(TABLE, [...TABLE, extra])).toEqual([{ bracket: 3, kind: "added", after: extra }]);
  });

  it("消失的层标为 removed", () => {
    expect(diffBrackets(TABLE, TABLE.slice(0, 1))).toEqual([
      { bracket: 2, kind: "removed", before: TABLE[1] },
    ]);
  });

  it("旧表为空（首次导入）时每层都是 added", () => {
    expect(diffBrackets([], TABLE).map((c) => c.kind)).toEqual(["added", "added"]);
  });
});

describe("describeBracketChange", () => {
  it("三种变更都能说成人话", () => {
    const second = TABLE[1];
    if (!second) throw new Error("fixture");
    expect(describeBracketChange({ bracket: 2, kind: "removed", before: second })).toBe("第 2 层删除");
    expect(describeBracketChange({ bracket: 2, kind: "added", after: second })).toBe(
      "第 2 层新增（上限 800000，100x，mmr 0.005）",
    );
    expect(
      describeBracketChange({
        bracket: 1,
        kind: "changed",
        fields: [
          { field: "maxLeverage", before: "150", after: "125" },
          { field: "cum", before: "0", after: "10" },
        ],
      }),
    ).toBe("第 1 层 最大杠杆 150 → 125，速算额 0 → 10");
  });
});
