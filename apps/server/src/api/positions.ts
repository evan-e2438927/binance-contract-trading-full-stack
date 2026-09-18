import { leverageBrackets } from "@binance-contract-trading-full-stack/db";
import { AppError, MARGIN_MODE, POSITION_SIDE } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthEnv } from "../auth/routes";
import { decimalInput, toDecimal } from "../http/decimal";
import { ok, parseBody } from "../http/respond";
import { requireKnownSymbol, requireTradableSymbol, submitOrThrow, type ApiDeps } from "./context";
import { orderFromEngine, positionJson } from "./serialize";

/**
 * 仓位设置接口（04-backend-design.md 第 11 节"交易"）。规则全在引擎 account-ops.ts（按币安核对，07 第 9 节），
 * 这里只做参数形状和错误翻译。
 */

const symbolField = z.string({ error: "缺少 symbol" }).min(1, "缺少 symbol");
const positionSideField = z.enum(POSITION_SIDE, { error: "positionSide 只能是 BOTH / LONG / SHORT" }).default("BOTH");

const leverageSchema = z.strictObject({
  symbol: symbolField,
  // 币安 Change Initial Leverage 只说"target initial leverage"，上限按币对分层表（BTCUSDT 第 1 层现在是 150x），交给引擎校验
  leverage: z.number({ error: "leverage 要传整数" }).int("leverage 要传整数").min(1, "leverage 最小 1"),
});
const marginModeSchema = z.strictObject({
  symbol: symbolField,
  marginMode: z.enum(MARGIN_MODE, { error: "marginMode 只能是 CROSS 或 ISOLATED" }),
});
const isolatedMarginSchema = z.strictObject({
  symbol: symbolField,
  positionSide: positionSideField,
  amount: decimalInput("amount"),
  // 币安 Modify Isolated Position Margin 用 type 1 / 2；我们用可读的 ADD / REDUCE（缺口 #42）
  type: z.enum(["ADD", "REDUCE"], { error: "type 只能是 ADD（增加）或 REDUCE（减少）" }),
});
const closeSchema = z.strictObject({ symbol: symbolField, positionSide: positionSideField });

export function createPositionRoutes(deps: ApiDeps, middleware: { auth: MiddlewareHandler<AuthEnv>; rateLimit: MiddlewareHandler }) {
  const { host } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", middleware.auth, middleware.rateLimit);

  routes.post("/leverage", async (c) => {
    const body = await parseBody(c, leverageSchema);
    requireKnownSymbol(deps.symbols, body.symbol);
    await submitOrThrow(host, { t: "setLeverage", accountId: c.var.accountId, symbol: body.symbol, leverageNum: body.leverage, ts: deps.now() });
    // 缺口 #44：和币安 Change Initial Leverage 的 maxNotionalValue 同义——允许这个杠杆的档位里上限最高的那一档
    // （和引擎 validate-order.ts 的 maxNotionalFor 同一个算法；分层表以数据库为准，热加载后库里就是最新的）
    const brackets = await deps.db.select().from(leverageBrackets).where(eq(leverageBrackets.symbol, body.symbol));
    const maxNotional = brackets.filter((b) => b.maxLeverage >= body.leverage).reduce((max, b) => (b.notionalCap > max ? b.notionalCap : max), 0n);
    return ok(c, { symbol: body.symbol, leverage: body.leverage, maxNotional: toDecimal(maxNotional) });
  });

  routes.post("/margin-mode", async (c) => {
    const body = await parseBody(c, marginModeSchema);
    requireKnownSymbol(deps.symbols, body.symbol);
    await submitOrThrow(host, { t: "setMarginMode", accountId: c.var.accountId, symbol: body.symbol, mode: body.marginMode, ts: deps.now() });
    return ok(c, { symbol: body.symbol, marginMode: body.marginMode });
  });

  routes.post("/isolated-margin", async (c) => {
    const accountId = c.var.accountId;
    const body = await parseBody(c, isolatedMarginSchema);
    requireKnownSymbol(deps.symbols, body.symbol);
    if (body.amount === 0n) throw new AppError("INVALID_PARAMS", "amount 必须大于 0");
    const delta = body.type === "ADD" ? body.amount : -body.amount;
    await submitOrThrow(host, { t: "adjustIsolatedMargin", accountId, symbol: body.symbol, positionSide: body.positionSide, delta, ts: deps.now() });
    // 返回调整后的仓位（强平价随逐仓保证金变了）
    const positions = await host.read((engine) => {
      const view = engine.accountView(accountId)!;
      return engine.positionViews(accountId).filter((p) => p.symbol === body.symbol).map((p) => positionJson(view.positionMode, p));
    });
    return ok(c, positions);
  });

  /**
   * 一键平仓：按当前仓位数量下一张市价单。
   * 单向模式带 reduceOnly（万一在读仓位和下单之间仓位变小，引擎按只减仓截断，缺口 #18）；
   * 双向模式按币安规则不能传 reduceOnly，SELL + LONG 本身就是平多。
   * 超过市价单最大数量（BTCUSDT 120）会被校验链拒掉 LOT_SIZE——不自动拆单，宁可说做不到。
   */
  routes.post("/close", async (c) => {
    const accountId = c.var.accountId;
    const body = await parseBody(c, closeSchema);
    requireTradableSymbol(deps.symbols, body.symbol);

    const target = await host.read((engine) => {
      const view = engine.accountView(accountId);
      if (!view) return null;
      const position = engine
        .positionViews(accountId)
        .find((p) => p.symbol === body.symbol && (view.positionMode === "ONE_WAY" || p.positionSide === body.positionSide));
      return position ? { mode: view.positionMode, position } : null;
    });
    if (!target) throw new AppError("POSITION_NOT_FOUND", `${body.symbol} 上没有可以平的仓位`);
    if (target.mode === "HEDGE" && body.positionSide === "BOTH") {
      throw new AppError("POSITION_SIDE_MISMATCH", "当前是双向持仓模式，positionSide 必须是 LONG 或 SHORT");
    }

    const orderId = randomUUID();
    const { position, mode } = target;
    const events = await submitOrThrow(host, {
      t: "placeOrder",
      accountId,
      orderId,
      req: {
        clientOrderId: `close_${randomUUID().replace(/-/g, "").slice(0, 30)}`,
        symbol: body.symbol,
        side: position.positionSide === "LONG" ? "SELL" : "BUY",
        positionSide: mode === "ONE_WAY" ? "BOTH" : position.positionSide,
        type: "MARKET",
        qty: position.qty,
        ...(mode === "ONE_WAY" ? { reduceOnly: true } : {}),
      },
      ts: deps.now(),
    });
    const update = events.findLast((e) => e.t === "orderUpdate" && e.order.id === orderId);
    if (!update || update.t !== "orderUpdate") throw new Error(`平仓单 ${orderId} 没有产生订单事件`);
    return ok(c, orderFromEngine(update.order));
  });

  return routes;
}
