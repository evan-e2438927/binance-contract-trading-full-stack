import { equitySnapshots, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { AppError } from "@binance-contract-trading-full-stack/shared";
import { max, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { verifyToken } from "../auth/tokens";
import { toDecimal } from "../http/decimal";
import { ok, parseQuery } from "../http/respond";

/**
 * 排行榜（04-backend-design.md 第 11 节"排行榜"），不需要登录；带 token 时额外返回 myRank。
 *
 * 口径（用户 2026-09-17 定，设计文档只有字段名）：
 * - 数据截至最近一次权益快照（UTC 00:00，`asOf`）。某天没拍到快照（错过就跳过）就用更早的那天
 * - **all**：快照里的 ROI = (权益 − 10,000) ÷ 10,000，从上次重置算起
 * - **daily / weekly**：(本期快照权益 − 期初快照权益) ÷ 期初快照权益，期初 = asOf 往前 1 / 7 天。
 *   两天都要有快照；**这段时间里重置过的账户不上榜**（重置把权益拉回 10,000，算出来的收益没有意义）
 * - **至少有过一笔成交才上榜**：不然一大片 0% 并列
 * - 胜率 = 统计期内已实现盈亏 > 0 的平仓成交 ÷ 平仓成交；成交次数 = 统计期内全部成交笔数。
 *   统计期：daily / weekly 是期初到 asOf；all 是上次重置到 asOf。
 *   "平仓成交" 按 realized_pnl ≠ 0 或强平成交认（fills 表没有单独的开平标记；已实现盈亏恰好为 0 的平仓不计入，缺口 #45）
 * - 名次用 RANK()：收益率相同名次相同
 */

const PERIOD_DAYS = { daily: 1, weekly: 7 } as const;

export function createLeaderboardRoutes(deps: { db: DbExecutor; jwtSecret: string }, middleware: { rateLimit: MiddlewareHandler }) {
  const routes = new Hono();
  routes.use("*", middleware.rateLimit);

  routes.get("/", async (c) => {
    const query = parseQuery(
      c,
      z.object({
        period: z.enum(["daily", "weekly", "all"], { error: "period 只能是 daily / weekly / all" }).default("all"),
        limit: z.coerce.number({ error: "limit 必须是整数" }).int("limit 必须是整数").min(1, "limit 最小 1").max(100, "limit 最大 100").default(100),
      }),
    );
    // 带了 token 就必须是有效的：不静默当成没登录
    const header = c.req.header("Authorization");
    let me: string | null = null;
    if (header) {
      const match = header.match(/^Bearer (.+)$/);
      if (!match) throw new AppError("UNAUTHORIZED", "登录状态无效，请重新登录");
      me = await verifyToken(match[1]!, deps.jwtSecret);
    }

    const [latest] = await deps.db.select({ date: max(equitySnapshots.snapDate) }).from(equitySnapshots);
    const asOf = latest?.date ?? null;
    if (!asOf) return ok(c, { period: query.period, asOf: null, since: null, items: [], myRank: null });

    const end = new Date(`${asOf}T00:00:00Z`);
    const since = query.period === "all" ? null : new Date(end.getTime() - PERIOD_DAYS[query.period] * 86_400_000).toISOString().slice(0, 10);
    const start = since ? new Date(`${since}T00:00:00Z`) : null;

    const base =
      since === null
        ? sql`
          SELECT a.id, a.nickname, cur.equity, cur.roi,
                 COALESCE((SELECT max(l.created_at) FROM ledger_entries l WHERE l.account_id = a.id AND l.type = 'RESET' AND l.created_at <= ${end}), '-infinity'::timestamptz) AS window_start
          FROM equity_snapshots cur
          JOIN accounts a ON a.id = cur.account_id
          WHERE cur.snap_date = ${asOf}`
        : sql`
          SELECT a.id, a.nickname, cur.equity,
                 round((cur.equity - prev.equity)::numeric * 100000000 / prev.equity)::bigint AS roi,
                 ${start}::timestamptz AS window_start
          FROM equity_snapshots cur
          JOIN equity_snapshots prev ON prev.account_id = cur.account_id AND prev.snap_date = ${since}
          JOIN accounts a ON a.id = cur.account_id
          WHERE cur.snap_date = ${asOf}
            AND prev.equity > 0
            AND NOT EXISTS (
              SELECT 1 FROM ledger_entries l
              WHERE l.account_id = a.id AND l.type = 'RESET' AND l.created_at > ${start} AND l.created_at <= ${end}
            )`;

    const result = await deps.db.execute(sql`
      WITH base AS (${base}),
      eligible AS (
        SELECT b.* FROM base b WHERE EXISTS (SELECT 1 FROM fills f WHERE f.account_id = b.id)
      ),
      stats AS (
        SELECT e.id,
               count(f.id) AS trade_count,
               count(f.id) FILTER (WHERE f.realized_pnl <> 0 OR f.is_liquidation) AS close_count,
               count(f.id) FILTER (WHERE f.realized_pnl > 0) AS win_count
        FROM eligible e
        LEFT JOIN fills f ON f.account_id = e.id AND f.created_at > e.window_start AND f.created_at <= ${end}
        GROUP BY e.id
      ),
      ranked AS (
        SELECT e.id, e.nickname, e.equity, e.roi, s.trade_count, s.close_count, s.win_count,
               rank() OVER (ORDER BY e.roi DESC) AS rank
        FROM eligible e JOIN stats s ON s.id = e.id
      )
      SELECT * FROM ranked
      WHERE rank <= ${query.limit} OR id = ${me}
      ORDER BY rank, id
    `);

    type Row = { id: string; nickname: string | null; equity: string; roi: string; trade_count: string; close_count: string; win_count: string; rank: string };
    const toItem = (r: Row) => {
      const closes = BigInt(r.close_count);
      return {
        rank: Number(r.rank),
        nickname: r.nickname,
        roi: toDecimal(BigInt(r.roi)),
        equity: toDecimal(BigInt(r.equity)),
        // 定标 1e8 的比例，四舍五入到 8 位；没有平仓成交时胜率为 null（不是 0%）
        winRate: closes === 0n ? null : toDecimal((BigInt(r.win_count) * 100_000_000n * 2n + closes) / (closes * 2n)),
        tradeCount: Number(r.trade_count),
      };
    };
    const rows = result.rows as Row[];
    const mine = me ? rows.find((r) => r.id === me) : undefined;
    return ok(c, {
      period: query.period,
      asOf,
      since,
      items: rows.filter((r) => Number(r.rank) <= query.limit).slice(0, query.limit).map(toItem),
      myRank: mine ? toItem(mine) : null,
    });
  });

  return routes;
}
