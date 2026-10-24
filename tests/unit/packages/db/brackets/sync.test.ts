import "varlock/auto-load";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ENV } from "../../../../../packages/db/src/env";
import { createDb } from "../../../../../packages/db/src/index";
import { leverageBracketChanges } from "../../../../../packages/db/src/schema/leverage-bracket-changes";
import { leverageBrackets } from "../../../../../packages/db/src/schema/leverage-brackets";
import { symbols } from "../../../../../packages/db/src/schema/symbols";
import type { FetchBrackets } from "../../../../../packages/db/src/brackets/binance-client";
import type { OfficialSymbolBrackets } from "../../../../../packages/db/src/brackets/normalize";
import { syncLeverageBrackets, verifyLeverageBrackets, type DbExecutor } from "../../../../../packages/db/src/brackets/sync";

/**
 * 这组测试连本地数据库跑，但每个用例都包在一个最终回滚的事务里：
 * 造假币对、关掉真实币对的 enabled、跑同步、断言，然后整个回滚，库里不留痕迹。
 */

const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

afterAll(async () => {
  await db.$client.end();
});

class Rollback extends Error {}

async function inRollback(fn: (tx: DbExecutor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

const SYM_A = "ZZSYNCAUSDT";
const SYM_B = "ZZSYNCBUSDT";

/** 事务内：只让两个假币对处于开放状态。 */
async function setupSymbols(tx: DbExecutor): Promise<void> {
  await tx.update(symbols).set({ enabled: false });
  await tx.insert(symbols).values(
    [SYM_A, SYM_B].map((symbol, i) => ({
      symbol,
      baseAsset: symbol.replace("USDT", ""),
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      tickSize: parse("0.1"),
      stepSize: parse("0.001"),
      minQty: parse("0.001"),
      minNotional: parse("5"),
      enabled: true,
      sortOrder: i + 1,
    })),
  );
}

function official(symbol: string, secondCum = 300, secondLeverage = 100): OfficialSymbolBrackets {
  return {
    symbol,
    brackets: [
      { bracket: 1, initialLeverage: 150, notionalCap: 300000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
      {
        bracket: 2,
        initialLeverage: secondLeverage,
        notionalCap: 800000,
        notionalFloor: 300000,
        maintMarginRatio: 0.005,
        cum: secondCum,
      },
    ],
  };
}

function fetcher(payload: OfficialSymbolBrackets[]): FetchBrackets {
  return async () => structuredClone(payload);
}

async function rowsOf(tx: DbExecutor, symbol: string) {
  return tx
    .select()
    .from(leverageBrackets)
    .where(eq(leverageBrackets.symbol, symbol))
    .orderBy(asc(leverageBrackets.bracket));
}

async function changesOf(tx: DbExecutor) {
  return tx
    .select()
    .from(leverageBracketChanges)
    .where(inArray(leverageBracketChanges.symbol, [SYM_A, SYM_B]));
}

describe("syncLeverageBrackets", () => {
  it("首次同步：写入分层表，每个币对记一条 before=[] 的变更", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B), official("OTHERUSDT")]),
      });

      expect(report.checked).toEqual([SYM_A, SYM_B]);
      expect(report.changed.map((c) => c.symbol)).toEqual([SYM_A, SYM_B]);

      const rows = await rowsOf(tx, SYM_A);
      expect(rows.map((r) => [r.bracket, r.notionalCap, r.maxLeverage, r.mmr, r.cum])).toEqual([
        [1, parse("300000"), 150, parse("0.004"), 0n],
        [2, parse("800000"), 100, parse("0.005"), parse("300")],
      ]);

      const changes = await changesOf(tx);
      expect(changes).toHaveLength(2);
      const changeA = changes.find((c) => c.symbol === SYM_A);
      expect(changeA?.before).toEqual([]);
      expect(changeA?.after[1]).toEqual({
        bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300",
      });
    });
  });

  it("数据没变：不改表，不记变更", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });
      const idsBefore = (await rowsOf(tx, SYM_A)).map((r) => r.id);

      const report = await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.changed).toEqual([]);
      expect((await rowsOf(tx, SYM_A)).map((r) => r.id)).toEqual(idsBefore);
      expect(await changesOf(tx)).toHaveLength(2); // 仍然只有首次导入那两条
    });
  });

  it("币安调表：只替换变化的币对，变更记录留下前后整表", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      // SYM_A 第 2 层：杠杆 100 → 75（cum 不变，边界仍连续）
      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A, 300, 75), official(SYM_B)]),
      });

      expect(report.changed).toHaveLength(1);
      expect(report.changed[0]?.symbol).toBe(SYM_A);
      expect(report.changed[0]?.changes).toEqual([
        { bracket: 2, kind: "changed", fields: [{ field: "maxLeverage", before: "100", after: "75" }] },
      ]);
      expect((await rowsOf(tx, SYM_A))[1]?.maxLeverage).toBe(75);

      const changesA = (await changesOf(tx)).filter((c) => c.symbol === SYM_A);
      expect(changesA).toHaveLength(2);
      const latest = changesA.find((c) => c.before.length > 0);
      expect(latest?.before[1]?.maxLeverage).toBe(100);
      expect(latest?.after[1]?.maxLeverage).toBe(75);
    });
  });

  it("dryRun：报告差异，但不写任何东西", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]),
        dryRun: true,
      });

      expect(report.dryRun).toBe(true);
      expect(report.changed).toHaveLength(2);
      expect(await rowsOf(tx, SYM_A)).toEqual([]);
      expect(await changesOf(tx)).toEqual([]);
    });
  });

  it("任何一个开放币对校验不过：整次中止，一个都不写", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      // SYM_B 第 2 层速算额错了 1，边界不连续
      const run = syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B, 301)]),
      });

      await expect(run).rejects.toThrow(/ZZSYNCBUSDT.*连续性/);
      expect(await rowsOf(tx, SYM_A)).toEqual([]);
      expect(await changesOf(tx)).toEqual([]);
    });
  });

  it("官方没返回某个开放币对：中止，不删它的旧数据", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      const run = syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A)]) });

      await expect(run).rejects.toThrow(/ZZSYNCBUSDT/);
      expect(await rowsOf(tx, SYM_B)).toHaveLength(2);
    });
  });

  it("没有任何开放币对时明确报错，提示先跑 seed:symbols", async () => {
    await inRollback(async (tx) => {
      await tx.update(symbols).set({ enabled: false });
      await expect(
        syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([]) }),
      ).rejects.toThrow(/seed:symbols/);
    });
  });
});

describe("verifyLeverageBrackets", () => {
  it("库里和官方一致：没有差异", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report).toEqual({ checked: [SYM_A, SYM_B], mismatched: [], invalid: [] });
    });
  });

  it("官方调表后库里还没同步：报告差异", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      const report = await verifyLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A, 300, 75), official(SYM_B)]),
      });

      expect(report.mismatched.map((m) => m.symbol)).toEqual([SYM_A]);
      expect(report.invalid).toEqual([]);
    });
  });

  it("库里的表被改坏（不连续）：报告为 invalid", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });
      await tx
        .update(leverageBrackets)
        .set({ cum: parse("301") })
        .where(eq(leverageBrackets.symbol, SYM_B));

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.invalid.map((i) => i.symbol)).toEqual([SYM_B]);
      expect(report.mismatched.map((m) => m.symbol)).toEqual([SYM_B]);
    });
  });

  it("开放币对在库里没有分层表：报告为 invalid", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.invalid.map((i) => i.symbol)).toEqual([SYM_A, SYM_B]);
    });
  });
});
