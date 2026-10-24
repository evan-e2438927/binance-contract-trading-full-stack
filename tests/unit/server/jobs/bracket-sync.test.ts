import type { SyncReport } from "@binance-contract-trading-full-stack/db";
import { describe, expect, it } from "vitest";
import { nextRunAt, startBracketSyncJob } from "../../../../apps/server/src/jobs/bracket-sync";

describe("nextRunAt", () => {
  it("当天 00:05 之前 → 当天 00:05", () => {
    expect(nextRunAt(new Date("2026-09-16T00:04:59.999Z")).toISOString()).toBe("2026-09-16T00:05:00.000Z");
  });

  it("正好 00:05 → 明天 00:05（这一刻的那次已经在跑了）", () => {
    expect(nextRunAt(new Date("2026-09-16T00:05:00.000Z")).toISOString()).toBe("2026-09-17T00:05:00.000Z");
  });

  it("00:05 之后 → 明天 00:05，跨月跨年也对", () => {
    expect(nextRunAt(new Date("2026-09-16T13:00:00Z")).toISOString()).toBe("2026-09-17T00:05:00.000Z");
    expect(nextRunAt(new Date("2026-09-30T23:59:00Z")).toISOString()).toBe("2026-10-01T00:05:00.000Z");
    expect(nextRunAt(new Date("2026-12-31T08:00:00Z")).toISOString()).toBe("2027-01-01T00:05:00.000Z");
  });
});

function report(changedSymbols: string[] = []): SyncReport {
  return {
    dryRun: false,
    checked: ["BTCUSDT", "ETHUSDT"],
    changed: changedSymbols.map((symbol) => ({ symbol, changes: [], before: [], after: [] })),
  };
}

/** 把定时器换成手动触发，记下每次排期的延迟。 */
function manualTimer() {
  const scheduled: { fn: () => void; ms: number }[] = [];
  return {
    scheduled,
    setTimer: (fn: () => void, ms: number) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimer: () => {},
  };
}

const silent = { log: () => {}, error: () => {} };

describe("startBracketSyncJob", () => {
  it("启动时立即跑一次，然后排到下一个 UTC 00:05", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();

    expect(calls).toBe(1);
    expect(timer.scheduled).toHaveLength(1);
    expect(timer.scheduled[0]?.ms).toBe(12 * 60 * 60 * 1000 + 5 * 60 * 1000);
    job.stop();
  });

  it("定时器触发后再跑一次，并排好下一次", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-17T00:05:00Z"),
      ...timer,
    });
    await job.idle();

    timer.scheduled[0]?.fn();
    await job.idle();

    expect(calls).toBe(2);
    expect(timer.scheduled).toHaveLength(2);
    expect(timer.scheduled[1]?.ms).toBe(24 * 60 * 60 * 1000);
    job.stop();
  });

  it("上一次还没跑完：跳过，不并发跑两次", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: () => {
        calls += 1;
        return new Promise<SyncReport>((resolve) => {
          release = () => resolve(report());
        });
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });

    await job.runNow(); // 启动那次还挂着，这次应该直接跳过
    expect(calls).toBe(1);

    release();
    await job.idle();
    job.stop();
  });

  it("同步失败只记日志，不抛出，下一次照常排期", async () => {
    const errors: unknown[] = [];
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        throw new Error("binance down");
      },
      logger: { log: () => {}, error: (...args: unknown[]) => errors.push(args) },
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();

    expect(errors).toHaveLength(1);
    expect(timer.scheduled).toHaveLength(1);
    job.stop();
  });

  it("只有真的有变化才回调 onChanged", async () => {
    const seen: SyncReport[] = [];
    const reports = [report(), report(["BTCUSDT"])];
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => reports.shift() ?? report(),
      onChanged: (r) => {
        seen.push(r);
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();
    expect(seen).toHaveLength(0);

    timer.scheduled[0]?.fn();
    await job.idle();
    expect(seen.map((r) => r.changed.map((c) => c.symbol))).toEqual([["BTCUSDT"]]);
    job.stop();
  });

  it("stop 之后定时器触发也不再跑", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();
    job.stop();

    timer.scheduled[0]?.fn();
    await job.idle();
    expect(calls).toBe(1);
  });
});
