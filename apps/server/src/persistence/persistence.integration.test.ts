import "varlock/auto-load";
import { accounts, createDb, fills, fundingPayments, ledgerEntries, liquidations, orders, positions, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { createEngine, type EngineEvent, type EngineInput, type EngineSnapshot, type Level } from "@binance-contract-trading-full-stack/engine";
import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createEngineHost } from "../engine-host/engine-host";
import { loadEngineConfig, loadEngineSnapshot } from "./load";
import { persistEvents } from "./persist";
import { randomUUID } from "node:crypto";

/**
 * 第 11 讲验收：真数据库 + 假行情。
 *
 * 连本地 Supabase，整个用例包在一个最终回滚的事务里（和 packages/db 的分层表同步测试同一个做法）：
 * 宿主每次落库是这个事务里的一个嵌套事务（savepoint），测完整体回滚，库里不留痕迹。
 *
 * 用的是数据库里真实的 BTCUSDT 交易规则和分层表（seed:symbols / sync:brackets 同步来的），
 * 所以断言只断言"账对得上、重启恢复一致"，不断言依赖分层表具体数值的金额。
 */

const db = createDb({ DATABASE_URL: process.env.DATABASE_URL! });
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
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const T0 = Date.parse("2026-09-17T00:00:00Z");
/** 对联合类型逐个成员 Omit（内置 Omit 会先把联合合并，字段就丢了） */
type InputWithoutTs = EngineInput extends infer I ? (I extends EngineInput ? Omit<I, "ts"> & { ts?: number } : never) : never;
const lv = (rows: [string, string][]): Level[] => rows.map(([p, q]) => ({ price: parse(p), qty: parse(q) }));

/** 账户行由鉴权层建（第 12 讲），这里直接插一行 */
async function createAccountRow(tx: DbExecutor): Promise<string> {
  const [row] = await tx
    .insert(accounts)
    .values({ address: `0xtest${randomUUID().replace(/-/g, "")}`, chain: "evm" })
    .returning({ id: accounts.id });
  return row!.id;
}

/** 数据库对账：钱包余额 == 流水之和（packages/db reconcile:ledger 同一条 SQL），限定在测试账户 */
async function ledgerMismatches(tx: DbExecutor, ids: string[]) {
  const result = await tx.execute(sql`
    SELECT a.id, a.wallet_balance, COALESCE(l.s, 0) AS ledger_sum
    FROM accounts a
    LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l ON l.account_id = a.id
    WHERE a.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) AND a.wallet_balance <> COALESCE(l.s, 0)
  `);
  return result.rows;
}

/** 快照里只看测试账户；排队位置重启后按设计重置，不比较 */
function normalize(snapshot: EngineSnapshot, ids: string[]) {
  const mine = <T extends { accountId: string }>(list: T[]) => list.filter((x) => ids.includes(x.accountId));
  const sortBy = <T>(list: T[], key: (x: T) => string) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    accounts: sortBy(snapshot.accounts.filter((a) => ids.includes(a.id)), (a) => a.id),
    settings: sortBy(mine(snapshot.settings), (s) => `${s.accountId}${s.symbol}`),
    positions: sortBy(mine(snapshot.positions), (p) => `${p.accountId}${p.symbol}${p.positionSide}`),
    orders: sortBy(mine(snapshot.orders), (o) => o.id).map(({ queueAhead: _q, queueEstimated: _e, ...rest }) => rest),
  };
}

