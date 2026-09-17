import { AppError, ERROR_HTTP_STATUS } from "@binance-contract-trading-full-stack/shared";
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/**
 * 统一响应包络（04-backend-design.md 第 11 节"通用约定"）：
 *
 *     { "ok": true,  "data": { ... } }
 *     { "ok": false, "error": { "code": "NONCE_INVALID", "message": "给用户直接看的中文" } }
 *
 * 第 12 讲只放鉴权用得到的最小一套；第 13 讲在这上面补 bigint 序列化边界、限流、分页。
 */

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true as const, data }, status);
}

/** 请求体按 zod schema 校验，不合法抛 INVALID_PARAMS（message 取 schema 里写好的中文提示） */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_PARAMS", parsed.error.issues.map((issue) => issue.message).join("；"));
  }
  return parsed.data;
}

/** app.onError：AppError 按错误码表给 HTTP 状态；其它一律 INTERNAL_ERROR，不把内部错误细节回给前端 */
export function createErrorHandler(logger: Pick<Console, "error"> = console): ErrorHandler {
  return (error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { ok: false as const, error: { code: error.code, message: error.message } },
        ERROR_HTTP_STATUS[error.code] as ContentfulStatusCode,
      );
    }
    logger.error(`[http] ${c.req.method} ${c.req.path} 内部错误`, error);
    return c.json({ ok: false as const, error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试" } }, 500);
  };
}
