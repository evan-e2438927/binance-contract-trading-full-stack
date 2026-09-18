import { accounts, equitySnapshots, fills, fundingPayments, ledgerEntries, liquidations, orders } from "@binance-contract-trading-full-stack/db";
import { AppError, LEDGER_TYPE, POSITION_MODE } from "@binance-contract-trading-full-stack/shared";
import { and, asc, eq, gt, notInArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth/routes";
import { INITIAL_WALLET_BALANCE } from "../engine-host/register-account";
import { toDecimal } from "../http/decimal";
import { pageQuery, paginate } from "../http/pagination";
import { ok, parseBody, parseQuery } from "../http/respond";
import { submitOrThrow, type ApiDeps } from "./context";
import { accountJson, fillJson, fundingJson, ledgerJson, liquidationJson, orderFromDb, orderFromEngine, positionJson } from "./serialize";

/**
 * 账户接口（04-backend-design.md 第 11 节"账户"）。
 *
 * 数据从哪来：
 * - 实时状态（资产、仓位、挂单）读引擎（host.read，排在队列里，读到的一定已落库）——排队位置、强平价是实时算的
 * - 历史（订单历史、成交、流水、资金费、强平记录）读数据库，游标分页
 */

/** 账户重置冷却（设计文档"距离上次重置 ≥ 24 小时"） */
export const RESET_COOLDOWN_MS = 24 * 3600_000;

const symbolFilter = z.string().min(1).optional();

export function createAccountRoutes(deps: ApiDeps, middleware: { auth: MiddlewareHandler<AuthEnv>; rateLimit: MiddlewareHandler }) {
  const { db, host } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", middleware.auth, middleware.rateLimit);

  async function accountRow(accountId: string) {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!row) throw new AppError("UNAUTHORIZED", "账户不存在，请重新登录");
    return row;
  }

  function resetAvailableAt(lastResetAt: Date | null): number | null {
    if (!lastResetAt) return null;
    const at = lastResetAt.getTime() + RESET_COOLDOWN_MS;
    return at > deps.now() ? at : null;
  }

  routes.get("/", async (c) => {
    const accountId = c.var.accountId;
    const row = await accountRow(accountId);
    const view = await host.read((engine) => engine.accountView(accountId));
    if (!view) throw new AppError("UNAUTHORIZED", "账户不存在，请重新登录");
    const availableAt = resetAvailableAt(row.lastResetAt);
    return ok(c, {
      ...accountJson(view),
      nickname: row.nickname,
      canReset: availableAt === null,
      resetAvailableAt: availableAt,
    });
  });

  routes.get("/positions", async (c) => {
    const accountId = c.var.accountId;
    const result = await host.read((engine) => {
      const view = engine.accountView(accountId);
      return view ? engine.positionViews(accountId).map((p) => positionJson(view.positionMode, p)) : null;
    });
    if (!result) throw new AppError("UNAUTHORIZED", "账户不存在，请重新登录");
    return ok(c, result);
  });

  routes.get("/orders", async (c) => {
    const accountId = c.var.accountId;
    const query = parseQuery(
      c,
      z.object({
        status: z.enum(["open", "history"], { error: "status 只能是 open 或 history" }).default("open"),
        symbol: symbolFilter,
        ...pageQuery,
      }),
    );
    if (query.status === "open") {
      // 挂单从引擎读：排队位置是实时的。数量有上限（每币对 200），不分页
      const open = await host.read((engine) => engine.openOrders(accountId));
      const items = open.filter((o) => !query.symbol || o.symbol === query.symbol).map(orderFromEngine);
      return ok(c, { items, nextCursor: null });
    }
    const page = await paginate<typeof orders.$inferSelect>({
      db,
      table: orders,
      idColumn: orders.id,
      timeColumn: orders.createdAt,
      accountColumn: orders.accountId,
      accountId,
      filters: [notInArray(orders.status, ["NEW", "PARTIALLY_FILLED"]), query.symbol ? eq(orders.symbol, query.symbol) : undefined],
      limit: query.limit,
      cursor: query.cursor,
    });
    return ok(c, { items: page.items.map(orderFromDb), nextCursor: page.nextCursor });
  });

  routes.get("/fills", async (c) => {
    const query = parseQuery(c, z.object({ symbol: symbolFilter, ...pageQuery }));
    const page = await paginate<typeof fills.$inferSelect>({
      db,
      table: fills,
      idColumn: fills.id,
      timeColumn: fills.createdAt,
      accountColumn: fills.accountId,
      accountId: c.var.accountId,
      filters: [query.symbol ? eq(fills.symbol, query.symbol) : undefined],
      limit: query.limit,
      cursor: query.cursor,
    });
    return ok(c, { items: page.items.map(fillJson), nextCursor: page.nextCursor });
  });

  routes.get("/ledger", async (c) => {
    const query = parseQuery(
      c,
      z.object({ type: z.enum(LEDGER_TYPE, { error: `type 只能是 ${LEDGER_TYPE.join(" / ")}` }).optional(), symbol: symbolFilter, ...pageQuery }),
    );
    const page = await paginate<typeof ledgerEntries.$inferSelect>({
      db,
      table: ledgerEntries,
      idColumn: ledgerEntries.id,
      timeColumn: ledgerEntries.createdAt,
      accountColumn: ledgerEntries.accountId,
      accountId: c.var.accountId,
      filters: [query.type ? eq(ledgerEntries.type, query.type) : undefined, query.symbol ? eq(ledgerEntries.symbol, query.symbol) : undefined],
      limit: query.limit,
      cursor: query.cursor,
    });
    return ok(c, { items: page.items.map(ledgerJson), nextCursor: page.nextCursor });
  });

  routes.get("/funding", async (c) => {
    const query = parseQuery(c, z.object({ symbol: symbolFilter, ...pageQuery }));
    const page = await paginate<typeof fundingPayments.$inferSelect>({
      db,
      table: fundingPayments,
      idColumn: fundingPayments.id,
      timeColumn: fundingPayments.settledAt,
      accountColumn: fundingPayments.accountId,
      accountId: c.var.accountId,
      filters: [query.symbol ? eq(fundingPayments.symbol, query.symbol) : undefined],
      limit: query.limit,
      cursor: query.cursor,
    });
    return ok(c, { items: page.items.map(fundingJson), nextCursor: page.nextCursor });
  });

  routes.get("/liquidations", async (c) => {
    const query = parseQuery(c, z.object({ symbol: symbolFilter, ...pageQuery }));
    const page = await paginate<typeof liquidations.$inferSelect>({
      db,
      table: liquidations,
      idColumn: liquidations.id,
      timeColumn: liquidations.createdAt,
      accountColumn: liquidations.accountId,
      accountId: c.var.accountId,
      filters: [query.symbol ? eq(liquidations.symbol, query.symbol) : undefined],
      limit: query.limit,
      cursor: query.cursor,
    });
    return ok(c, { items: page.items.map(liquidationJson), nextCursor: page.nextCursor });
  });

  /**
   * 权益曲线：每日快照（UTC 00:00）+ 当前实时权益。没拍到快照的日子就是缺的，不插值（错过就跳过，第 13b 讲）。
   */
  routes.get("/equity-curve", async (c) => {
    const accountId = c.var.accountId;
    const { days } = parseQuery(
      c,
      z.object({ days: z.coerce.number({ error: "days 必须是整数" }).int("days 必须是整数").min(1, "days 最小 1").max(365, "days 最大 365").default(30) }),
    );
    const from = new Date(deps.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(equitySnapshots)
      .where(and(eq(equitySnapshots.accountId, accountId), gt(equitySnapshots.snapDate, from)))
      .orderBy(asc(equitySnapshots.snapDate));
    const view = await host.read((engine) => engine.accountView(accountId));
    if (!view) throw new AppError("UNAUTHORIZED", "账户不存在，请重新登录");
    return ok(c, {
      snapshots: rows.map((r) => ({
        date: r.snapDate,
        equity: toDecimal(r.equity),
        walletBalance: toDecimal(r.walletBalance),
        cumulativePnl: toDecimal(r.cumulativePnl),
        roi: toDecimal(r.roi),
      })),
      current: { equity: view.marginBalance === null ? null : toDecimal(view.marginBalance), time: deps.now() },
    });
  });

  /**
   * 重置：引擎撤单 + 按标记价平仓 + RESET 流水补到 10,000（第 08 讲）；24 小时冷却由这里查 last_reset_at。
   * 同一个账户的重置串行（进程内锁）：两个并发请求不会都通过冷却检查、重置两次。
   */
  const resetLocks = new Map<string, Promise<unknown>>();
  routes.post("/reset", async (c) => {
    const accountId = c.var.accountId;
    const previous = resetLocks.get(accountId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const row = await accountRow(accountId);
      const availableAt = resetAvailableAt(row.lastResetAt);
      if (availableAt !== null) {
        throw new AppError("RESET_COOLING_DOWN", `重置冷却中，${new Date(availableAt).toISOString()} 之后可以再次重置`);
      }
      const ts = deps.now();
      await submitOrThrow(host, { t: "resetAccount", accountId, walletBalance: INITIAL_WALLET_BALANCE, ts });
      return { walletBalance: toDecimal(INITIAL_WALLET_BALANCE), resetAt: ts, resetAvailableAt: ts + RESET_COOLDOWN_MS };
    });
    resetLocks.set(accountId, current);
    try {
      return ok(c, await current);
    } finally {
      if (resetLocks.get(accountId) === current) resetLocks.delete(accountId);
    }
  });

  routes.post("/position-mode", async (c) => {
    const body = await parseBody(c, z.strictObject({ positionMode: z.enum(POSITION_MODE, { error: "positionMode 只能是 ONE_WAY 或 HEDGE" }) }));
    await submitOrThrow(host, { t: "setPositionMode", accountId: c.var.accountId, mode: body.positionMode, ts: deps.now() });
    return ok(c, { positionMode: body.positionMode });
  });

  routes.post("/nickname", async (c) => {
    const body = await parseBody(
      c,
      z.strictObject({
        nickname: z
          .string({ error: "缺少 nickname" })
          .trim()
          .min(1, "昵称不能为空")
          .max(20, "昵称最多 20 个字")
          .regex(/^[^\p{C}]+$/u, "昵称不能包含控制字符"),
      }),
    );
    await db.update(accounts).set({ nickname: body.nickname }).where(eq(accounts.id, c.var.accountId));
    return ok(c, { nickname: body.nickname });
  });

  return routes;
}
