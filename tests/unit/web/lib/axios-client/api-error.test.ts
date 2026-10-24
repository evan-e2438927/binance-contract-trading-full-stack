import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import { getToken, setToken } from "@/lib/session/token";
import { ApiError, toApiError } from "../../../../../apps/web/src/lib/axios-client/api-error";

function responseError(status: number, data: unknown, headers: Record<string, string> = {}) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, {
    status,
    statusText: "",
    data,
    headers,
    config,
  });
}

beforeEach(() => setToken(null));

describe("toApiError", () => {
  it("业务错误：透传服务端的中文 message，不二次翻译", () => {
    const error = toApiError(
      responseError(400, { ok: false, error: { code: "INSUFFICIENT_MARGIN", message: "可用余额不足" } }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("INSUFFICIENT_MARGIN");
    expect(error.message).toBe("可用余额不足");
    expect(error.retryable).toBe(false);
  });

  it("401 清掉本地 token", () => {
    setToken("expired");
    const error = toApiError(
      responseError(401, { ok: false, error: { code: "TOKEN_EXPIRED", message: "登录已过期，请重新登录" } }),
    );
    expect(error.code).toBe("TOKEN_EXPIRED");
    expect(getToken()).toBeNull();
  });

  it("429 带上 Retry-After", () => {
    const error = toApiError(
      responseError(429, { ok: false, error: { code: "RATE_LIMITED", message: "请求太频繁" } }, { "retry-after": "3" }),
    );
    expect(error.retryAfterMs).toBe(3000);
  });

  it("网络失败 / 超时 / 非包络的 5xx 可重试", () => {
    expect(toApiError(new AxiosError("x", "ERR_NETWORK")).code).toBe("NETWORK_ERROR");
    expect(toApiError(new AxiosError("x", "ECONNABORTED")).code).toBe("TIMEOUT");
    const server = toApiError(responseError(502, "<html>bad gateway</html>"));
    expect(server.code).toBe("INTERNAL_ERROR");
    expect(server.retryable).toBe(true);
  });
});
