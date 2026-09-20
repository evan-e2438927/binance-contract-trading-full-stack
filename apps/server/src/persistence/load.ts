import {
  accounts,
  accountSymbolSettings,
  leverageBrackets,
  orders,
  positions,
  symbols,
  type DbExecutor,
} from "@binance-contract-trading-full-stack/db";
import type {
  Account,
  AccountSymbolSetting,
  EngineConfig,
  EngineSnapshot,
  LeverageBracket,
  Order,
  Position,
  SymbolSpec,
} from "@binance-contract-trading-full-stack/engine";
import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import { asc, inArray, ne, or, eq } from "drizzle-orm";
import { fromDbPosition } from "./positions";

/**
 * 启动恢复：数据库 → 引擎配置 + 引擎快照（02-architecture.md 第七节"重启恢复"）。
 * 只读，不写任何东西。
 */

/** 手续费率：币安普通用户 USDT 合约 Maker 0.02% / Taker 0.05%（2026-09-17 币安费率页核对） */
export const FEES = { makerFeeRate: parse("0.0002"), takerFeeRate: parse("0.0005") };

/** 引擎配置里我们自己定的数（第 04 讲第 11 步：市价单最多吃可见深度的 50%；第 09 讲：条件单所有币对合计 200） */
export const LIMITS = { marketDepthRatio: parse("0.5"), maxConditionalOrdersNum: 200 };

/**
 * 加载哪些币对：开放的（enabled），加上**还有活跃仓位或挂单**的——
 * 币对下架之后用户的旧仓位和挂单还在，引擎必须认识这个币对才能恢复它们（新单会被校验链第 1 步拒掉）。
 */
export async function loadEngineConfig(db: DbExecutor): Promise<EngineConfig> {
  const held = db
    .selectDistinct({ symbol: positions.symbol })
    .from(positions)
    .where(ne(positions.positionAmt, 0n));
  const open = db
    .selectDistinct({ symbol: orders.symbol })
    .from(orders)
    .where(inArray(orders.status, ["NEW", "PARTIALLY_FILLED"]));
  const rows = await db
    .select()
    .from(symbols)
    .where(or(eq(symbols.enabled, true), inArray(symbols.symbol, held), inArray(symbols.symbol, open)))
    .orderBy(asc(symbols.sortOrder), asc(symbols.symbol));

  const specs = rows.map(toSymbolSpec);
  const names = specs.map((s) => s.symbol);
  const bracketRows =
    names.length === 0
      ? []
      : await db.select().from(leverageBrackets).where(inArray(leverageBrackets.symbol, names)).orderBy(asc(leverageBrackets.bracket));

  const brackets: Record<string, LeverageBracket[]> = {};
  for (const row of bracketRows) {
    (brackets[row.symbol] ??= []).push({
      bracketNum: row.bracket,
      notionalFloor: row.notionalFloor,
      notionalCap: row.notionalCap,
      maxLeverageNum: row.maxLeverage,
      mmr: row.mmr,
      cum: row.cum,
    });
  }
  return { symbols: specs, brackets, fees: FEES, limits: LIMITS };
}

function toSymbolSpec(row: typeof symbols.$inferSelect): SymbolSpec {
  // 第 11 讲加的列可空（迁移要能加到已有行上）。交给引擎之前必须全有值：缺了说明 seed:symbols 没跑，宁可启动失败
  const required = {
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    maxQty: row.maxQty,
    marketStepSize: row.marketStepSize,
    marketMinQty: row.marketMinQty,
    marketMaxQty: row.marketMaxQty,
    percentPriceUp: row.percentPriceUp,
    percentPriceDown: row.percentPriceDown,
    maxNumOrders: row.maxNumOrders,
    liquidationFeeRate: row.liquidationFeeRate,
  };
  const missing = Object.entries(required).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`币对 ${row.symbol} 缺少交易规则 ${missing.join(", ")}，先跑 pnpm --filter @binance-contract-trading-full-stack/db seed:symbols`);
  }
  return {
    symbol: row.symbol,
    status: row.status,
    enabled: row.enabled,
    tickSize: row.tickSize,
    minPrice: required.minPrice!,
    maxPrice: required.maxPrice!,
    stepSize: row.stepSize,
    minQty: row.minQty,
    maxQty: required.maxQty!,
    marketStepSize: required.marketStepSize!,
    marketMinQty: required.marketMinQty!,
    marketMaxQty: required.marketMaxQty!,
    minNotional: row.minNotional,
    percentPriceUp: required.percentPriceUp!,
    percentPriceDown: required.percentPriceDown!,
    maxNumOrdersNum: required.maxNumOrders!,
    liquidationFeeRate: required.liquidationFeeRate!,
  };
}

