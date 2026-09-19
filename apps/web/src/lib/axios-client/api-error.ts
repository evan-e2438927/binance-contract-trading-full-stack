import { isAxiosError } from "axios";

import { getToken, setToken } from "@/lib/session/token";

import type { Envelope } from "./types";

/**
 * 请求失败统一成 ApiError（05-frontend-design.md 第 13 节）：
 * message 是服务端给的中文，界面直接显示，不二次翻译。
 * 401（UNAUTHORIZED / TOKEN_EXPIRED）清掉本地 token，回到未登录态；不自动弹登录（第 12.4 节）。
 */
export class ApiError extends Error {
  /** 服务端错误码（packages/shared 的 ERROR_CODES），或前端自己的 NETWORK_ERROR / TIMEOUT */
  readonly code: string;
  /** HTTP 状态码；网络层失败时为 null */
  readonly status: number | null;
  /** 429 时服务端给的 Retry-After（毫秒） */
  readonly retryAfterMs: number | null;

  constructor(code: string, message: string, status: number | null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  /** 系统异常（网络、超时、5xx）：界面给 Toast + 重试按钮；其余是业务拒绝，只给 Toast */
  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

const AUTH_ERROR_CODES = new Set(["UNAUTHORIZED", "TOKEN_EXPIRED"]);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!isAxiosError(error)) {
    return new ApiError("INTERNAL_ERROR", "发生未知错误，请稍后重试", null);
  }
  const response = error.response;
  if (!response) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new ApiError("TIMEOUT", "请求超时，请检查网络后重试", null);
    }
    return new ApiError("NETWORK_ERROR", "网络连接失败，请检查网络后重试", null);
  }
  const body = response.data as Partial<Envelope<unknown>> | undefined;
  if (body && body.ok === false && body.error) {
    const { code, message } = body.error;
    if (AUTH_ERROR_CODES.has(code) && getToken()) setToken(null);
    const retryAfter = Number(response.headers["retry-after"]);
    return new ApiError(code, message, response.status, Number.isFinite(retryAfter) ? retryAfter * 1000 : null);
  }
  return new ApiError("INTERNAL_ERROR", "服务器内部错误，请稍后重试", response.status);
}
