import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/axios-client/api-error";

import { toastPlan } from "../../../../../apps/web/src/lib/toast/notify";

describe("toastPlan", () => {
  it("业务拒绝：原样显示服务端的中文，不给重试", () => {
    const error = new ApiError("INSUFFICIENT_BALANCE", "可用余额不足", 400);
    expect(toastPlan(error, true)).toEqual({ message: "可用余额不足", retryable: false });
  });

  it("系统异常（5xx）：给重试", () => {
    const error = new ApiError("INTERNAL_ERROR", "服务器内部错误，请稍后重试", 500);
    expect(toastPlan(error, true).retryable).toBe(true);
  });

  it("网络层失败：给重试", () => {
    const error = new ApiError("NETWORK_ERROR", "网络连接失败，请检查网络后重试", null);
    expect(toastPlan(error, true).retryable).toBe(true);
  });

  it("没传 onRetry 就不给重试按钮", () => {
    const error = new ApiError("NETWORK_ERROR", "网络连接失败，请检查网络后重试", null);
    expect(toastPlan(error, false).retryable).toBe(false);
  });

  it("不是 ApiError 的东西也能显示", () => {
    expect(toastPlan(new Error("boom"), false).message).toBe("发生未知错误，请稍后重试");
  });
});
