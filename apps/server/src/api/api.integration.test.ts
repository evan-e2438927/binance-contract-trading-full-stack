import { accounts, ledgerEntries, leverageBrackets, orders, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, marketOrder, setupApi } from "../testing/api-harness";
import { RESET_COOLDOWN_MS } from "./account";

/**
 * 第 13a 讲验收：每个接口一条集成测试；同一个 clientOrderId 提交两次只产生一张单。
 *
 * 脚手架见 testing/api-harness.ts：真数据库（事务最终回滚）+ 真引擎 + 真宿主 + createApp；
 * 行情是假的：BTCUSDT 一份固定盘口、标记价 50,000；交易规则和分层表是库里从币安同步来的真实数据
 * （最小名义价值 50、tickSize 0.1），所以金额断言只断言关系，不断言依赖分层表具体数值的数。
 */

const testDb = createTestDb();
afterAll(testDb.close);
const inRollback = testDb.inRollback;
const setup = setupApi;

const limitBuy = (clientOrderId: string, price = "49000", qty = "0.01") => ({
  clientOrderId,
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  timeInForce: "GTC",
  price,
  qty,
});

async function ledgerMismatches(tx: DbExecutor, accountId: string) {
  const result = await tx.execute(sql`
    SELECT a.wallet_balance, COALESCE((SELECT SUM(amount) FROM ledger_entries l WHERE l.account_id = a.id), 0) AS ledger_sum
    FROM accounts a WHERE a.id = ${accountId}
  `);
  const row = result.rows[0] as { wallet_balance: string; ledger_sum: string };
  return BigInt(row.wallet_balance) - BigInt(row.ledger_sum);
}

