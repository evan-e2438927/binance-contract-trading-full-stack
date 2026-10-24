import type { ErrorReporter } from "./sentry";

/**
 * 进程退出前冲刷 Sentry 缓冲。reporter 为 null（未启用）时什么都不做；
 * 冲刷抛错或超时都不阻塞退出（超时由 flush 自身的 timeoutMs 约束，外加一层兜底计时）。
 *
 * @example
 * await flushBeforeExit(reporter, 2000);
 * process.exit(0);
 */
export async function flushBeforeExit(reporter: Pick<ErrorReporter, "flush"> | null, timeoutMs: number): Promise<void> {
  if (!reporter) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reporter.flush(timeoutMs),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // 冲刷失败不阻塞退出
  } finally {
    if (timer) clearTimeout(timer);
  }
}
