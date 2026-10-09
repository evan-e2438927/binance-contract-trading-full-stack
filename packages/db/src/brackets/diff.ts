import { parse } from "@binance-contract-trading-full-stack/shared";
import type { BracketRow } from "./types";

const COMPARED_FIELDS = ["notionalFloor", "notionalCap", "maxLeverage", "mmr", "cum"] as const;

export type BracketField = (typeof COMPARED_FIELDS)[number];

export enum BRACKET_CHANGE_KIND {
  ADDED = 'added',      
  REMOVED = 'removed', 
  CHANGED = 'changed'
}

export type BracketChange =
  | { bracket: number; kind: BRACKET_CHANGE_KIND.ADDED; after: BracketRow }
  | { bracket: number; kind: BRACKET_CHANGE_KIND.REMOVED; before: BracketRow }
  | {
      bracket: number;
      kind: BRACKET_CHANGE_KIND.CHANGED;
      fields: { field: BracketField; before: string; after: string }[];
    };

/** 按数值比较：数据库读出来的 "300000.00000000" 和官方的 "300000" 是同一个数。 */
function sameValue(field: BracketField, a: BracketRow, b: BracketRow): boolean {
  if (field === "maxLeverage") return a.maxLeverage === b.maxLeverage;
  return parse(a[field]) === parse(b[field]);
}

/** 旧表 → 新表的逐层差异。两张表完全一致时返回空数组。 */
export function diffBrackets(before: BracketRow[], after: BracketRow[]): BracketChange[] {
  const beforeByBracket = new Map(before.map((r) => [r.bracket, r]));
  const afterByBracket = new Map(after.map((r) => [r.bracket, r]));
  const allBrackets = [...new Set([...beforeByBracket.keys(), ...afterByBracket.keys()])].sort(
    (a, b) => a - b,
  );

  const changes: BracketChange[] = [];
  for (const bracket of allBrackets) {
    const b = beforeByBracket.get(bracket);
    const a = afterByBracket.get(bracket);

    if (!b && a) {
      changes.push({ bracket, kind: "added", after: a });
    } else if (b && !a) {
      changes.push({ bracket, kind: "removed", before: b });
    } else if (b && a) {
      const fields = COMPARED_FIELDS.filter((f) => !sameValue(f, b, a)).map((field) => ({
        field,
        before: String(b[field]),
        after: String(a[field]),
      }));
      if (fields.length > 0) {
        changes.push({ bracket, kind: "changed", fields });
      }
    }
  }
  return changes;
}

const FIELD_LABELS: Record<BracketField, string> = {
  notionalFloor: "下限",
  notionalCap: "上限",
  maxLeverage: "最大杠杆",
  mmr: "维持保证金率",
  cum: "速算额",
};

/** 一条变更的人话描述，给脚本输出和 server 日志用。 */
export function describeBracketChange(change: BracketChange): string {
  switch (change.kind) {
    case "added":
      return `第 ${change.bracket} 层新增（上限 ${change.after.notionalCap}，${change.after.maxLeverage}x，mmr ${change.after.mmr}）`;
    case "removed":
      return `第 ${change.bracket} 层删除`;
    case "changed":
      return `第 ${change.bracket} 层 ${change.fields
        .map((f) => `${FIELD_LABELS[f.field]} ${f.before} → ${f.after}`)
        .join("，")}`;
  }
}
