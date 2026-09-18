import { describe, expect, it, vi } from "vitest";
import { nextUtcMidnight, startEquitySnapshotJob, utcDate, type SnapshotReport } from "./equity-snapshot";

const quiet = { log: () => {}, error: () => {} };

function fakeTimers(startMs: number) {
  const clock = { t: startMs };
  const timers: { fn: () => void; at: number }[] = [];
  return {
    clock,
    setTimer: (fn: () => void, ms: number) => timers.push({ fn, at: clock.t + ms }),
    clearTimer: () => {},
    /** 把时钟拨到下一个定时器的时刻（再加 lateMs），触发它 */
    fireNext(lateMs = 0) {
      const next = timers.shift()!;
      clock.t = next.at + lateMs;
      next.fn();
      return next.at;
    },
    pending: () => timers.length,
  };
}

describe("每日权益快照任务", () => {
  it("下一个 UTC 00:00：严格晚于现在；日期按 UTC", () => {
    expect(new Date(nextUtcMidnight(Date.parse("2026-09-17T23:59:59Z"))).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(new Date(nextUtcMidnight(Date.parse("2026-09-18T00:00:00Z"))).toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(utcDate(Date.parse("2026-12-31T23:30:00-02:00"))).toBe("2027-01-01");
  });

  it("按时触发就拍，快照时刻是 00:00 本身（不是触发的那一刻）；拍完排下一天", async () => {
    const t = fakeTimers(Date.parse("2026-09-17T20:00:00Z"));
    const take = vi.fn(async (at: number): Promise<SnapshotReport> => ({ snapDate: utcDate(at), written: 3, skipped: [] }));
    const job = startEquitySnapshotJob({ take, logger: quiet, now: () => t.clock.t, setTimer: t.setTimer, clearTimer: t.clearTimer });
    const target = t.fireNext(800); // 定时器晚了 0.8 秒
    await job.idle();
    expect(take).toHaveBeenCalledWith(Date.parse("2026-09-18T00:00:00Z"));
    expect(target).toBe(Date.parse("2026-09-18T00:00:00Z"));
    expect(t.pending()).toBe(1);
    job.stop();
  });

  it("★ 错过 00:00 超过 60 秒（机器休眠、进程卡住）：跳过这一天，不补拍；照常排下一天", async () => {
    const t = fakeTimers(Date.parse("2026-09-17T20:00:00Z"));
    const take = vi.fn(async (at: number): Promise<SnapshotReport> => ({ snapDate: utcDate(at), written: 0, skipped: [] }));
    const errors: string[] = [];
    const job = startEquitySnapshotJob({ take, logger: { log: () => {}, error: (m: string) => errors.push(m) }, now: () => t.clock.t, setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.fireNext(60_001);
    await job.idle();
    expect(take).not.toHaveBeenCalled();
    expect(errors[0]).toContain("跳过这一天");
    expect(t.pending()).toBe(1);
    t.fireNext(60_000); // 第二天恰好 60 秒：还算按时
    await job.idle();
    expect(take).toHaveBeenCalledWith(Date.parse("2026-09-19T00:00:00Z"));
    job.stop();
  });

  it("拍快照失败只记日志，不影响排下一天", async () => {
    const t = fakeTimers(Date.parse("2026-09-17T20:00:00Z"));
    const take = vi.fn(async (): Promise<SnapshotReport> => {
      throw new Error("数据库挂了");
    });
    const job = startEquitySnapshotJob({ take, logger: quiet, now: () => t.clock.t, setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.fireNext();
    await job.idle();
    expect(t.pending()).toBe(1);
    job.stop();
  });
});
