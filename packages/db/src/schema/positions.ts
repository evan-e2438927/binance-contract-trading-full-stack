import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum, positionSideEnum } from "./enums";
import { symbols } from "./symbols";

/**
 * 仓位表 —— "我现在手上拿着什么"，每次成交都要改。
 *
 * 唯一键 (accountId, symbol, positionSide) 同时兼容两种持仓模式：单向模式下
 * positionSide 恒为 BOTH，一个币对只会有一行；双向模式下 LONG/SHORT 各占一行，
 * 两个仓位独立记开仓价、独立算盈亏、独立强平。
 *
 * 三个刻意的设计选择：
 * 1. **平仓后不删行**（留 `qty = 0`）。删了之后切持仓模式、查历史都要处理"不存在"的
 *    分支，留着更简单，`openedAt` 也还能当历史记录看。
 * 2. **`qty` 恒为非负**，方向完全由 `positionSide` 决定。用负数表示空头的话，bigint
 *    运算里到处要判符号，迟早在某个分支漏掉。
 * 3. **`leverage` 是开仓时的快照**，不跟着 `account_symbol_settings` 变。否则用户改一下
 *    杠杆设置，已有仓位的强平价会被悄悄改掉。
 *
 * `pos_symbol_open_idx` 是部分索引，只索引 `qty > 0`。资金费结算（每 8 小时）和强平扫描
 * （每个价格 tick）都要按币对捞活跃仓位，这个索引直接决定那两条热路径的性能。
 */
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    positionSide: positionSideEnum("position_side").notNull(),
    marginMode: marginModeEnum("margin_mode").notNull(),
    leverage: integer("leverage").notNull(), // 开仓时锁定的杠杆倍数，后续调杠杆不影响已开的仓位
    qty: bigint("qty", { mode: "bigint" }).notNull().default(sql`0`), // 恒为非负，方向看 positionSide
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull().default(sql`0`), // 加权平均开仓价
    isolatedMargin: bigint("isolated_margin", { mode: "bigint" })
      .notNull()
      .default(sql`0`), // 仅逐仓模式下有意义
    openedAt: timestamp("opened_at", { withTimezone: true }), // 首次开仓时间，qty 归零后不清空，留作历史记录
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 一个账户在一个币对的同一个方向上只能有一条仓位记录（不管单向/双向模式）
    uniqueIndex("pos_acc_sym_side_uq").on(
      t.accountId,
      t.symbol,
      t.positionSide,
    ),
    // 部分索引：只索引活跃仓位（qty > 0）。资金费结算、强平扫描按币对高频捞取活跃仓位，靠它。
    index("pos_symbol_open_idx")
      .on(t.symbol)
      .where(sql`qty > 0`),
  ],
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
