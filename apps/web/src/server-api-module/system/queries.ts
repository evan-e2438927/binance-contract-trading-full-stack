import { queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";

import type { System } from "./types";

/** 系统信息的 queryKey */
export const systemKeys = {
  all: ["system"] as const,
  version: () => [...systemKeys.all, "version"] as const,
};

/** GET /system/version：服务端版本号 + 运行时长 */
export const fetchSystemVersion = () => request.get<System>("/system/version");

/** 系统版本/运行时长；每 60s 刷新一次，避免运行时长过度陈旧 */
export const systemVersionQuery = () =>
  queryOptions({
    queryKey: systemKeys.version(),
    queryFn: fetchSystemVersion,
    refetchInterval: 60_000,
  });
