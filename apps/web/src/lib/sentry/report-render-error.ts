import * as Sentry from "@sentry/nextjs";

import { DIGEST_TAG_NAME } from "./constants";

/**
 * 把渲染崩溃上报给 Sentry，便于排查线上白屏。
 *
 * @description 内部 try/catch，上报失败只打 warn，绝不影响兜底 UI。只传 error 与 digest tag。
 * @param error - 错误边界收到的错误，digest 为 Next 生成的服务端错误摘要（可能缺失）
 */
export function reportRenderError(error: Error & { digest?: string }): void {
  try {
    const { digest } = error;
    Sentry.captureException(error, digest ? { tags: { [DIGEST_TAG_NAME]: digest } } : undefined);
  } catch (reportFailure) {
    console.warn("[sentry] reportRenderError failed", reportFailure);
  }
}
