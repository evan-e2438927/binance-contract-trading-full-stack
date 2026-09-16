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

/**
 * 杠杆分层表 —— 强平价公式的输入，全库最不能出错的一张表。
 *
 * 币安的维持保证金率不是固定值，而是随仓位名义价值分层递增：仓位越大，要求的维持保证金
 * 率越高、允许的最大杠杆越低。维持保证金 = 名义价值 × mmr − cum，`cum`（速算额）是为了
 * 让相邻两层在边界上连续（否则名义价值刚跨过边界，维持保证金会阶跃）。
 *
 * ⚠️ 这张表的数值**必须人工从币安页面核对**，不能让 AI 生成。抄错一档不会让
 * `verify:brackets` 报错（它只查层内连续性和边界衔接，查不出整体抄错一档），
 * 但会让这个币对的所有强平价系统性偏移。
 *
 * 写入频率：季度级。币安调整分层表时人工更新 `seed/leverage-brackets.json` 再跑 seed。
 */
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
