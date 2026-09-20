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
 * 1. **平仓后不删行**（留 `position_amt = 0`）。删了之后切持仓模式、查历史都要处理"不存在"的
 *    分支，留着更简单，`openedAt` 也还能当历史记录看。
 * 2. **`position_amt` 带符号，多头为正、空头为负**——按币安 `GET /fapi/v3/positionRisk` 的表示法
 *    （缺口 #12，第 11 讲迁移；以前叫 `qty`、恒为非负）。单向模式一个币对只有一行 BOTH，不带符号
 *    就分不清多空。引擎内部仍是 LONG / SHORT + 非负数量，两种表示法只在 server 的仓储层互转。
 * 3. **`leverage` 跟着杠杆设置走**：第 08 讲按币安，调杠杆时已有仓位的杠杆一起改（逐仓有仓位时不能调低）。
 *
 * `pos_symbol_open_idx` 是部分索引，只索引 `position_amt <> 0`（空头是负数，写成 `> 0` 空头就漏了）。资金费结算（每 8 小时）和强平扫描
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
    positionAmt: bigint("position_amt", { mode: "bigint" }).notNull().default(sql`0`), // 带符号：多头正、空头负（币安 positionAmt）
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull().default(sql`0`), // 加权平均开仓价
    isolatedMargin: bigint("isolated_margin", { mode: "bigint" })
      .notNull()
      .default(sql`0`), // 仅逐仓模式下有意义
    // 损益两平价的分子（币安 breakEvenPrice）：Σ开仓花的钱 + Σ手续费 − Σ平仓收回的钱。
    // 引擎每笔成交累加，仓位平完归零（见 packages/engine/src/types.ts 的 Position.costBasis）
    costBasis: bigint("cost_basis", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
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
    // 部分索引：只索引活跃仓位（position_amt <> 0）。资金费结算、强平扫描按币对高频捞取活跃仓位，靠它。
    index("pos_symbol_open_idx")
      .on(t.symbol)
      .where(sql`position_amt <> 0`),
  ],
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
