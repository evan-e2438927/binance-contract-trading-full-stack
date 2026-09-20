import { orders } from "@binance-contract-trading-full-stack/db";
import type { PlaceOrderRequest } from "@binance-contract-trading-full-stack/engine";
import { AppError, ORDER_SIDE, POSITION_SIDE, TIME_IN_FORCE, WORKING_TYPE } from "@binance-contract-trading-full-stack/shared";
import { and, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthEnv } from "../auth/routes";
import { isUniqueViolation } from "../http/db-errors";
import { decimalInput } from "../http/decimal";
import { ok, parseBody, parseQuery } from "../http/respond";
import { requireKnownSymbol, requireTradableSymbol, submitOrThrow, type ApiDeps } from "./context";
import { toDecimalOrNull } from "../http/decimal";
import { orderFromDb, orderFromEngine } from "./serialize";

/**
 * 交易接口：下单、撤单、按币对全撤（04-backend-design.md 第 11 节"交易"）。
 *
 * 参数规则按币安 New Order / New Algo Order（07-binance-reference.md 第 2 节）；组合是否合法交给引擎校验链第 3 步，
 * 这里只管"形状"：字段类型、枚举值、数值格式、不认识的参数。
 */

/** 用户能下的订单类型：LIQUIDATION 只有强平时系统能下 */
const USER_ORDER_TYPES = ["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"] as const;

/** 币安 newClientOrderId 的规则（New Order 参数说明，2026-09-17 核对） */
const CLIENT_ORDER_ID = /^[.A-Z:/a-z0-9_-]{1,36}$/;

const placeOrderSchema = z.strictObject(
  {
    clientOrderId: z.string().regex(CLIENT_ORDER_ID, "clientOrderId 只能是 1～36 位字母、数字或 . : / _ -").optional(),
    symbol: z.string({ error: "缺少 symbol" }).min(1, "缺少 symbol"),
    side: z.enum(ORDER_SIDE, { error: "side 只能是 BUY 或 SELL" }),
    // 币安：单向模式默认 BOTH
    positionSide: z.enum(POSITION_SIDE, { error: "positionSide 只能是 BOTH / LONG / SHORT" }).default("BOTH"),
    type: z.enum(USER_ORDER_TYPES, { error: `type 只能是 ${USER_ORDER_TYPES.join(" / ")}` }),
    timeInForce: z.enum(TIME_IN_FORCE, { error: "timeInForce 只能是 GTC / IOC / FOK / GTX" }).optional(),
    price: decimalInput("price").optional(),
    stopPrice: decimalInput("stopPrice").optional(),
    workingType: z.enum(WORKING_TYPE, { error: "workingType 只能是 MARK_PRICE 或 CONTRACT_PRICE" }).optional(),
    qty: decimalInput("qty").optional(),
    reduceOnly: z.boolean({ error: "reduceOnly 要传布尔值" }).optional(),
    closePosition: z.boolean({ error: "closePosition 要传布尔值" }).optional(),
  },
  {
    // 缺口 #28：priceProtect、goodTillDate、activationPrice（跟踪止损）等没实现的参数，直接拒，不假装支持
    error: (issue) => (issue.code === "unrecognized_keys" ? `不支持的参数：${issue.keys.join(", ")}` : undefined),
  },
);

/**
 * 下单预估（前端 M07 的预估区）。只读，不产生任何订单。
 * price 不传 = 市价，用标记价估；qty 不传 = 只想知道可开最大数量。
 */
const previewSchema = z.strictObject(
  {
    symbol: z.string({ error: "缺少 symbol" }).min(1, "缺少 symbol"),
    side: z.enum(ORDER_SIDE, { error: "side 只能是 BUY 或 SELL" }),
    positionSide: z.enum(POSITION_SIDE, { error: "positionSide 只能是 BOTH / LONG / SHORT" }).default("BOTH"),
    price: decimalInput("price").optional(),
    qty: decimalInput("qty").optional(),
  },
  {
    error: (issue) => (issue.code === "unrecognized_keys" ? `不支持的参数：${issue.keys.join(", ")}` : undefined),
  },
);