describe("REST 接口（第 13 讲验收，真数据库）", () => {
  it("下单面板的两个接口：币对配置 + 预估（可开最大能真的下进去）", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();

      // 没有持仓时也能读到这个币对当前的杠杆和保证金模式
      const config = await api("GET", "/account/symbol-config?symbol=BTCUSDT", { token: a.token });
      expect(config.status).toBe(200);
      expect(config.json.data).toMatchObject({ symbol: "BTCUSDT", marginMode: "CROSS" });
      expect(config.json.data.leverage).toBeGreaterThan(0);

      await api("POST", "/positions/leverage", { token: a.token, body: { symbol: "BTCUSDT", leverage: 10 } });
      const after = await api("GET", "/account/symbol-config?symbol=BTCUSDT", { token: a.token });
      expect(after.json.data.leverage).toBe(10);

      // 预估：限价买，成本、可开最大、成交后的强平价都有值
      const preview = await api("POST", "/orders/preview", {
        token: a.token,
        body: { symbol: "BTCUSDT", side: "BUY", price: "49000", qty: "0.01" },
      });
      expect(preview.status).toBe(200);
      expect(preview.json.data).toMatchObject({ symbol: "BTCUSDT", leverage: 10, marginMode: "CROSS", price: "49000", warnings: [] });
      expect(parse(preview.json.data.cost)).toBeGreaterThan(0n);
      // 仓位很小时钱包足够扛到价格归零，没有强平价——这时给 null，不编一个数
      expect(preview.json.data.liquidationPrice).toBeNull();

      // 按"可开最大"下单不会被可用余额拒（这正是这个字段存在的意义）
      const maxQty = preview.json.data.maxQty as string;
      const atMax = await api("POST", "/orders/preview", {
        token: a.token,
        body: { symbol: "BTCUSDT", side: "BUY", price: "49000", qty: maxQty },
      });
      // 用满可用余额时就有强平价了
      expect(parse(atMax.json.data.liquidationPrice)).toBeGreaterThan(0n);
      const placed = await api("POST", "/orders", {
        token: a.token,
        body: { clientOrderId: "c-max", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTC", price: "49000", qty: maxQty },
      });
      expect(placed.status).toBe(200);
      expect(placed.json.data.status).toBe("NEW");
    });
  });

  it("预估：不认识的参数直接拒，不假装支持", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();
      const res = await api("POST", "/orders/preview", {
        token: a.token,
        body: { symbol: "BTCUSDT", side: "BUY", qty: "0.01", leverage: 20 },
      });
      expect(res.status).toBe(400);
      expect(res.json.error.message).toContain("不支持的参数");
    });
  });

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

  it("跟踪委托（第 15 讲）：跟高 → 回撤触发 → 市价平仓，三个字段都落库", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, market, now } = await setup(tx);
      const a = await newAccount();
      let tradeId = 0;
      const trade = (price: string) =>
        market({ t: "trade", symbol: "BTCUSDT", tradeId: ++tradeId, price: parse(price), qty: parse("0.001"), buyerIsMaker: false, ts: now() });

      // 先开一个多头，再挂一张跟踪委托来保护它。跟踪委托默认按最新成交价跟，所以先喂一笔成交
      await api("POST", "/orders", { token: a.token, body: marketOrder("BUY", "0.1") });
      await trade("50000");

      const placed = await api("POST", "/orders", {
        token: a.token,
        body: { symbol: "BTCUSDT", side: "SELL", type: "TRAILING_STOP_MARKET", callbackRate: "1", qty: "0.1", reduceOnly: true },
      });
      // 没传激活价 = 从下单那一刻开始跟；未触发不冻结保证金；stopPrice 对这个类型无意义
      expect(placed.json.data).toMatchObject({
        type: "TRAILING_STOP_MARKET",
        status: "NEW",
        triggered: false,
        stopPrice: null,
        callbackRate: "1",
        activationPrice: "50000",
        trackedPrice: "50000",
        frozenMargin: "0",
      });

      // 价格往上走，跟踪价跟着走，不触发
      await trade("52000");
      const open = await api("GET", "/account/orders?status=open", { token: a.token });
      expect(open.json.data.items[0]).toMatchObject({ trackedPrice: "52000", triggered: false });

      // 从 52,000 回撤 1% 到 51,480：触发，按市价平掉多头
      await trade("51480");
      expect((await api("GET", "/account/orders?status=open", { token: a.token })).json.data.items).toEqual([]);
      expect((await api("GET", "/account/positions", { token: a.token })).json.data).toEqual([]);

      const history = await api("GET", "/account/orders?status=history", { token: a.token });
      const done = history.json.data.items.find((o: any) => o.type === "TRAILING_STOP_MARKET");
      expect(done).toMatchObject({ status: "FILLED", triggered: true, executedQty: "0.1", trackedPrice: "52000" });

      // 三列真的落库了（不是只活在内存里）
      const [row] = await tx.select().from(orders).where(eq(orders.id, done.id));
      expect(row).toMatchObject({ callbackRate: parse("1"), activationPrice: parse("50000"), trackedPrice: parse("52000") });
      expect(await ledgerMismatches(tx, a.id)).toBe(0n);
    });
  });

  it("跟踪委托的参数校验：回调率超范围、激活价方向反了、不传回调率", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount, market, now } = await setup(tx);
      const a = await newAccount();
      await market({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("50000"), qty: parse("0.001"), buyerIsMaker: false, ts: now() });
      const place = (body: Record<string, unknown>) =>
        api("POST", "/orders", { token: a.token, body: { symbol: "BTCUSDT", side: "SELL", type: "TRAILING_STOP_MARKET", qty: "0.01", ...body } });

      expect((await place({ callbackRate: "0.05" })).json.error.code).toBe("INVALID_PARAMS");
      expect((await place({ callbackRate: "10.5" })).json.error.message).toMatch("超出允许范围");
      expect((await place({})).json.error.message).toMatch("必须填回调率");
      // 币安 -2021：卖单的激活价必须高于现价
      expect((await place({ callbackRate: "1", activationPrice: "49000" })).json.error.code).toBe("WOULD_IMMEDIATELY_TRIGGER");
      // 不是跟踪委托就不能传这两个参数
      expect((await api("POST", "/orders", { token: a.token, body: { ...marketOrder("BUY", "0.01"), callbackRate: "1" } })).json.error.message).toMatch(
        "不接受回调率",
      );
    });
  });

  it("仓位设置：调杠杆、切保证金模式（有仓位锁定）、调逐仓保证金、切持仓模式（有仓位锁定）", async () => {
    await inRollback(async (tx) => {
      const { api, newAccount } = await setup(tx);
      const a = await newAccount();

      const leverage = (await api("POST", "/positions/leverage", { token: a.token, body: { symbol: "BTCUSDT", leverage: 10 } })).json.data;
      expect(leverage).toMatchObject({ symbol: "BTCUSDT", leverage: 10 });
      // 最大可开 = 允许 10x 的档位里上限最高的一档（用库里真实分层表独立算一遍）
      const tiers = await tx.select().from(leverageBrackets).where(eq(leverageBrackets.symbol, "BTCUSDT"));
      const expectedMax = tiers.filter((b) => b.maxLeverage >= 10).map((b) => b.notionalCap).reduce((m, v) => (v > m ? v : m), 0n);
      expect(parse(leverage.maxNotional)).toBe(expectedMax);
      expect(expectedMax > 0n).toBe(true);
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
