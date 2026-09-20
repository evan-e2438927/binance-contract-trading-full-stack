import { AppError } from "@binance-contract-trading-full-stack/shared";

/**
 * 币安限流闸门（2026-09-20 加，起因见 `docs/design/07-binance-reference.md` 第 12 节）。
 *
 * 币安的限额是**按 IP 算的，不按 API Key，也不按你在进程里建了几个客户端**。
 * 所以"还能不能发请求"这件事，整个进程只能有一份答案——就是这里的 `pausedUntil`。
 *
 * 规则（`docs/vendor/binance/usds-futures.txt` Limits 一节）：
 * - HTTP 429 只是超限警告；**收到 429 之后继续发**才会被自动封 IP（418）
 * - 封禁时长按累犯递增，2 分钟到 3 天
 *
 * 所以被限流之后唯一正确的动作是**一个包都不发**，等够 `Retry-After`。
 * 这个闸门包在 fetch 外面：暂停期间直接抛 `SERVICE_UNAVAILABLE`，连 socket 都不建。
 *
 * ⚠️ 用法只有一条：**全进程共用一个实例**。每次调用都 `createRateLimitGate()` 的话，
 * `pausedUntil` 永远是 0，这个闸门就等于没装——2026-09-20 就是这么把自己封了三次，
 * 508 → 868 → 1244 秒越封越久。
 */

export interface RateLimitGate {
  /** 包过闸门的 fetch，签名和原生 fetch 一样，直接丢给任何接受 fetch 注入的地方 */
  fetch: typeof fetch;
  /** 还要暂停多久（毫秒）；0 表示现在可以发。给日志和健康检查用 */
  pausedForMs(): number;
}

export interface RateLimitGateOptions {
  fetch?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "error">;
  /** 响应没带 Retry-After 时暂停多久 */
  fallbackPauseMs?: number;
}

export function createRateLimitGate(options: RateLimitGateOptions = {}): RateLimitGate {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const fallbackPauseMs = options.fallbackPauseMs ?? 60_000;

  let pausedUntil = 0;

  const pausedForMs = () => Math.max(0, pausedUntil - now());

  const gated: typeof fetch = async (input, init) => {
    const waiting = pausedForMs();
    if (waiting > 0) {
      throw new AppError("SERVICE_UNAVAILABLE", `行情数据暂时拿不到，请稍后再试（被币安限流，还需 ${Math.ceil(waiting / 1000)} 秒）`);
    }
    const response = await fetchImpl(input, init);
    if (response.status === 429 || response.status === 418) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const pauseMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackPauseMs;
      pausedUntil = now() + pauseMs;
      logger.error(`[binance] 被币安限流（HTTP ${response.status}），全进程暂停 ${Math.round(pauseMs / 1000)} 秒`);
      throw new AppError("SERVICE_UNAVAILABLE", `行情数据暂时拿不到，请稍后再试（被币安限流，暂停 ${Math.round(pauseMs / 1000)} 秒）`);
    }
    return response;
  };

  return { fetch: gated, pausedForMs };
}
