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
