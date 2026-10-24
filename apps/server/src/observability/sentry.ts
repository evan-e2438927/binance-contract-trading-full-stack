import { scrubSentryEvent, type SentryEventLike } from "@binance-contract-trading-full-stack/shared";
import * as Sentry from "@sentry/node";

/** 上报时附带的请求上下文：只有方法和路径（路径不含查询串），不带 query / body / 头 */
export interface ReportContext {
  method: string;
  path: string;
}

/** 上报回调类型：createErrorHandler / AppDeps 共用 */
export type ReportErrorFn = (error: unknown, ctx: ReportContext) => void;

export interface ErrorReporter {
  /** 把意外错误报给 Sentry；内部吞掉一切异常，永不抛 */
  report: ReportErrorFn;
  /** 退出前冲刷缓冲的事件，最多等 timeoutMs 毫秒 */
  flush(timeoutMs: number): Promise<void>;
}

export interface InitSentryOptions {
  dsn?: string;
  environment: string;
  release?: string;
}

/** 不采集性能追踪 */
const TRACES_SAMPLE_RATE = 0;
const LEGACY_PII_OFF = { sendDefaultPii: false };
const DATA_COLLECTION_OFF: NonNullable<Sentry.NodeOptions["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
};
const TAG_METHOD = "method";
const TAG_PATH = "path";

/**
 * 初始化 Sentry 报错收集。没配 DSN（undefined 或空串）返回 null，且不调用 Sentry.init。
 * 事件经 scrubSentryEvent 脱敏后才发出；脱敏失败（返回 null）则丢弃事件。
 *
 * @example
 * const reporter = initSentry({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
 * reporter?.report(new Error("boom"), { method: "GET", path: "/x" });
 */
export function initSentry(opts: InitSentryOptions): ErrorReporter | null {
  if (!opts.dsn) return null;

  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // @sentry/node v11 的类型里已没有 sendDefaultPii（被 dataCollection 取代）。保留 AC-004 要求的显式 false，
    // 经展开传入以绕过类型检查；真正起作用的是下面的 dataCollection：全部关掉，SDK 自己不收用户/头/Cookie/查询串/请求体/局部变量
    ...LEGACY_PII_OFF,
    dataCollection: DATA_COLLECTION_OFF,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // 脱敏函数用结构类型，不依赖 @sentry/*；这里的 ErrorEvent 与其结构兼容
    beforeSend: (event) => scrubSentryEvent(event as unknown as SentryEventLike & typeof event),
  });

  return {
    report(error, ctx) {
      try {
        Sentry.captureException(error, { tags: { [TAG_METHOD]: ctx.method, [TAG_PATH]: ctx.path } });
      } catch {
        // 上报失败不能影响业务响应
      }
    },
    async flush(timeoutMs) {
      try {
        await Sentry.flush(timeoutMs);
      } catch {
        // 冲刷失败不阻塞退出
      }
    },
  };
}
