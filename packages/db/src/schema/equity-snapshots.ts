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

/**
 * 每日权益快照 —— 排行榜和收益曲线的数据源。
 *
 * 每天 UTC 00:00 给每个账户拍一张照。之所以要单独存而不是实时算：
 * 排行榜要按收益率排序取前 100，实时算意味着每次都要遍历所有账户的所有仓位算未实现盈亏，
 * 而昨天的权益是不会再变的——算一次存下来就行。
 *
 * `equity` 和 `walletBalance` 都要存：前者含未实现盈亏（浮盈浮亏），后者不含。
 * 只存一个的话，"账面很好看但全是浮盈"和"已经落袋"这两种情况在曲线上就分不出来。
 *
 * `cumulativePnl` 和 `roi` 都是**自上次账户重置以来**的口径，不是开户以来——
 * 用户重置账户就是为了重新开始，排行榜得认这个。
 *
 * `equity_date_roi_idx` 直接服务排行榜那条查询：WHERE snap_date = today ORDER BY roi DESC。
 */
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