/**
 * 账户、设置、活跃仓位、未完成订单 → 引擎快照。
 *
 * 排队位置按 02-architecture.md 第七节"不能直接用库里的旧值——停机期间盘口早变了"：
 * 全部标成 queueEstimated = true。第一次盘口推送时引擎的 reconcileQueue 会把"估算过的单"
 * 直接换成这一档的总量（第 06 讲）——正好是设计要求的"保守：假设自己排在最后"，不用在这里另写一遍。
 */
export async function loadEngineSnapshot(db: DbExecutor): Promise<EngineSnapshot> {
  const accountRows = await db.select().from(accounts);
  const modes = new Map<string, PositionMode>(accountRows.map((a) => [a.id, a.positionMode]));

  const loadedAccounts: Account[] = accountRows.map((a) => ({
    id: a.id,
    walletBalance: a.walletBalance,
    positionMode: a.positionMode,
  }));

  const settings: AccountSymbolSetting[] = (await db.select().from(accountSymbolSettings)).map((s) => ({
    accountId: s.accountId,
    symbol: s.symbol,
    leverageNum: s.leverage,
    marginMode: s.marginMode,
  }));

  const loadedPositions: Position[] = (await db.select().from(positions).where(ne(positions.positionAmt, 0n))).map((p) => {
    const mode = modes.get(p.accountId);
    if (!mode) throw new Error(`仓位 ${p.id} 属于不存在的账户 ${p.accountId}`);
    const { positionSide, qty } = fromDbPosition(mode, p);
    if (!p.openedAt) throw new Error(`活跃仓位 ${p.id} 没有 opened_at`);
    return {
      accountId: p.accountId,
      symbol: p.symbol,
      positionSide,
      marginMode: p.marginMode,
      leverageNum: p.leverage,
      qty,
      entryPrice: p.entryPrice,
      isolatedMargin: p.isolatedMargin,
      costBasis: p.costBasis,
      openedAt: p.openedAt.getTime(),
      updatedAt: p.updatedAt.getTime(),
    };
  });

  const loadedOrders: Order[] = (
    await db.select().from(orders).where(inArray(orders.status, ["NEW", "PARTIALLY_FILLED"]))
  ).map((o) => ({
    id: o.id,
    clientOrderId: o.clientOrderId,
    accountId: o.accountId,
    symbol: o.symbol,
    side: o.side,
    positionSide: o.positionSide,
    type: o.type,
    timeInForce: o.timeInForce,
    price: o.price,
    stopPrice: o.stopPrice,
    workingType: o.workingType,
    qty: o.qty,
    executedQty: o.executedQty,
    avgPrice: o.avgPrice,
    reduceOnly: o.reduceOnly,
    closePosition: o.closePosition,
    status: o.status,
    triggered: o.triggered,
    queueAhead: o.queueAhead,
    queueEstimated: true, // 见函数注释：重启后排队位置一律当估算值，等第一次盘口推送校准
    frozenMargin: o.frozenMargin,
    rejectReason: o.rejectReason,
    createdAt: o.createdAt.getTime(),
    updatedAt: o.updatedAt.getTime(),
  }));

  return { accounts: loadedAccounts, settings, positions: loadedPositions, orders: loadedOrders };
}
