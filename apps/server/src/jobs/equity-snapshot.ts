import { equitySnapshots, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { divRound } from "@binance-contract-trading-full-stack/shared";
import type { EngineHost } from "../engine-host/engine-host";
import { INITIAL_WALLET_BALANCE } from "../engine-host/register-account";

/**
 * 每日权益快照（缺口 #34，第 13b 讲）：每天 UTC 00:00 给每个账户记一条，排行榜和权益曲线用。
 *
 * 用户 2026-09-17 定的规则：
 * - **错过就跳过，不补拍**：定时器触发时离 00:00 已经超过 60 秒（进程没在跑、机器休眠）就不拍这一天。
 *   补拍的权益不是 00:00 那一刻的，拿去排名不诚实——和行情断线暂停撮合、恢复后不补算同一个态度
 * - 收益率从上次重置算起：累计盈亏 = 权益 − 10,000（开户和重置都把钱包设为 10,000），ROI = 累计盈亏 ÷ 10,000
 *
 * 单个账户拍不了就跳过它并记日志，不拿假数凑：
 * - 缺标记价（比如已下架币对上的旧仓位）：权益算不出来
 * - 仓位所在币对行情没就绪：引擎里的标记价是断线前的旧值
 *
 * 所有账户的视图在引擎队列里一次读完（同一时刻的状态），再写库。同一天重复拍（比如手动触发两次）不覆盖已有的那条。
 */

export const SNAPSHOT_TOLERANCE_MS = 60_000;

/** 严格晚于 now 的下一个 UTC 00:00 */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** UTC 日期字符串 YYYY-MM-DD */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface SnapshotReport {
  snapDate: string;
  written: number;
  skipped: { accountId: string; reason: string }[];
}

export async function takeEquitySnapshot(options: {
  db: DbExecutor;
  host: EngineHost;
  isSymbolReady: (symbol: string) => boolean;
  /** 快照对应的时刻（当天 UTC 00:00），决定 snap_date */
  at: number;
}): Promise<SnapshotReport> {
  const { db, host, isSymbolReady, at } = options;
  const snapDate = utcDate(at);
  const accounts = await host.read((engine) =>
    engine.allAccountViews().map((view) => ({ view, symbols: [...new Set(engine.positionViews(view.accountId).map((p) => p.symbol))] })),
  );

  const skipped: SnapshotReport["skipped"] = [];
  const rows = [];
  for (const { view, symbols } of accounts) {
    if (view.marginBalance === null) {
      skipped.push({ accountId: view.accountId, reason: `缺少 ${view.missingMarkPrices.join(", ")} 的标记价` });
      continue;
    }
    const notReady = symbols.filter((s) => !isSymbolReady(s));
    if (notReady.length > 0) {
      skipped.push({ accountId: view.accountId, reason: `${notReady.join(", ")} 行情未就绪` });
      continue;
    }
    const cumulativePnl = view.marginBalance - INITIAL_WALLET_BALANCE;
    rows.push({
      accountId: view.accountId,
      snapDate,
      equity: view.marginBalance,
      walletBalance: view.walletBalance,
      cumulativePnl,
      roi: divRound(cumulativePnl, INITIAL_WALLET_BALANCE),
      createdAt: new Date(at),
    });
  }
  if (rows.length > 0) {
    await db.insert(equitySnapshots).values(rows).onConflictDoNothing({ target: [equitySnapshots.accountId, equitySnapshots.snapDate] });
  }
  return { snapDate, written: rows.length, skipped };
}

export interface EquitySnapshotJobOptions {
  take: (at: number) => Promise<SnapshotReport>;
  logger?: Pick<Console, "log" | "error">;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 定时器链：每次触发后按当前时间重新算下一个 00:00（和分层表同步任务同一个写法，休眠 / 时钟跳变后自己对齐） */
export function startEquitySnapshotJob(options: EquitySnapshotJobOptions): { stop(): void; idle(): Promise<void> } {
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let timer: unknown = null;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  function schedule(): void {
    if (stopped) return;
    const target = nextUtcMidnight(now());
    timer = setTimer(() => {
      running = fire(target).finally(schedule);
    }, target - now());
  }

  async function fire(target: number): Promise<void> {
    const late = now() - target;
    if (late > SNAPSHOT_TOLERANCE_MS) {
      logger.error(`[equity-snapshot] 触发时已经过了 ${utcDate(target)} 00:00 ${Math.round(late / 1000)} 秒，跳过这一天（不补拍）`);
      return;
    }
    try {
      const report = await options.take(target);
      logger.log(`[equity-snapshot] ${report.snapDate}：写入 ${report.written} 个账户，跳过 ${report.skipped.length} 个`);
      for (const s of report.skipped) logger.log(`[equity-snapshot] 跳过 ${s.accountId}：${s.reason}`);
    } catch (error) {
      logger.error(`[equity-snapshot] ${utcDate(target)} 快照失败，这一天没有快照`, error);
    }
  }

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
    idle: () => running,
  };
}

