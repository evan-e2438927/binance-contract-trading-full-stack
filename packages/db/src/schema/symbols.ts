import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
  enabled: boolean("enabled").notNull().default(false), // 我们自己的字段：是否对用户开放，不是币安数据的一部分
  sortOrder: integer("sort_order").notNull().default(0), // 我们自己的字段：币对列表的展示顺序
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
