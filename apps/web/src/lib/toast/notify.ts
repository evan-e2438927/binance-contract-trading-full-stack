import { toast } from "sonner";

import { ApiError, toApiError } from "@/lib/axios-client/api-error";

/**
 * G-10 Toast 统一封装。三种（08 第 1 节）：
 * - 成功：下单成功、撤单成功
 * - 业务拒绝：服务端的中文原因**原样显示**，不二次翻译、不拼接
 * - 系统异常：网络 / 超时 / 5xx，带「重试」按钮（`ApiError.retryable` 决定）
 *
 * 组件不要直接 import sonner，都走这里，免得每处各写各的文案和重试逻辑。
 */

export interface ToastPlan {
  message: string;
  /** 有值时 Toast 上出现「重试」按钮 */
  retryable: boolean;
}

/** 纯函数：决定这个错误显示什么、要不要重试按钮。onRetry 没传就不给按钮 */
export function toastPlan(error: unknown, hasRetry: boolean): ToastPlan {
  const apiError = error instanceof ApiError ? error : toApiError(error);
  return { message: apiError.message, retryable: hasRetry && apiError.retryable };
}

export const notify = {
  success(message: string) {
    toast.success(message);
  },

  info(message: string) {
    toast.info(message);
  },

  /** 失败。系统异常且传了 onRetry 时带「重试」按钮；业务拒绝只显示原因 */
  error(error: unknown, onRetry?: () => void) {
    const plan = toastPlan(error, onRetry !== undefined);
    toast.error(plan.message, plan.retryable && onRetry ? { action: { label: "重试", onClick: onRetry } } : undefined);
  },
};
