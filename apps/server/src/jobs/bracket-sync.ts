import { describeBracketChange, type SyncReport } from "@binance-contract-trading-full-stack/db";

const RUN_AT_UTC_HOUR = 0;
const RUN_AT_UTC_MINUTE = 5;

/**
 * 下一次同步时刻：严格晚于 now 的最近一个 UTC 00:05。
 *
 * 选 00:05 而不是整点：币安调表公告通常按 UTC 日期生效，错开整点几分钟，
 * 也避开同一时刻的资金费结算等其它整点任务。
 */
export function nextRunAt(now: Date): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_AT_UTC_HOUR, RUN_AT_UTC_MINUTE),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export interface BracketSyncJobOptions {
  /** 跑一次同步。server 里是 syncLeverageBrackets，测试里是假的。 */
  run: () => Promise<SyncReport>;
  /** 分层表真的变了才调用。引擎宿主接入后在这里热加载分层表。 */
  onChanged?: (report: SyncReport) => void | Promise<void>;
  logger?: Pick<Console, "log" | "error">;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface BracketSyncJob {
  /** 立刻跑一次；上一次还没结束就跳过。 */
  runNow(): Promise<void>;
  /** 等当前这次（如果有）跑完，测试用。 */
  idle(): Promise<void>;
  stop(): void;
}

/**
 * 分层表每日同步任务：启动时跑一次，之后每天 UTC 00:05 跑一次。
 *
 * - 用 setTimeout 链而不是 setInterval：每次跑完按当前时间重新算下一次，进程重启、
 *   机器休眠后都能自己对齐回 00:05，不依赖任何持久化的定时器状态。
 * - 失败只记日志：同步失败时库里保留旧表，服务照常运行，第二天再试。
 */
export function startBracketSyncJob(options: BracketSyncJobOptions): BracketSyncJob {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  let current: Promise<void> | null = null;
  /** 最近一轮"执行 + 排下一次"，idle() 等它。 */
  let cycle: Promise<void> = Promise.resolve();
  let timer: unknown = null;
  let stopped = false;

  async function execute(): Promise<void> {
    try {
      const report = await options.run();
      logger.log(
        `[bracket-sync] 检查 ${report.checked.length} 个开放币对，${report.changed.length} 个有变化`,
      );
      if (report.changed.length === 0) return;

      for (const { symbol, changes } of report.changed) {
        logger.log(`[bracket-sync] ${symbol}：${changes.map(describeBracketChange).join("；")}`);
      }
      await options.onChanged?.(report);
    } catch (err) {
      logger.error("[bracket-sync] 同步失败，库里保留旧分层表：", err);
    }
  }

  function runNow(): Promise<void> {
    if (current) {
      logger.log("[bracket-sync] 上一次同步还没结束，跳过本次");
      return Promise.resolve();
    }
    current = execute().finally(() => {
      current = null;
    });
    return current;
  }

  function schedule(): void {
    if (stopped) return;
    const at = now();
    const delayMs = nextRunAt(at).getTime() - at.getTime();
    timer = setTimer(() => {
      if (stopped) return;
      cycle = runNow().then(schedule);
    }, delayMs);
  }

  cycle = runNow().then(schedule);

  return {
    runNow,
    idle: () => cycle,
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
  };
}