describe("真数据库 + 假行情（第 11 讲验收）", () => {
  it("★ 一串真实操作落库后：账对得上；从数据库重建的引擎和内存里的一模一样（等价于 kill -9 后重启）", async () => {
    await inRollback(async (tx) => {
      const config = await loadEngineConfig(tx);
      expect(config.symbols.some((s) => s.symbol === "BTCUSDT" && s.enabled)).toBe(true);
      const engine = createEngine(config, await loadEngineSnapshot(tx));

      const modes = new Map<string, PositionMode>();
      const host = createEngineHost({
        engine,
        isSymbolReady: () => true,
        logger: { log: () => {}, error: () => {} },
        persist: (events) => persistEvents(tx, events, { positionModeOf: (id) => modes.get(id)! }),
        onCommitted(input, events) {
          if (input.t === "registerAccount") modes.set(input.accountId, input.positionMode);
          for (const e of events) if (e.t === "positionModeUpdate") modes.set(e.accountId, e.positionMode);
        },
      });
      let ts = T0;
      const run = (input: InputWithoutTs) => host.submit({ ...input, ts: input.ts ?? ++ts } as EngineInput);
      const order = (accountId: string, req: Record<string, unknown>) =>
        run({ t: "placeOrder", accountId, orderId: randomUUID(), req: { clientOrderId: randomUUID(), symbol: "BTCUSDT", positionSide: "BOTH", ...req } } as never);

      const a = await createAccountRow(tx); // 单向模式、逐仓 10x：开仓、挂单被行情吃到、资金费
      const b = await createAccountRow(tx); // 双向模式：多空各一
      const c = await createAccountRow(tx); // 全仓高杠杆：被强平
      for (const [id, mode, wallet] of [[a, "ONE_WAY", "10000"], [b, "ONE_WAY", "10000"], [c, "ONE_WAY", "100"]] as const) {
        await run({ t: "registerAccount", accountId: id, walletBalance: parse(wallet), positionMode: mode });
      }
      await run({ t: "book", symbol: "BTCUSDT", bids: lv([["49999.9", "5"], ["49999", "5"]]), asks: lv([["50000", "5"], ["50001", "5"]]) });
      await run({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse("50000"), fundingRate: parse("0.0001"), nextFundingTs: T0 + 8 * 3600_000 });
      await run({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50000"), qty: parse("0.01"), buyerIsMaker: false });

      // A：逐仓 10x，市价开多 0.2；挂卖 0.1 @ 50,100 被行情吃到（Maker 平仓）；
      //    挂买 0.01 @ 49,999 留着（正好在可见的一档上，排队位置是真值不是估算——重启后要变成估算）
      await run({ t: "setMarginMode", accountId: a, symbol: "BTCUSDT", mode: "ISOLATED" });
      await run({ t: "setLeverage", accountId: a, symbol: "BTCUSDT", leverageNum: 10 });
      await order(a, { side: "BUY", type: "MARKET", qty: parse("0.2") });
      await order(a, { side: "SELL", type: "LIMIT", timeInForce: "GTC", price: parse("50100"), qty: parse("0.1") });
      await order(a, { side: "BUY", type: "LIMIT", timeInForce: "GTC", price: parse("49999"), qty: parse("0.01") });
      const makerFill = await run({ t: "trade", symbol: "BTCUSDT", tradeId: 2, price: parse("50100"), qty: parse("10"), buyerIsMaker: false });
      expect(makerFill.some((e) => e.t === "fill" && e.fill.role === "MAKER")).toBe(true);

      // B：切双向，多空各开 0.05；下一张被拒的单（不入库）
      await run({ t: "setPositionMode", accountId: b, mode: "HEDGE" });
      await order(b, { side: "BUY", positionSide: "LONG", type: "MARKET", qty: parse("0.05") });
      await order(b, { side: "SELL", positionSide: "SHORT", type: "MARKET", qty: parse("0.05") });
      const rejected = await order(b, { side: "BUY", positionSide: "LONG", type: "LIMIT", timeInForce: "GTC", price: parse("40000"), qty: parse("0.05") });
      expect(rejected[0]).toMatchObject({ t: "rejected", code: "PERCENT_PRICE" });

      // 资金费结算：A 逐仓、B 多空都付 / 收
      const settle = { t: "settleFunding", symbol: "BTCUSDT", rate: parse("0.0001"), markPrice: parse("50000"), ts: T0 + 8 * 3600_000 } as const;
      const funding = await host.submit(settle);
      expect(funding.filter((e) => e.t === "fundingPaid")).toHaveLength(3);
      // 同一个结算时间再结算一次：主键冲突，落库失败，内存回滚，钱不会多扣
      const beforeDuplicate = engine.snapshot();
      await expect(host.submit(settle)).rejects.toThrow();
      expect(engine.snapshot()).toEqual(beforeDuplicate);

      // C：全仓 100x 开多 0.1，价格跌到 49,000 → 强平
      await run({ t: "setLeverage", accountId: c, symbol: "BTCUSDT", leverageNum: 100 });
      await order(c, { side: "BUY", type: "MARKET", qty: parse("0.1") });
      await run({ t: "book", symbol: "BTCUSDT", bids: lv([["48999.9", "5"]]), asks: lv([["49000", "5"]]) });
      const crash = await run({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse("49000"), fundingRate: parse("0.0001"), nextFundingTs: T0 + 16 * 3600_000 });
      expect(crash.filter((e) => e.t === "liquidation").map((e) => (e as Extract<EngineEvent, { t: "liquidation" }>).record.accountId)).toContain(c);

      const ids = [a, b, c];

      // ① 账：每个账户钱包 == 流水之和；数据库钱包 == 引擎钱包
      expect(await ledgerMismatches(tx, ids)).toEqual([]);
      const dbWallets = await tx.select({ id: accounts.id, wallet: accounts.walletBalance }).from(accounts).where(inArray(accounts.id, ids));
      for (const row of dbWallets) {
        expect(row.wallet).toBe(engine.snapshot().accounts.find((x) => x.id === row.id)!.walletBalance);
      }

      // ② 落了什么：强平单 + 成交 + 强平记录 + 资金费；被拒的单没有入库；双向模式的空头仓位是负数
      expect((await tx.select().from(liquidations).where(eq(liquidations.accountId, c))).length).toBe(1);
      expect((await tx.select().from(orders).where(eq(orders.accountId, c))).map((o) => o.type).sort()).toEqual(["LIQUIDATION", "MARKET"]);
      expect((await tx.select().from(fills).where(eq(fills.accountId, c))).some((f) => f.isLiquidation)).toBe(true);
      expect((await tx.select().from(fundingPayments).where(inArray(fundingPayments.accountId, ids))).length).toBe(3);
      expect((await tx.select().from(orders).where(eq(orders.accountId, b))).length).toBe(2);
      const bPositions = await tx.select().from(positions).where(eq(positions.accountId, b));
      expect(bPositions.map((p) => [p.positionSide, p.positionAmt > 0n ? "+" : "-"]).sort()).toEqual([["LONG", "+"], ["SHORT", "-"]]);
      const aPosition = (await tx.select().from(positions).where(eq(positions.accountId, a)))[0]!;
      expect(aPosition).toMatchObject({ positionSide: "BOTH", positionAmt: parse("0.1") });
      expect((await tx.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, a))).map((l) => l.type)).toContain("FUNDING");

      // ③ "kill -9 之后重启"：从数据库重建一个新引擎，和内存里的比
      const [restingRow] = await tx.select().from(orders).where(eq(orders.price, parse("49999")));
      expect(restingRow).toMatchObject({ accountId: a, queueEstimated: false }); // 库里存的是下单时的真值
      const recovered = createEngine(await loadEngineConfig(tx), await loadEngineSnapshot(tx));
      expect(normalize(recovered.snapshot(), ids)).toEqual(normalize(engine.snapshot(), ids));
      const restoredOrder = recovered.snapshot().orders.find((o) => o.accountId === a)!;
      expect(restoredOrder).toMatchObject({ price: parse("49999"), queueEstimated: true }); // 重启后一律当估算值
    });
  });
});
