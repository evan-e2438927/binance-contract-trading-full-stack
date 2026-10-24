import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN } from "@/lib/config/env";
import { buildSentryClientOptions } from "@/lib/sentry/client-options";

// 浏览器端错误监控入口：未配置 DSN（本地开发默认）时完全不初始化
if (SENTRY_DSN) {
  Sentry.init(
    buildSentryClientOptions({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV,
      origin: window.location.origin,
    }),
  );
}
