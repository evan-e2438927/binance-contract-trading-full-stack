import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * 币对规格表 —— 下单校验的规格来源。
 *
 * 数据来自币安 `exchangeInfo`，`seed:symbols` 每天同步一次。下单校验链里"价格是不是
 * tickSize 的整数倍""数量够不够 minQty""名义价值够不够 minNotional"全查这张表，
 * 所以它必须先于任何交易数据存在（`positions`/`orders` 都外键引用 symbol）。
 *
 * `enabled` 和 `sortOrder` 是我们自己的运营字段，不属于币安数据：币安有几百个币对，
 * 我们只开放其中十几个。这两列由 `seed:symbols` 按 `brackets/open-symbols.ts` 的名单设置，
 * 分层表同步也只处理 `enabled = true` 的币对。
 */
export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(), // 'BTCUSDT' 这种币安原生的交易对代码，直接当主键
  baseAsset: text("base_asset").notNull(), // 'BTC'——标的资产
  quoteAsset: text("quote_asset").notNull(), // 'USDT'——计价资产，本项目目前只对接 U 本位
  status: text("status").notNull(), // 币安那边的状态，如 'TRADING'/'SETTLING'，原样存
  pricePrecision: integer("price_precision").notNull(), // 价格小数位数，前端展示用
  quantityPrecision: integer("quantity_precision").notNull(), // 数量小数位数，前端展示用
  tickSize: bigint("tick_size", { mode: "bigint" }).notNull(), // 价格最小变动单位，下单校验链第 5 步要用
  stepSize: bigint("step_size", { mode: "bigint" }).notNull(), // 数量最小变动单位，同上
  minQty: bigint("min_qty", { mode: "bigint" }).notNull(), // 最小下单数量
  minNotional: bigint("min_notional", { mode: "bigint" }).notNull(), // 最小下单名义价值（价格 × 数量）
  // ↓ 第 11 讲按币安 exchangeInfo 补的交易规则（缺口 #17，字段对照见 docs/tutorial/04-order-validation.md 第 7 节）。
  //   可空只是为了迁移能加到已有的几百行上；seed:symbols 会全部填上，宿主加载开放币对时缺值直接报错
  minPrice: bigint("min_price", { mode: "bigint" }), // PRICE_FILTER.minPrice，委托价 / 触发价下限
  maxPrice: bigint("max_price", { mode: "bigint" }), // PRICE_FILTER.maxPrice
  maxQty: bigint("max_qty", { mode: "bigint" }), // LOT_SIZE.maxQty，限价类订单数量上限
  marketStepSize: bigint("market_step_size", { mode: "bigint" }), // MARKET_LOT_SIZE.stepSize
  marketMinQty: bigint("market_min_qty", { mode: "bigint" }), // MARKET_LOT_SIZE.minQty
  marketMaxQty: bigint("market_max_qty", { mode: "bigint" }), // MARKET_LOT_SIZE.maxQty，市价单数量上限
  percentPriceUp: bigint("percent_price_up", { mode: "bigint" }), // PERCENT_PRICE.multiplierUp，定标 1e8
  percentPriceDown: bigint("percent_price_down", { mode: "bigint" }), // PERCENT_PRICE.multiplierDown
  maxNumOrders: integer("max_num_orders"), // MAX_NUM_ORDERS.limit，每个账户在这个币对上的挂单数上限
  liquidationFeeRate: bigint("liquidation_fee_rate", { mode: "bigint" }), // 币对字段 liquidationFee，强平清算费率（第 07 讲）
  enabled: boolean("enabled").notNull().default(false), // 我们自己的字段：是否对用户开放，不是币安数据的一部分
  sortOrder: integer("sort_order").notNull().default(0), // 我们自己的字段：币对列表的展示顺序
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
