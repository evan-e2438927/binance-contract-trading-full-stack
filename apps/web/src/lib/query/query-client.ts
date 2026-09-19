import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/axios-client/api-error";

/**
 * React Query 只管 REST 的请求与缓存（币对规格、历史委托、成交、流水、排行榜……）。
 * 实时数据（盘口、ticker、余额、仓位、挂单）在 Zustand，不进这里。
 * queryKey 和各接口的缓存时间在 server-api-module/<模块>/queries.ts，跟着接口走。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 只重试系统异常（网络、超时、5xx）；业务拒绝重试也没用
        retry: (failureCount, error) => error instanceof ApiError && error.retryable && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
