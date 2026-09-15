import { books } from "@binance-contract-trading-full-stack/db";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../services";

export const booksRoute = new Hono();

// GET /books —— 列表，最新的排前面
booksRoute.get("/", async (c) => {
  const db = getDb();
  const rows = await db.select().from(books).orderBy(desc(books.createdAt));
  return c.json(rows);
});

const createBookSchema = z.object({
  title: z.string().trim().min(1, "书名不能为空"),
  author: z.string().trim().min(1, "作者不能为空"),
});

// POST /books —— 新增一本
booksRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBookSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("；");
    return c.json({ error: message }, 400);
  }

  const db = getDb();
  const [row] = await db.insert(books).values(parsed.data).returning();
  return c.json(row, 201);
});