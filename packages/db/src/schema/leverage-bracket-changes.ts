import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BracketRow } from "../brackets/types";
import { symbols } from "./symbols";

/**
 * 杠杆分层表变更记录 —— 每日同步发现币安调了表，就在这里留一份前后整表快照。
 *
 * 分层表不再进版本库（数据直接从官方签名接口同步进 `leverage_brackets`），git 历史
 * 追溯不到"币安哪天调了什么"，这张表补上这一环：排查"为什么这个仓位的强平价昨天
 * 和今天不一样"时，先来这里看那段时间分层表有没有变。
 *
 * 存整表快照而不是逐字段差异：想知道"当时的表长什么样"可以直接取，差异随时能用
 * `diffBrackets(before, after)` 重新算。数值是十进制字符串（bigint 不进 JSON）。
 *
 * 只追加，不更新不删除。同步时没有变化就不写。
 */
export const leverageBracketChanges = pgTable(
  "leverage_bracket_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    before: jsonb("before").$type<BracketRow[]>().notNull(), // 变更前整表；首次导入为 []
    after: jsonb("after").$type<BracketRow[]>().notNull(), // 变更后整表
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lbc_symbol_changed_idx").on(t.symbol, t.changedAt.desc())],
);

export type LeverageBracketChange = typeof leverageBracketChanges.$inferSelect;
export type NewLeverageBracketChange = typeof leverageBracketChanges.$inferInsert;
