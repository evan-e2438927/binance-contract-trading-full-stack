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
 * 数据来自币安官方签名接口 `GET /fapi/v1/leverageBracket`（只读 API Key，仅在服务端使用），
 * 由 `brackets/sync.ts` 同步：server 每天 UTC 00:05 自动跑，也可以手动 `sync:brackets`。
 * **不允许手写或让 AI 生成这里的数字**——抄错一档不会破坏连续性，却会让这个币对的所有
 * 强平价系统性偏移。写库前后各校验一次，随时可以 `verify:brackets` 核对库里和官方是否一致。
 *
 * 写入频率：每日同步，币安没调表就不写。每次变化在 `leverage_bracket_changes` 留前后快照。
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