export function createOrderRoutes(deps: ApiDeps, middleware: { auth: MiddlewareHandler<AuthEnv>; orderRateLimit: MiddlewareHandler }) {
  const { db, host } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", middleware.auth, middleware.orderRateLimit);

  async function findByClientOrderId(accountId: string, clientOrderId: string) {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.accountId, accountId), eq(orders.clientOrderId, clientOrderId)));
    return row;
  }

  routes.post("/", async (c) => {
    const accountId = c.var.accountId;
    const body = await parseBody(c, placeOrderSchema);
    requireTradableSymbol(deps.symbols, body.symbol);
    const clientOrderId = body.clientOrderId ?? `web_${randomUUID().replace(/-/g, "").slice(0, 32)}`;

    // 幂等（设计文档）：同一账户同一个 clientOrderId 重复提交，返回已经存在的那张单，不再下一次。
    // 和币安不同（缺口 #41）：币安只要求"在未完成订单里唯一"，我们对历史订单也唯一（orders_acc_client_uq），
    // 网络超时重试不管那张单成交没成交都不会重复下
    const replay = async () => {
      const existing = await findByClientOrderId(accountId, clientOrderId);
      if (!existing) return null;
      c.header("X-Idempotent-Replay", "true");
      return ok(c, orderFromDb(existing));
    };
    const early = await replay();
    if (early) return early;

    const orderId = randomUUID();
    const req: PlaceOrderRequest = { ...body, clientOrderId };
    let events;
    try {
      events = await submitOrThrow(host, { t: "placeOrder", accountId, orderId, req, ts: deps.now() });
    } catch (error) {
      // 两个同样的请求同时到：都没查到、都去下单，队列一前一后，后一个撞唯一索引、引擎回滚。返回前一个下的那张
      if (isUniqueViolation(error, "orders_acc_client_uq")) {
        const replayed = await replay();
        if (replayed) return replayed;
      }
      throw error;
    }

    const update = events.findLast((e) => e.t === "orderUpdate" && e.order.id === orderId);
    if (!update || update.t !== "orderUpdate") throw new Error(`下单 ${orderId} 没有产生订单事件`);
    return ok(c, orderFromEngine(update.order));
  });

  routes.post("/preview", async (c) => {
    const accountId = c.var.accountId;
    const body = await parseBody(c, previewSchema);
    requireTradableSymbol(deps.symbols, body.symbol);
    const view = await host.read((engine) =>
      engine.previewOrder({
        accountId,
        symbol: body.symbol,
        side: body.side,
        positionSide: body.positionSide,
        price: body.price ?? null,
        qty: body.qty ?? null,
      }),
    );
    return ok(c, {
      symbol: view.symbol,
      leverage: view.leverageNum,
      marginMode: view.marginMode,
      price: toDecimalOrNull(view.price),
      cost: toDecimalOrNull(view.cost),
      maxQty: toDecimalOrNull(view.maxQty),
      liquidationPrice: toDecimalOrNull(view.liquidationPrice),
      warnings: view.warnings,
    });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) throw new AppError("ORDER_NOT_FOUND", `订单 ${id} 不存在或已经结束`);
    const events = await submitOrThrow(host, { t: "cancelOrder", accountId: c.var.accountId, orderId: id, ts: deps.now() });
    const update = events.find((e) => e.t === "orderUpdate");
    if (!update || update.t !== "orderUpdate") throw new Error(`撤单 ${id} 没有产生订单事件`);
    return ok(c, orderFromEngine(update.order));
  });

  routes.delete("/", async (c) => {
    const { symbol } = parseQuery(c, z.object({ symbol: z.string({ error: "缺少 symbol" }).min(1, "缺少 symbol") }));
    requireKnownSymbol(deps.symbols, symbol);
    const events = await submitOrThrow(host, { t: "cancelAllOrders", accountId: c.var.accountId, symbol, ts: deps.now() });
    return ok(c, events.flatMap((e) => (e.t === "orderUpdate" ? [orderFromEngine(e.order)] : [])));
  });

  return routes;
}
