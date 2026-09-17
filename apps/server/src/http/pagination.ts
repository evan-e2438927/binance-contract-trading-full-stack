import type { DbExecutor } from "@binance-contract-trading-full-stack/db";
import { AppError } from "@binance-contract-trading-full-stack/shared";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * 游标分页（04-backend-design.md 第 11 节）：`?limit=50&cursor=<上一页最后一条的 id>` →
 * `{ items, nextCursor }`，nextCursor 为 null 表示没有下一页。
 *
 * 为什么不用 offset：流水和成交会一直增长，offset 要先数过前面所有行（越翻越慢），
 * 而且翻页期间有新记录插进来，offset 会错位——同一条出现两次或者漏一条。
 *
 * 排序键是 (时间 desc, id desc)：时间可能相同（一次 apply 的所有事件同一个 ts），只按时间排会在同一时刻的记录之间乱序、翻页漏行，
 * 加上 id 才是全序。下一页条件：(时间, id) < (游标那条的时间, 游标 id)。
 */

export const pageQuery = {
  limit: z.coerce.number({ error: "limit 必须是整数" }).int("limit 必须是整数").min(1, "limit 最小 1").max(100, "limit 最大 100").default(50),
  cursor: z.uuid({ error: "cursor 格式不对" }).optional(),
};

export interface PageOptions {
  db: DbExecutor;
  table: PgTable;
  idColumn: PgColumn;
  timeColumn: PgColumn;
  accountColumn: PgColumn;
  accountId: string;
  filters?: (SQL | undefined)[];
  limit: number;
  cursor?: string;
}

export async function paginate<Row extends { id: string }>(options: PageOptions): Promise<{ items: Row[]; nextCursor: string | null }> {
  const { db, table, idColumn, timeColumn, accountColumn, accountId } = options;
  const conditions: (SQL | undefined)[] = [eq(accountColumn, accountId), ...(options.filters ?? [])];

  if (options.cursor) {
    // 游标只认自己账户的记录：拿别人的 id 当游标，不能借此探测别人的数据存不存在
    const [anchor] = await db
      .select({ time: timeColumn })
      .from(table)
      .where(and(eq(idColumn, options.cursor), eq(accountColumn, accountId)));
    if (!anchor) throw new AppError("INVALID_PARAMS", "cursor 无效，请从第一页重新查询");
    conditions.push(or(lt(timeColumn, anchor.time), and(eq(timeColumn, anchor.time), lt(idColumn, options.cursor))));
  }

  const rows = (await db
    .select()
    .from(table)
    .where(and(...conditions))
    .orderBy(desc(timeColumn), desc(idColumn))
    .limit(options.limit + 1)) as Row[];
  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
