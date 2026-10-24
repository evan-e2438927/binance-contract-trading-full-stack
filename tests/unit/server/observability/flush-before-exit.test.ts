import { afterEach, describe, expect, it, vi } from "vitest";
import { flushBeforeExit } from "../../../../apps/server/src/observability/flush-before-exit";

afterEach(() => {
  vi.useRealTimers();
});

describe("flushBeforeExit", () => {
  it("AC-006 (happy-path): 已启用时以 2000 调用 flush，并等它完成", async () => {
    let done = false;
    const flush = vi.fn(async () => {
      done = true;
    });
    await flushBeforeExit({ flush }, 2000);
    expect(flush).toHaveBeenCalledWith(2000);
    expect(done).toBe(true);
  });

  it("AC-006 (boundary): reporter 为 null 时不做任何事", async () => {
    await expect(flushBeforeExit(null, 2000)).resolves.toBeUndefined();
  });

  it("AC-006 (error): flush 抛错时不阻塞退出", async () => {
    const flush = vi.fn(async () => {
      throw new Error("net");
    });
    await expect(flushBeforeExit({ flush }, 2000)).resolves.toBeUndefined();
  });

  it("AC-006 (boundary): flush 一直不返回时，超过 timeoutMs 后仍然返回", async () => {
    vi.useFakeTimers();
    const flush = vi.fn(() => new Promise<void>(() => {}));
    const pending = flushBeforeExit({ flush }, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeUndefined();
  });
});
