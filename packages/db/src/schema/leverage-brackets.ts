import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { symbols } from "./symbols";

export const leverageBrackets = pgTable(
  "leverage_brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    bracket: integer("bracket").notNull(), // 层号，从 1 开始，层号越大杠杆上限越低
    notionalFloor: bigint("notional_floor", { mode: "bigint" }).notNull(), // 这一层的名义价值下限
    notionalCap: bigint("notional_cap", { mode: "bigint" }).notNull(), // 这一层的名义价值上限
    maxLeverage: integer("max_leverage").notNull(), // 这一层允许的最大杠杆倍数
    mmr: bigint("mmr", { mode: "bigint" }).notNull(), // 维持保证金率，定标 1e8，如 0.4% 存 400000n
    cum: bigint("cum", { mode: "bigint" }).notNull(), // 速算额，配合 mmr 算维持保证金：名义价值 × mmr − cum
  },
  (t) => [
    uniqueIndex("lb_symbol_bracket_uq").on(t.symbol, t.bracket),
    index("lb_symbol_cap_idx").on(t.symbol, t.notionalCap),
  ],
);

export type LeverageBracket = typeof leverageBrackets.$inferSelect;
export type NewLeverageBracket = typeof leverageBrackets.$inferInsert;
