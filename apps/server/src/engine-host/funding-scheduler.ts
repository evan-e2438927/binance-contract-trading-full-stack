import type { EngineInput } from "@binance-contract-trading-full-stack/engine";
import type { MarkPriceEvent } from "../market/parse";

/**
 * 资金费结算排期（04-backend-design.md 第 9 节）。
 *
 * 不用定时器，由标记价推送驱动：每条 markPrice@1s 推送带着"下次结算时间 T"（字段 `T`）。
 * 当收到的推送里 T 变大了、而且推送时间已经过了旧的 T，说明旧的 T 刚结算过——就用
 * **旧 T 之前收到的最后一条推送**里的费率和标记价，结算旧 T。
 *
 * 好处：
 * - 结算时间来自币安，不自己算本地整点；币安调整结算间隔（按币对设置，默认 8 小时）自动跟上
 * - 进程重启不需要恢复任何定时器状态
 * - 可测：喂几条假推送就能断言
 *
 * 诚实处理两种情况：
 * - 旧 T 之前的最后一条推送离 T 超过 freshnessMs（默认 10 秒，行情断过）：**不结算**，记日志。
 *   拿不准结算时刻的费率和标记价，就不编（失真点 #7 同一原则）。币安 FAQ 说实际扣费时间本身有 15 秒左右的误差
 * - 同一个 (币对, T) 只结算一次；进程重启后万一又结算同一个 T，数据库 funding_payments 的唯一索引会挡住，
 *   宿主回滚内存（第 11 讲）
 *
 * 近似：结算用的是 T 之前最后一条推送（最多早 1 秒）的费率和标记价，不是币安结算那一刻的精确值（缺口 #33）。
 */

export interface FundingSchedulerOptions {
  submit: (input: Extract<EngineInput, { t: "settleFunding" }>) => void;
  freshnessMs?: number;
  logger?: Pick<Console, "log" | "error">;
}

export interface FundingScheduler {
  onMarkPrice(event: MarkPriceEvent): void;
}

export function createFundingScheduler(options: FundingSchedulerOptions): FundingScheduler {
  const freshnessMs = options.freshnessMs ?? 10_000;
  const logger = options.logger ?? console;
  const last = new Map<string, MarkPriceEvent>();
  const settled = new Set<string>();

  return {
    onMarkPrice(event) {
      const prev = last.get(event.symbol);
      last.set(event.symbol, event);
      if (!prev) return;

      const due = prev.nextFundingTs;
      if (event.nextFundingTs <= due || event.ts < due) return; // 还没到旧的结算时间

      const key = `${event.symbol}:${due}`;
      if (settled.has(key)) return;
      settled.add(key);

      if (due - prev.ts > freshnessMs) {
        logger.error(
          `[funding] ${event.symbol} ${new Date(due).toISOString()} 结算前最后一条标记价是 ${due - prev.ts}ms 之前的，不可信，跳过这次结算`,
        );
        return;
      }
      options.submit({ t: "settleFunding", symbol: event.symbol, rate: prev.fundingRate, markPrice: prev.markPrice, ts: due });
    },
  };
}
