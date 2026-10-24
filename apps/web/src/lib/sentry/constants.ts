/** ResizeObserver 在浏览器里的两种良性告警文案（不影响功能，不值得上报） */
export const RESIZE_OBSERVER_LOOP_LIMIT_MESSAGE = "ResizeObserver loop limit exceeded";
export const RESIZE_OBSERVER_UNDELIVERED_MESSAGE = "ResizeObserver loop completed with undelivered notifications";

/** 浏览器扩展注入脚本的 URL 前缀，来自这些脚本的报错与本站代码无关，直接丢弃 */
export const CHROME_EXTENSION_PROTOCOL = "chrome-extension://";
export const MOZ_EXTENSION_PROTOCOL = "moz-extension://";
export const SAFARI_EXTENSION_PROTOCOL = "safari-extension://";

/** 渲染崩溃上报时附带的 Next digest 的 tag 名（用于和服务端日志对账） */
export const DIGEST_TAG_NAME = "digest";

/** 不收集默认 PII（IP、cookie 等）。@sentry/* v11 的类型里已没有该选项（被 dataCollection 取代），保留它只是兼容旧语义，真正起作用的是 DATA_COLLECTION_OFF */
export const SEND_DEFAULT_PII = false;

/**
 * 关掉 SDK 自动收集的用户信息、Cookie、请求头、请求/响应体、查询串。
 * v11 里这些项默认全开，只传 sendDefaultPii:false 不会生效，所以必须显式关。
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  // 空数组 = 请求/响应体一种都不收；never[] 可赋给 SDK 的联合类型数组
  httpBodies: [] as never[],
  urlQueryParams: false,
};

/** 不开启性能 tracing，只做错误监控 */
export const TRACES_SAMPLE_RATE = 0;
