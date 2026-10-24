import { type SentryEventLike, scrubSentryEvent } from "@binance-contract-trading-full-stack/shared";

import {
  CHROME_EXTENSION_PROTOCOL,
  DATA_COLLECTION_OFF,
  MOZ_EXTENSION_PROTOCOL,
  RESIZE_OBSERVER_LOOP_LIMIT_MESSAGE,
  RESIZE_OBSERVER_UNDELIVERED_MESSAGE,
  SAFARI_EXTENSION_PROTOCOL,
  SEND_DEFAULT_PII,
  TRACES_SAMPLE_RATE,
} from "./constants";

/** buildSentryClientOptions 的入参 */
export interface SentryClientOptionsInput {
  /** Sentry DSN（非空，调用方已判断过） */
  dsn: string;
  /** 环境名，取 NODE_ENV */
  environment: string;
  /** 当前页面的 origin（如 https://trade.example.org），只放行本站脚本的报错 */
  origin: string;
}

/** 浏览器端 Sentry.init 选项（只声明用到的字段，避免在纯函数里 import @sentry/*） */
export interface BrowserOptionsLike {
  /** 上报地址 */
  dsn: string;
  /** 环境名 */
  environment: string;
  /** 是否收集默认 PII，恒为 false */
  sendDefaultPii: boolean;
  /** 关闭 SDK 自动收集的用户信息、Cookie、请求头、请求体、查询串（v11 取代 sendDefaultPii 的选项） */
  dataCollection: typeof DATA_COLLECTION_OFF;
  /** 性能采样率，恒为 0 */
  tracesSampleRate: number;
  /** 命中即忽略的错误文案 */
  ignoreErrors: string[];
  /** 只接收来自这些 origin 的脚本报错 */
  allowUrls: string[];
  /** 来自这些 URL 的报错直接丢弃（浏览器扩展） */
  denyUrls: RegExp[];
  /** 发送前脱敏；返回 null 表示丢弃 */
  beforeSend: <E extends SentryEventLike>(event: E) => E | null;
}

/**
 * 构造浏览器端 Sentry 初始化选项，纯函数便于单测。
 *
 * @description 不含 Replay 采样率，不开 tracing；beforeSend 统一走 scrubSentryEvent 脱敏。
 * @param input - dsn、环境名与当前站点 origin
 * @returns 可直接传给 Sentry.init 的选项
 * @example
 * buildSentryClientOptions({ dsn, environment: "production", origin: window.location.origin })
 */
export function buildSentryClientOptions(input: SentryClientOptionsInput): BrowserOptionsLike {
  return {
    dsn: input.dsn,
    environment: input.environment,
    sendDefaultPii: SEND_DEFAULT_PII,
    dataCollection: DATA_COLLECTION_OFF,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    ignoreErrors: [RESIZE_OBSERVER_LOOP_LIMIT_MESSAGE, RESIZE_OBSERVER_UNDELIVERED_MESSAGE],
    allowUrls: [input.origin],
    denyUrls: [CHROME_EXTENSION_PROTOCOL, MOZ_EXTENSION_PROTOCOL, SAFARI_EXTENSION_PROTOCOL].map(
      (protocol) => new RegExp(`^${protocol}`),
    ),
    beforeSend: scrubSentryEvent,
  };
}
