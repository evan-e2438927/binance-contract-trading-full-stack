import axios, { type AxiosRequestConfig } from "axios";

import { SERVER_URL } from "@/lib/config/env";
import { getToken } from "@/lib/session/token";

import { ApiError, toApiError } from "./api-error";
import type { Envelope } from "./types";

/**
 * REST 客户端（axios）。
 *
 * - 自动带 `Authorization: Bearer <token>`
 * - 拆 `{ ok, data }` 包络，调用方直接拿 data
 * - 失败一律抛 ApiError（api-error.ts）
 *
 * 数值字段是字符串，axios 默认的 JSON 解析不会动它们——不要加自定义 transformResponse。
 * 具体接口不在这里写，在 server-api-module/<模块>/ 里。
 */

export const http = axios.create({
  baseURL: SERVER_URL,
  timeout: 10_000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toApiError(error)),
);

function unwrap<T>(body: Envelope<T>): T {
  if (body.ok) return body.data;
  throw new ApiError(body.error.code, body.error.message, null);
}

type Params = AxiosRequestConfig["params"];

export const request = {
  async get<T>(url: string, params?: Params, config?: AxiosRequestConfig): Promise<T> {
    const res = await http.get<Envelope<T>>(url, { ...config, params });
    return unwrap(res.data);
  },
  async post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const res = await http.post<Envelope<T>>(url, body, config);
    return unwrap(res.data);
  },
  async delete<T>(url: string, params?: Params, config?: AxiosRequestConfig): Promise<T> {
    const res = await http.delete<Envelope<T>>(url, { ...config, params });
    return unwrap(res.data);
  },
};
