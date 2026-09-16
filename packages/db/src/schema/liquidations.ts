import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum, positionSideEnum } from "./enums";

/**
 * 强平记录 —— 低频，但每一条都可能被用户拿来质问。
 *
 * 当保证金余额跌破维持保证金要求，仓位被系统按标记价强制平掉，写一条这里。
 * 强平是用户体验里最刺痛的事，也是最容易被质疑"你们是不是算错了"的地方。
 *
 * 所以 `marginBalanceBefore` 和 `maintMarginAt` 这两个取证字段**不要省**：它们记下触发那
 * 一刻"我有多少钱"和"系统要求多少钱"，两个数摆出来，强平的合理性当场就说清楚了。
 * 事后想补算是补不出来的——标记价、仓位、余额全都已经变了。
 *
 * 注意强平用的是**标记价**而不是最新成交价：最新价容易被一根插针带走，用标记价才不会
 * 因为一瞬间的异常报价把用户平掉。
 *
 * 强平同样要走 `ledger_entries`（LIQUIDATION + LIQUIDATION_FEE 两类），这张表是明细，
 * 不是账目本身。
 */
export const liquidations = pgTable(
  "liquidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    marginMode: marginModeEnum("margin_mode").notNull(), // 被强平时这个仓位是全仓还是逐仓
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 被强平的数量
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull(), // 被强平仓位的开仓均价
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(), // 触发强平那一刻的标记价，强平按这个价格平仓
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(), // 强平这笔带来的已实现盈亏（通常是负的）
    liquidationFee: bigint("liquidation_fee", { mode: "bigint" }).notNull(), // 强平清算费，比普通手续费高
    // 下面两个是取证字段：用户质疑"我不该被强平"时，把这两个数摆出来就能说清楚，别省。
    marginBalanceBefore: bigint("margin_balance_before", { mode: "bigint" }).notNull(), // 强平前一刻的保证金余额
    maintMarginAt: bigint("maint_margin_at", { mode: "bigint" }).notNull(), // 强平前一刻算出的维持保证金要求
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("liq_acc_created_idx").on(t.accountId, t.createdAt.desc())],
);

export type Liquidation = typeof liquidations.$inferSelect;
export type NewLiquidation = typeof liquidations.$inferInsert;