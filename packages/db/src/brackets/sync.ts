import { format, parse, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../index";
import { leverageBracketChanges } from "../schema/leverage-bracket-changes";
import { leverageBrackets, type LeverageBracket } from "../schema/leverage-brackets";
import { symbols } from "../schema/symbols";
import type { FetchBrackets } from "./binance-client";
import { diffBrackets, type BracketChange } from "./diff";
import { normalizeSymbolBrackets, validateBracketRows } from "./normalize";
import type { BracketRow } from "./types";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** 数据库连接或事务都行——测试里在一个会回滚的事务里跑同步。 */
export type DbExecutor = Database | Transaction;

export interface SymbolBracketChange {
  symbol: string;
  changes: BracketChange[];
  before: BracketRow[];
  after: BracketRow[];
}

export interface SyncReport {
  dryRun: boolean;
  /** 本次检查的开放币对，按 sortOrder。 */
  checked: string[];
  /** 有变化的币对。dryRun 时是"将要写入"，否则是"已经写入"。 */
  changed: SymbolBracketChange[];
}

export interface SyncOptions {
  db: DbExecutor;
  fetchBrackets: FetchBrackets;
  dryRun?: boolean;
}

/** Fixed → 去掉多余零的十进制字符串：300000.00000000 → "300000"，0.00400000 → "0.004"。 */
function fixedToDecimal(value: Fixed): string {
  const s = format(value);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function recordToRow(r: LeverageBracket): BracketRow {
  return {
    bracket: r.bracket,
    notionalFloor: fixedToDecimal(r.notionalFloor),
    notionalCap: fixedToDecimal(r.notionalCap),
    maxLeverage: r.maxLeverage,
    mmr: fixedToDecimal(r.mmr),
    cum: fixedToDecimal(r.cum),
  };
}

async function loadEnabledSymbols(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.enabled, true))
    .orderBy(asc(symbols.sortOrder), asc(symbols.symbol));

  if (rows.length === 0) {
    throw new Error("symbols 表里没有 enabled 的币对，先跑 seed:symbols 按 open-symbols.ts 设置开放名单");
  }
  return rows.map((r) => r.symbol);
}

async function loadStoredRows(db: DbExecutor, symbolNames: string[]): Promise<Map<string, BracketRow[]>> {
  const records = await db
    .select()
    .from(leverageBrackets)
    .where(inArray(leverageBrackets.symbol, symbolNames))
    .orderBy(asc(leverageBrackets.symbol), asc(leverageBrackets.bracket));

  const bySymbol = new Map<string, BracketRow[]>();
  for (const r of records) {
    const list = bySymbol.get(r.symbol) ?? [];
    list.push(recordToRow(r));
    bySymbol.set(r.symbol, list);
  }
  return bySymbol;
}

/** 拉官方全量，只取开放币对并逐个校验。缺一个或错一个都整体抛错。 */
async function loadOfficialRows(
  fetchBrackets: FetchBrackets,
  symbolNames: string[],
): Promise<Map<string, BracketRow[]>> {
  const payload = await fetchBrackets();
  const bySymbol = new Map(payload.map((entry) => [entry.symbol, entry]));

  const missing = symbolNames.filter((s) => !bySymbol.has(s));
  if (missing.length > 0) {
    throw new Error(`官方分层表里没有这些开放币对：${missing.join(", ")}，同步中止，旧数据保持不变`);
  }

  const result = new Map<string, BracketRow[]>();
  for (const symbol of symbolNames) {
    const entry = bySymbol.get(symbol);
    if (entry) result.set(symbol, normalizeSymbolBrackets(entry));
  }
  return result;
}

/**
 * 用官方签名接口同步开放币对的杠杆分层表。
 *
 * 1. 读 enabled 币对 → 2. 拉官方全量并逐个校验（任何一个不过就整体中止，不写库）
 * → 3. 和库里比 → 4. dryRun 到此为止 → 5. 一个事务里替换变化的币对并记变更
 * → 6. 读回来和官方逐层再比一次，不一致就抛错。
 */
export async function syncLeverageBrackets(options: SyncOptions): Promise<SyncReport> {
  const { db, fetchBrackets, dryRun = false } = options;

  const checked = await loadEnabledSymbols(db);
  const official = await loadOfficialRows(fetchBrackets, checked);
  const stored = await loadStoredRows(db, checked);

  const changed: SymbolBracketChange[] = [];
  for (const symbol of checked) {
    const before = stored.get(symbol) ?? [];
    const after = official.get(symbol) ?? [];
    const changes = diffBrackets(before, after);
    if (changes.length > 0) changed.push({ symbol, changes, before, after });
  }

  if (dryRun || changed.length === 0) {
    return { dryRun, checked, changed };
  }

  await db.transaction(async (tx) => {
    for (const { symbol, before, after } of changed) {
      await tx.delete(leverageBrackets).where(eq(leverageBrackets.symbol, symbol));
      await tx.insert(leverageBrackets).values(
        after.map((row) => ({
          symbol,
          bracket: row.bracket,
          notionalFloor: parse(row.notionalFloor),
          notionalCap: parse(row.notionalCap),
          maxLeverage: row.maxLeverage,
          mmr: parse(row.mmr),
          cum: parse(row.cum),
        })),
      );
      await tx.insert(leverageBracketChanges).values({ symbol, before, after });
    }
  });

  // 第二道校验：写进去的东西读回来必须和官方逐层一致，防止写入环节丢精度或漏行
  const written = await loadStoredRows(
    db,
    changed.map((c) => c.symbol),
  );
  for (const { symbol, after } of changed) {
    const leftover = diffBrackets(written.get(symbol) ?? [], after);
    if (leftover.length > 0) {
      throw new Error(`${symbol} 写库后读回与官方不一致：${JSON.stringify(leftover)}`);
    }
  }

  return { dryRun, checked, changed };
}

export interface VerifyReport {
  checked: string[];
  /** 库里的表和官方不一致的币对。 */
  mismatched: { symbol: string; changes: BracketChange[] }[];
  /** 库里的表自身结构不合法（含没有数据）的币对。 */
  invalid: { symbol: string; error: string }[];
}

/**
 * 对齐检查：库里每个开放币对的分层表，自身结构是否合法、是否和官方完全一致。
 * 只读，不写库。
 */
export async function verifyLeverageBrackets(options: {
  db: DbExecutor;
  fetchBrackets: FetchBrackets;
}): Promise<VerifyReport> {
  const { db, fetchBrackets } = options;

  const checked = await loadEnabledSymbols(db);
  const stored = await loadStoredRows(db, checked);
  const official = await loadOfficialRows(fetchBrackets, checked);

  const report: VerifyReport = { checked, mismatched: [], invalid: [] };
  for (const symbol of checked) {
    const rows = stored.get(symbol) ?? [];
    try {
      validateBracketRows(symbol, rows);
    } catch (err) {
      report.invalid.push({ symbol, error: err instanceof Error ? err.message : String(err) });
    }

    const changes = diffBrackets(rows, official.get(symbol) ?? []);
    if (rows.length > 0 && changes.length > 0) {
      report.mismatched.push({ symbol, changes });
    }
  }
  return report;
}
