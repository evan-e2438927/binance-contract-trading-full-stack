import { AppError } from "@binance-contract-trading-full-stack/shared";
import type { Context, MiddlewareHandler } from "hono";

/**
 * 限流（04-backend-design.md 第 11 节"通用约定"）：
 *
 * | 范围 | 限制 |
 * | --- | --- |
 * | 公共接口（按 IP） | 60 次 / 分钟 |
 * | 私有查询（按账户） | 120 次 / 分钟 |
 * | 下单 / 撤单（按账户） | 20 次 / 10 秒 |
 *
 * 固定窗口计数，存在进程内存里——服务端是单进程（引擎也只有一份），不需要 Redis。
 * 窗口到期的计数器在下次访问时顺手清掉，另外每满 1,000 个键扫一遍过期的，防止 IP 越攒越多。
 */

export interface RateLimitOptions {
  name: string;
  limit: number;
  windowMs: number;
  /** 按什么计数：IP、账户 id。返回 null = 不限（比如拿不到 IP） */
  key: (c: Context) => string | null;
  now?: () => number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();

  return async (c, next) => {
    const key = options.key(c);
    if (key === null) return next();
    const t = now();
    let window = windows.get(key);
    if (!window || t - window.startedAt >= options.windowMs) {
      window = { startedAt: t, count: 0 };
      windows.set(key, window);
      if (windows.size % 1000 === 0) {
        for (const [k, w] of windows) if (t - w.startedAt >= options.windowMs) windows.delete(k);
      }
    }
    window.count++;
    if (window.count > options.limit) {
      const retryAfterSeconds = Math.ceil((window.startedAt + options.windowMs - t) / 1000);
      c.header("Retry-After", String(retryAfterSeconds));
      throw new AppError("RATE_LIMITED", `请求太频繁，请 ${retryAfterSeconds} 秒后再试`);
    }
    await next();
  };
}
