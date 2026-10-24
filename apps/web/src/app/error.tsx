"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import Link from "next/link";
import { useEffect } from "react";

import { reportRenderError } from "@/lib/sentry/report-render-error";

/**
 * G-11 全局错误边界（M01）：页面渲染崩了显示兜底页，不白屏。
 * 这里不显示错误堆栈——对用户没用，而且可能带上接口返回的内容。
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 错误边界挂载（或 error 变化）时触发：打日志并把渲染崩溃报给 Sentry，便于排查线上白屏；无需清理
  useEffect(() => {
    console.error(error);
    reportRenderError(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-semibold text-[16px] text-foreground">页面出错了</p>
      <p className="max-w-md text-[13px] text-muted-foreground">
        这一页没能正常显示。行情和账户数据都在服务端，刷新一下通常就好了。
      </p>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={reset}>
          重试
        </Button>
        <Link href="/" className="text-[13px] text-muted-foreground hover:text-foreground">
          返回首页
        </Link>
      </div>
    </div>
  );
}
