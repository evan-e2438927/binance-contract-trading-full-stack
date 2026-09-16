import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ⚠️ 练手表，和合约业务无关。
 *
 * 早前为了跑通 Next.js → Hono → Drizzle → Supabase 这条全栈链路留下的，
 * 见 `docs/books-tutorial.md`。不要照着它的风格建业务表，也不要往它上面加字段。
 */
export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("create_at", { withTimezone: true }),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;


