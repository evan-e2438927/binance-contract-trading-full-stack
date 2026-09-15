import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("create_at", { withTimezone: true }),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;


