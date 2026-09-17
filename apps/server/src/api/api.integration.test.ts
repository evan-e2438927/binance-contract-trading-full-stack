import "varlock/auto-load";
import { accounts, createDb, ledgerEntries, orders, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { createEngine, type Engine, type EngineInput, type Level } from "@binance-contract-trading-full-stack/engine";
import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { signToken } from "../auth/tokens";
import { createEngineHost } from "../engine-host/engine-host";
import { createAccountRegistrar } from "../engine-host/register-account";
import { loadEngineConfig, loadEngineSnapshot } from "../persistence/load";
import { persistEvents } from "../persistence/persist";
import { RESET_COOLDOWN_MS } from "./account";

/**
 * 第 13 讲验收：每个接口一条集成测试；同一个 clientOrderId 提交两次只产生一张单。
 *
 * 真数据库（整个用例包在最终回滚的事务里）+ 真引擎 + 真宿主 + createApp（和线上同一套路由、中间件、错误处理）。
 * 行情是假的：BTCUSDT 一份固定盘口、标记价 50,000；交易规则和分层表是库里从币安同步来的真实数据
 * （最小名义价值 50、tickSize 0.1），所以金额断言只断言关系，不断言依赖分层表具体数值的数。
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

const JWT_SECRET = "api-integration-test-secret-0123456789abcdef";
const quiet = { log: () => {}, error: () => {} };
const lv = (rows: [string, string][]): Level[] => rows.map(([p, q]) => ({ price: parse(p), qty: parse(q) }));

async function setup(tx: DbExecutor) {
  const config = await loadEngineConfig(tx);
  const engine: Engine = createEngine(config, await loadEngineSnapshot(tx));
  const modes = new Map<string, PositionMode>(engine.snapshot().accounts.map((a) => [a.id, a.positionMode]));
  const clock = { t: Date.now() };
  const now = () => clock.t;
  const registrar = createAccountRegistrar({ submit: (input) => host.submit(input), now });
  const host = createEngineHost({
    engine,
    isSymbolReady: (symbol) => symbol === "BTCUSDT", // 只有 BTCUSDT 有行情
    logger: quiet,
    persist: (events) =>
      persistEvents(tx, events, { positionModeOf: (id) => modes.get(id)!, pendingRegistrationOf: registrar.pendingRegistrationOf }),
    onCommitted(input, events) {
      if (input.t === "registerAccount") modes.set(input.accountId, input.positionMode);
      for (const e of events) if (e.t === "positionModeUpdate") modes.set(e.accountId, e.positionMode);
    },
  });

  const market = (input: EngineInput) => host.submit(input);
  await market({ t: "book", symbol: "BTCUSDT", bids: lv([["49999.9", "5"], ["49999", "5"]]), asks: lv([["50000", "5"], ["50001", "5"]]), ts: now() });
  await market({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse("50000"), fundingRate: parse("0.0001"), nextFundingTs: now() + 8 * 3600_000, ts: now() });

  const app = createApp({
    db: tx,
    host,
    registrar,
    symbols: config.symbols,
    jwtSecret: JWT_SECRET,
    webOrigin: "http://localhost:3001",
    mailer: null,
    google: null,
    secureCookies: false,
    now,
    logger: quiet,
    logRequests: false,
  });

  async function newAccount() {
    const id = await registrar.register({ provider: "email", providerId: `${randomUUID()}@test.local`, nickname: "tester" });
    return { id, token: await signToken(id, JWT_SECRET, now()) };
  }

  async function api(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    return { status: res.status, headers: res.headers, json: (await res.json()) as any };
  }

  return { engine, host, app, api, newAccount, clock, market, now };
}

const limitBuy = (clientOrderId: string, price = "49000", qty = "0.01") => ({
  clientOrderId,
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  timeInForce: "GTC",
  price,
  qty,
});
const marketOrder = (side: "BUY" | "SELL", qty: string) => ({ symbol: "BTCUSDT", side, type: "MARKET", qty });

async function ledgerMismatches(tx: DbExecutor, accountId: string) {
  const result = await tx.execute(sql`
    SELECT a.wallet_balance, COALESCE((SELECT SUM(amount) FROM ledger_entries l WHERE l.account_id = a.id), 0) AS ledger_sum
    FROM accounts a WHERE a.id = ${accountId}
  `);
  const row = result.rows[0] as { wallet_balance: string; ledger_sum: string };
  return BigInt(row.wallet_balance) - BigInt(row.ledger_sum);
}

describe("REST 接口（第 13 讲验收，真数据库）", () => {
  it("★ 下单 → 查挂单 → 撤单 → 按币对全撤；同一个 clientOrderId 提交两次（含并发）只产生一张单", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, clock } = await setup(tx);
      const a = await newAccount();
      const b = await newAccount();

      const first = await api("POST", "/orders", { token: a.token, body: limitBuy("c-1") });
      expect(first.status).toBe(200);
      expect(first.json.data).toMatchObject({ clientOrderId: "c-1", status: "NEW", price: "49000", qty: "0.01", executedQty: "0", positionSide: "BOTH" });
      expect(first.json.data.frozenMargin).not.toBe("0");
      expect(typeof first.json.data.queueAhead).toBe("string");

      // 重复提交：同一张单，带重放标记
      const again = await api("POST", "/orders", { token: a.token, body: limitBuy("c-1") });
      expect(again.status).toBe(200);
      expect(again.json.data.id).toBe(first.json.data.id);
      expect(again.headers.get("X-Idempotent-Replay")).toBe("true");

      // 并发两次：只有一张（时钟往前拨 1 毫秒：挂单按下单时间排序，时间相同时按 id，而 id 是随机的）
      clock.t += 1;
      const [p1, p2] = await Promise.all([
        api("POST", "/orders", { token: a.token, body: limitBuy("c-2", "48000") }),
        api("POST", "/orders", { token: a.token, body: limitBuy("c-2", "48000") }),
      ]);
      expect([p1.status, p2.status]).toEqual([200, 200]);
      expect(p1.json.data.id).toBe(p2.json.data.id);
      const rows = await tx.select().from(orders).where(eq(orders.accountId, a.id));
      expect(rows.map((r) => r.clientOrderId).sort()).toEqual(["c-1", "c-2"]);

      // 挂单来自引擎；资产里的挂单冻结 = 两张单冻结之和，可用余额相应减少
      const open = await api("GET", "/account/orders?status=open", { token: a.token });
      expect(open.json.data.items.map((o: any) => o.clientOrderId)).toEqual(["c-1", "c-2"]);
      const account = await api("GET", "/account", { token: a.token });
      const frozen = open.json.data.items.reduce((s: bigint, o: any) => s + parse(o.frozenMargin), 0n);
      expect(parse(account.json.data.openOrderMargin)).toBe(frozen);
      expect(parse(account.json.data.availableBalance)).toBe(parse("10000") - frozen);
      expect(account.json.data).toMatchObject({ walletBalance: "10000", positionMode: "ONE_WAY", canReset: true, resetAvailableAt: null, nickname: "tester" });

      // 别人撤不了我的单，也看不到
      expect((await api("DELETE", `/orders/${first.json.data.id}`, { token: b.token })).json.error.code).toBe("ORDER_NOT_FOUND");
      expect((await api("GET", "/account/orders?status=open", { token: b.token })).json.data.items).toEqual([]);

      const canceled = await api("DELETE", `/orders/${first.json.data.id}`, { token: a.token });
      expect(canceled.json.data).toMatchObject({ id: first.json.data.id, status: "CANCELED", frozenMargin: "0" });
      const twice = await api("DELETE", `/orders/${first.json.data.id}`, { token: a.token });
      expect(twice).toMatchObject({ status: 404, json: { ok: false, error: { code: "ORDER_NOT_FOUND" } } });
      expect((await api("DELETE", "/orders/not-a-uuid", { token: a.token })).status).toBe(404);

      await api("POST", "/orders", { token: a.token, body: limitBuy("c-3", "48500") });
      const all = await api("DELETE", "/orders?symbol=BTCUSDT", { token: a.token });
      expect(all.json.data.map((o: any) => [o.clientOrderId, o.status]).sort()).toEqual([["c-2", "CANCELED"], ["c-3", "CANCELED"]]);
      expect((await api("DELETE", "/orders?symbol=BTCUSDT", { token: a.token })).json.data).toEqual([]);

      // 历史订单来自数据库
      const history = await api("GET", "/account/orders?status=history", { token: a.token });
      expect(history.json.data.items.map((o: any) => o.clientOrderId).sort()).toEqual(["c-1", "c-2", "c-3"]);
      expect(await ledgerMismatches(tx, a.id)).toBe(0n);
    });
  });

  it("市价开仓 → 仓位（币安表示法）/ 成交 / 流水 → 一键平仓", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();

      const opened = await api("POST", "/orders", { token: a.token, body: marketOrder("SELL", "0.1") });
      expect(opened.json.data).toMatchObject({ type: "MARKET", status: "FILLED", executedQty: "0.1", avgPrice: "49999.9" });

      const positions = await api("GET", "/account/positions", { token: a.token });
      expect(positions.json.data).toHaveLength(1);
      const p = positions.json.data[0];
      // 单向模式空头：BOTH + 负数量（币安 positionRisk）
      expect(p).toMatchObject({ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "-0.1", entryPrice: "49999.9", markPrice: "50000", marginMode: "CROSS" });
      expect(parse(p.liquidationPrice) > parse("50000")).toBe(true); // 空头强平价在上方
      expect(parse(p.unrealizedPnl)).toBe(parse("-0.01"));

      const fills = await api("GET", "/account/fills", { token: a.token });
      expect(fills.json.data.items).toHaveLength(1);
      expect(fills.json.data.items[0]).toMatchObject({ role: "TAKER", qty: "0.1", price: "49999.9", orderId: opened.json.data.id });
      const fee = await api("GET", "/account/ledger?type=FEE", { token: a.token });
      expect(fee.json.data.items.map((l: any) => l.amount)).toEqual([`-${fills.json.data.items[0].fee}`]);

      const closed = await api("POST", "/positions/close", { token: a.token, body: { symbol: "BTCUSDT" } });
      expect(closed.json.data).toMatchObject({ side: "BUY", reduceOnly: true, status: "FILLED", executedQty: "0.1" });
      expect((await api("GET", "/account/positions", { token: a.token })).json.data).toEqual([]);
      expect((await api("POST", "/positions/close", { token: a.token, body: { symbol: "BTCUSDT" } })).json.error.code).toBe("POSITION_NOT_FOUND");
      expect((await api("GET", "/account/ledger", { token: a.token })).json.data.items.map((l: any) => l.type).sort()).toEqual(
        ["FEE", "FEE", "INITIAL", "REALIZED_PNL"].sort(),
      );
      expect(await ledgerMismatches(tx, a.id)).toBe(0n);
    });
  });

  it("仓位设置：调杠杆、切保证金模式（有仓位锁定）、调逐仓保证金、切持仓模式（有仓位锁定）", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();

      expect((await api("POST", "/positions/leverage", { token: a.token, body: { symbol: "BTCUSDT", leverage: 10 } })).json.data).toEqual({ symbol: "BTCUSDT", leverage: 10 });
      const tooHigh = await api("POST", "/positions/leverage", { token: a.token, body: { symbol: "BTCUSDT", leverage: 100000 } });
      expect(tooHigh.status).toBe(400);
      expect((await api("POST", "/positions/leverage", { token: a.token, body: { symbol: "BTCUSDT", leverage: "10" } })).json.error.code).toBe("INVALID_PARAMS");

      expect((await api("POST", "/positions/margin-mode", { token: a.token, body: { symbol: "BTCUSDT", marginMode: "ISOLATED" } })).status).toBe(200);
      await api("POST", "/orders", { token: a.token, body: marketOrder("BUY", "0.1") });
      const locked = await api("POST", "/positions/margin-mode", { token: a.token, body: { symbol: "BTCUSDT", marginMode: "CROSS" } });
      expect(locked).toMatchObject({ status: 409, json: { error: { code: "MARGIN_MODE_LOCKED" } } });

      const before = (await api("GET", "/account/positions", { token: a.token })).json.data[0];
      const added = await api("POST", "/positions/isolated-margin", { token: a.token, body: { symbol: "BTCUSDT", amount: "100", type: "ADD" } });
      expect(added.status).toBe(200);
      expect(parse(added.json.data[0].isolatedMargin)).toBe(parse(before.isolatedMargin) + parse("100"));
      expect(parse(added.json.data[0].liquidationPrice) < parse(before.liquidationPrice)).toBe(true); // 保证金多了，强平价离得更远
      const tooMuch = await api("POST", "/positions/isolated-margin", { token: a.token, body: { symbol: "BTCUSDT", amount: "5000", type: "REDUCE" } });
      expect(tooMuch.json.error.code).toBe("MARGIN_WOULD_LIQUIDATE");

      const modeLocked = await api("POST", "/account/position-mode", { token: a.token, body: { positionMode: "HEDGE" } });
      expect(modeLocked).toMatchObject({ status: 409, json: { error: { code: "POSITION_MODE_LOCKED" } } });
      await api("POST", "/positions/close", { token: a.token, body: { symbol: "BTCUSDT" } });
      expect((await api("POST", "/account/position-mode", { token: a.token, body: { positionMode: "HEDGE" } })).json.data).toEqual({ positionMode: "HEDGE" });

      // 双向模式：一键平仓必须指定方向
      await api("POST", "/orders", { token: a.token, body: { ...marketOrder("BUY", "0.1"), positionSide: "LONG" } });
      const hedged = (await api("GET", "/account/positions", { token: a.token })).json.data[0];
      expect(hedged).toMatchObject({ positionSide: "LONG", positionAmt: "0.1" });
      expect((await api("POST", "/positions/close", { token: a.token, body: { symbol: "BTCUSDT", positionSide: "SHORT" } })).json.error.code).toBe("POSITION_NOT_FOUND");
      expect((await api("POST", "/positions/close", { token: a.token, body: { symbol: "BTCUSDT", positionSide: "LONG" } })).json.data).toMatchObject({ side: "SELL", positionSide: "LONG", reduceOnly: false, status: "FILLED" });
      expect(await ledgerMismatches(tx, a.id)).toBe(0n);
    });
  });

  it("账户重置：平仓撤单、余额回到 10,000、写 RESET 流水；24 小时冷却（并发两次只成功一次）", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, clock } = await setup(tx);
      const a = await newAccount();
      await api("POST", "/orders", { token: a.token, body: marketOrder("BUY", "0.1") });
      await api("POST", "/orders", { token: a.token, body: limitBuy("resting") });

      const [r1, r2] = await Promise.all([api("POST", "/account/reset", { token: a.token }), api("POST", "/account/reset", { token: a.token })]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const done = r1.status === 200 ? r1 : r2;
      expect(done.json.data).toMatchObject({ walletBalance: "10000", resetAt: clock.t, resetAvailableAt: clock.t + RESET_COOLDOWN_MS });
      expect((r1.status === 409 ? r1 : r2).json.error.code).toBe("RESET_COOLING_DOWN");

      expect((await api("GET", "/account/positions", { token: a.token })).json.data).toEqual([]);
      expect((await api("GET", "/account/orders?status=open", { token: a.token })).json.data.items).toEqual([]);
      const account = (await api("GET", "/account", { token: a.token })).json.data;
      expect(account).toMatchObject({ walletBalance: "10000", canReset: false, resetAvailableAt: clock.t + RESET_COOLDOWN_MS });
      expect((await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.accountId, a.id), eq(ledgerEntries.type, "RESET")))).length).toBe(1);
      expect(await ledgerMismatches(tx, a.id)).toBe(0n);

      clock.t += RESET_COOLDOWN_MS;
      expect((await api("POST", "/account/reset", { token: a.token })).status).toBe(200);
    });
  });

  it("参数和权限：数值必须是字符串且最多 8 位小数、不支持的参数、未开放的币对、引擎拒单不入库、行情没就绪、没登录", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();
      const post = (body: unknown) => api("POST", "/orders", { token: a.token, body });

      expect((await post({ ...limitBuy("x"), qty: 0.01 })).json.error).toMatchObject({ code: "INVALID_PARAMS" });
      expect((await post({ ...limitBuy("x"), qty: "0.010000001" })).json.error.code).toBe("INVALID_PARAMS");
      expect((await post({ ...limitBuy("x"), priceProtect: true })).json.error.message).toBe("不支持的参数：priceProtect");
      expect((await post({ ...limitBuy("x"), type: "LIQUIDATION" })).json.error.code).toBe("INVALID_PARAMS");
      expect((await post({ ...limitBuy("x"), clientOrderId: "有中文" })).json.error.code).toBe("INVALID_PARAMS");
      expect((await post({ ...limitBuy("x"), symbol: "FOOUSDT" })).json.error.code).toBe("SYMBOL_NOT_TRADING");

      // 校验链拒单：HTTP 400 + 引擎的错误码和中文说明；被拒的单不入库，同一个 clientOrderId 改了参数可以重新下
      const rejected = await post(limitBuy("r-1", "10000"));
      expect(rejected).toMatchObject({ status: 400, json: { ok: false, error: { code: "PERCENT_PRICE" } } });
      expect((await tx.select().from(orders).where(eq(orders.clientOrderId, "r-1"))).length).toBe(0);
      expect((await post(limitBuy("r-1", "49000"))).json.data.status).toBe("NEW");

      // ETHUSDT 开放交易，但这个测试里没有行情
      const notReady = await post({ ...marketOrder("BUY", "1"), symbol: "ETHUSDT" });
      expect(notReady).toMatchObject({ status: 503, json: { error: { code: "MARKET_NOT_READY" } } });

      expect((await api("GET", "/account")).status).toBe(401);
      expect((await api("POST", "/orders", { body: limitBuy("x") })).json.error.code).toBe("UNAUTHORIZED");
      expect((await api("GET", "/account", { token: "bad" })).json.error.code).toBe("UNAUTHORIZED");

      expect((await api("POST", "/account/nickname", { token: a.token, body: { nickname: "  小明  " } })).json.data).toEqual({ nickname: "小明" });
      expect((await tx.select({ n: accounts.nickname }).from(accounts).where(eq(accounts.id, a.id)))[0]!.n).toBe("小明");
      expect((await api("POST", "/account/nickname", { token: a.token, body: { nickname: "x".repeat(21) } })).json.error.code).toBe("INVALID_PARAMS");
    });
  });

  it("游标分页：逐页翻完不重不漏；别人的 id 和不存在的 id 当游标都报 INVALID_PARAMS", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, clock } = await setup(tx);
      const a = await newAccount();
      const b = await newAccount();
      for (let i = 0; i < 5; i++) {
        clock.t += 1;
        await api("POST", "/orders", { token: a.token, body: marketOrder(i % 2 === 0 ? "BUY" : "SELL", "0.01") });
      }
      const all = (await api("GET", "/account/ledger?limit=100", { token: a.token })).json.data;
      expect(all.nextCursor).toBeNull();
      expect(all.items.length).toBeGreaterThanOrEqual(6);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: any = (await api("GET", `/account/ledger?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: a.token })).json.data;
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((l: any) => l.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(all.items.map((l: any) => l.id));
      expect(new Set(seen).size).toBe(seen.length);

      const bLedger = (await api("GET", "/account/ledger", { token: b.token })).json.data.items;
      expect((await api("GET", `/account/ledger?cursor=${bLedger[0].id}`, { token: a.token })).json.error.code).toBe("INVALID_PARAMS");
      expect((await api("GET", `/account/ledger?cursor=${randomUUID()}`, { token: a.token })).json.error.code).toBe("INVALID_PARAMS");
      expect((await api("GET", "/account/ledger?limit=101", { token: a.token })).json.error.code).toBe("INVALID_PARAMS");
      expect((await api("GET", "/account/fills?limit=3", { token: a.token })).json.data.items).toHaveLength(3);
      expect((await api("GET", "/account/funding", { token: a.token })).json.data).toEqual({ items: [], nextCursor: null });
      expect((await api("GET", "/account/liquidations", { token: a.token })).json.data).toEqual({ items: [], nextCursor: null });
    });
  });

  it("限流：下单 / 撤单 20 次 / 10 秒，按账户计；窗口过了恢复", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, clock } = await setup(tx);
      const a = await newAccount();
      const b = await newAccount();
      const cancel = (token: string) => api("DELETE", `/orders/${randomUUID()}`, { token });
      for (let i = 0; i < 20; i++) expect((await cancel(a.token)).status).toBe(404);
      const limited = await cancel(a.token);
      expect(limited).toMatchObject({ status: 429, json: { error: { code: "RATE_LIMITED" } } });
      expect(limited.headers.get("Retry-After")).toBe("10");
      expect((await cancel(b.token)).status).toBe(404); // 另一个账户不受影响
      expect((await api("GET", "/account", { token: a.token })).status).toBe(200); // 查询走另一个额度
      clock.t += 10_000;
      expect((await cancel(a.token)).status).toBe(404);
    });
  });
});
