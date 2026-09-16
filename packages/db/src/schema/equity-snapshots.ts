import {
  bigint,
  date,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    snapDate: date("snap_date").notNull(), // UTC 日期，每天一条
    equity: bigint("equity", { mode: "bigint" }).notNull(), // 权益 = 钱包余额 + 所有仓位未实现盈亏
    walletBalance: bigint("wallet_balance", { mode: "bigint" }).notNull(), // 当天快照时刻的钱包余额
    cumulativePnl: bigint("cumulative_pnl", { mode: "bigint" }).notNull(), // 自上次账户重置以来的累计盈亏
    roi: bigint("roi", { mode: "bigint" }).notNull(), // 收益率，定标 1e8，排行榜按这个字段排序
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("equity_acc_date_uq").on(t.accountId, t.snapDate), // 每个账户每天最多一条快照
    index("equity_date_roi_idx").on(t.snapDate, t.roi.desc()), // 排行榜：WHERE snap_date=today ORDER BY roi DESC
  ],
);

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type NewEquitySnapshot = typeof equitySnapshots.$inferInsert;
