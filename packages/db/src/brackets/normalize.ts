import { mul, parse, SCALE } from "@binance-contract-trading-full-stack/shared";
import type { BracketRow } from "./types";

/** 官方 GET /fapi/v1/leverageBracket 返回里的一层。 */
export interface OfficialBracket {
  bracket: number;
  initialLeverage: number;
  notionalCap: number;
  notionalFloor: number;
  maintMarginRatio: number;
  cum: number;
}

/** 官方返回数组里的一个币对。`notionalCoef` 只在账户被个性化调整时出现。 */
export interface OfficialSymbolBrackets {
  symbol: string;
  notionalCoef?: number;
  brackets: OfficialBracket[];
}

/**
 * JSON 数值 → 定标 1e8 能精确表示的十进制字符串。
 *
 * 币安返回的是 JSON number，经过 JS 浮点后可能带上 0.012500000000000001 这种尾巴，
 * 大数或极小数也可能被 String() 写成科学计数法。这些情况一律抛错而不是四舍五入——
 * shared 的 parse() 遇到超过 8 位小数会静默截断，一个被悄悄抹平的小数位，
 * 会变成所有强平价上一个查不出来的系统性偏差。
 */
export function toDecimalString(value: unknown, symbol: string, field: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${symbol} 的 ${field} 不是有限数：${String(value)}`);
  }
  const s = String(value);
  if (s.includes("e") || s.includes("E")) {
    throw new Error(`${symbol} 的 ${field} 是科学计数法，无法安全转成定标值：${s}`);
  }
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > 8) {
    throw new Error(
      `${symbol} 的 ${field} 小数位超过 8（定标 1e8 存不下）：${s}。这多半是浮点误差，需要人工确认。`,
    );
  }
  return s;
}

export interface ContinuityResult {
  ok: boolean;
  mismatches: { atBracket: number }[];
}

/**
 * 相邻两层在边界上的维持保证金必须相等。
 *
 * 维持保证金 = 名义价值 × mmr − cum。名义价值正好等于下层上限时，按下层算和按上层算
 * 应该得到同一个数，否则仓位刚跨过边界，维持保证金会凭空阶跃。
 */
export function checkContinuity(rows: BracketRow[]): ContinuityResult {
  const mismatches: { atBracket: number }[] = [];

  for (let i = 0; i < rows.length - 1; i++) {
    const lower = rows[i];
    const upper = rows[i + 1];
    if (!lower || !upper) continue;

    const n = parse(lower.notionalCap);
    const mmLower = mul(n, parse(lower.mmr)) - parse(lower.cum);
    const mmUpper = mul(n, parse(upper.mmr)) - parse(upper.cum);

    if (mmLower !== mmUpper) {
      mismatches.push({ atBracket: lower.bracket });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * 校验一整张分层表的结构。官方数据写库前、数据库里的数据核对时都走这一个函数。
 *
 * 期望 rows 已按层号升序。任何一条不满足就抛错，错误信息指到具体币对、具体层。
 */
export function validateBracketRows(symbol: string, rows: BracketRow[]): void {
  if (rows.length === 0) {
    throw new Error(`${symbol} 没有分层数据`);
  }

  rows.forEach((row, i) => {
    const at = `${symbol} 第 ${row.bracket} 层`;
    const prev = rows[i - 1];

    if (row.bracket !== i + 1) {
      throw new Error(`${symbol} 的层号不连续：第 ${i + 1} 个位置是第 ${row.bracket} 层`);
    }

    const floor = parse(row.notionalFloor);
    const cap = parse(row.notionalCap);
    if (!prev && floor !== 0n) {
      throw new Error(`${symbol} 第 1 层的下限应该是 0，实际是 ${row.notionalFloor}`);
    }
    if (prev && floor !== parse(prev.notionalCap)) {
      throw new Error(`${at}的下限 ${row.notionalFloor} 没有接上上一层的上限 ${prev.notionalCap}`);
    }
    if (cap <= floor) {
      throw new Error(`${at}的上限必须大于下限：${row.notionalFloor} → ${row.notionalCap}`);
    }

    if (!Number.isInteger(row.maxLeverage) || row.maxLeverage < 1) {
      throw new Error(`${at}的最大杠杆异常：${row.maxLeverage}`);
    }
    const mmr = parse(row.mmr);
    if (mmr <= 0n || mmr >= SCALE) {
      throw new Error(`${at}的维持保证金率应该在 (0, 1) 之间，实际是 ${row.mmr}`);
    }

    if (prev && row.maxLeverage > prev.maxLeverage) {
      throw new Error(`${at}的杠杆不应高于上一层：${prev.maxLeverage} → ${row.maxLeverage}`);
    }
    if (prev && mmr < parse(prev.mmr)) {
      throw new Error(`${at}的维持保证金率不应低于上一层：${prev.mmr} → ${row.mmr}`);
    }

    if (parse(row.cum) < 0n) {
      throw new Error(`${at}的速算额不应为负：${row.cum}`);
    }
  });

  const continuity = checkContinuity(rows);
  if (!continuity.ok) {
    throw new Error(
      `${symbol} 的分层表连续性校验不通过，边界不连续的层：${continuity.mismatches
        .map((m) => m.atBracket)
        .join(", ")}`,
    );
  }
}

/** 官方返回的一个币对 → 校验过的 BracketRow[]。任何异常都抛错，绝不返回半对的数据。 */
export function normalizeSymbolBrackets(entry: OfficialSymbolBrackets): BracketRow[] {
  const { symbol } = entry;

  if (entry.notionalCoef !== undefined && entry.notionalCoef !== 1) {
    throw new Error(
      `${symbol} 返回了 notionalCoef=${entry.notionalCoef}：这个账户的分层被个性化调整过，不是公开表，不能用`,
    );
  }
  if (!Array.isArray(entry.brackets) || entry.brackets.length === 0) {
    throw new Error(`${symbol} 没有分层数据`);
  }

  const rows = [...entry.brackets]
    .sort((a, b) => a.bracket - b.bracket)
    .map(
      (b): BracketRow => ({
        bracket: b.bracket,
        notionalFloor: toDecimalString(b.notionalFloor, symbol, "notionalFloor"),
        notionalCap: toDecimalString(b.notionalCap, symbol, "notionalCap"),
        maxLeverage: b.initialLeverage,
        mmr: toDecimalString(b.maintMarginRatio, symbol, "mmr"),
        cum: toDecimalString(b.cum, symbol, "cum"),
      }),
    );

  validateBracketRows(symbol, rows);
  return rows;
}
