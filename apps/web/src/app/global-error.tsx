"use client";

import { useEffect } from "react";

import { reportRenderError } from "@/lib/sentry/report-render-error";

/**
 * 根布局自己崩掉时的兜底（app/error.tsx 接不住这种）。
 * 它会替换整个 <html>，所以不能用全站的 Provider、组件和 token，只能写最朴素的样式。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 错误边界挂载（或 error 变化）时触发：打日志并把渲染崩溃报给 Sentry，便于排查线上白屏；无需清理
  useEffect(() => {
    console.error(error);
    reportRenderError(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#0b0e11",
          color: "#eaecef",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 600 }}>页面出错了</p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "#f0b90b",
            color: "#000",
            border: 0,
            borderRadius: 5,
            padding: "6px 14px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </body>
    </html>
  );
}
