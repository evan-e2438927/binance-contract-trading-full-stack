import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum } from "./enums";
import { symbols } from "./symbols";

/**
 * 每账户每币对的交易偏好 —— 杠杆倍数和全仓/逐仓。
 *
 * 币安的杠杆和保证金模式是"按币对记"的：你在 BTCUSDT 上开 20x 逐仓，不影响 ETHUSDT。
 * 下单时先查这张表拿到 leverage，再去 `leverage_brackets` 校验这个杠杆在当前名义价值
 * 那一层是否允许。
 *
 * 注意和 `positions.leverage` 的区别：这里存的是"下一笔单用多少倍"，`positions` 里存的是
 * "这个仓位开仓时锁定了多少倍"。改这里不会改已开仓位的强平价。
 *
 * 没有记录 = 用默认值（20x 全仓），所以不需要给每个账户预先插 20 行。
 */
export const accountSymbolSettings = pgTable(
  "account_symbol_settings",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    leverage: integer("leverage").notNull().default(20), // 这个账户在这个币对上的杠杆倍数
    marginMode: marginModeEnum("margin_mode").notNull().default("CROSS"), // 全仓/逐仓，默认全仓
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // 联合主键 (accountId, symbol)：每个账户每个币对最多一条设置，天然去重
  (t) => [primaryKey({ columns: [t.accountId, t.symbol] })],
);

export type AccountSymbolSetting = typeof accountSymbolSettings.$inferSelect;
export type NewAccountSymbolSetting = typeof accountSymbolSettings.$inferInsert;
