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
    qty: bigint("qty", { mode: "bigint" }).notNull().default(0n), // 恒为非负，方向看 positionSide
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull().default(0n), // 加权平均开仓价
    isolatedMargin: bigint("isolated_margin", { mode: "bigint" })
      .notNull()
      .default(0n), // 仅逐仓模式下有意义
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
