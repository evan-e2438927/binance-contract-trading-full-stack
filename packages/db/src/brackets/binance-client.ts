import { createHmac } from "node:crypto";
import type { OfficialSymbolBrackets } from "./normalize";

const DEFAULT_BASE_URL = "https://fapi.binance.com";
const LEVERAGE_BRACKET_PATH = "/fapi/v1/leverageBracket";
const DEFAULT_RECV_WINDOW_MS = 10_000;

/** 币安签名：对完整查询串做 HMAC-SHA256，十六进制输出。 */
export function sign(query: string, secretKey: string): string {
  return createHmac("sha256", secretKey).update(query).digest("hex");
}

/** 常见错误码 → 排查方向。只收和这个只读接口相关的几条。 */
const ERROR_HINTS: Record<number, string> = {
  [-2015]: "API Key 无效、本机出口 IP 不在这个 Key 的 IP 白名单里，或者 Key 没开「允许读取」权限",
  [-2014]: "API Key 格式不对，检查 BINANCE_API_KEY 有没有多复制空格或引号",
  [-1022]: "签名不对，检查 BINANCE_SECRET_KEY 是否和这个 API Key 配对",
  [-1021]: "本机时间和币安服务器相差过大，校准系统时间后重试",
};

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export interface BracketFetcherOptions {
  apiKey: string;
  secretKey: string;
  /** 测试时注入假的 fetch。 */
  fetch?: typeof fetch;
  /** 测试时注入固定时钟。 */
  now?: () => number;
  baseUrl?: string;
  recvWindowMs?: number;
}

export type FetchBrackets = () => Promise<OfficialSymbolBrackets[]>;

/**
 * 创建一个"拉全量官方分层表"的函数。
 *
 * 只调只读接口 GET /fapi/v1/leverageBracket（不带 symbol 就返回全部币对）。
 * Key 只在服务端用，这个函数不做任何校验以外的数据加工——校验交给 normalize。
 */
export function createBracketFetcher(options: BracketFetcherOptions): FetchBrackets {
  if (!options.apiKey) throw new Error("BINANCE_API_KEY 为空，无法调用签名接口");
  if (!options.secretKey) throw new Error("BINANCE_SECRET_KEY 为空，无法调用签名接口");

  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const recvWindowMs = options.recvWindowMs ?? DEFAULT_RECV_WINDOW_MS;

  return async () => {
    const query = `timestamp=${now()}&recvWindow=${recvWindowMs}`;
    const url = `${baseUrl}${LEVERAGE_BRACKET_PATH}?${query}&signature=${sign(query, options.secretKey)}`;

    const res = await doFetch(url, { headers: { "X-MBX-APIKEY": options.apiKey } });
    const text = await res.text();

    if (!res.ok) {
      let code: number | undefined;
      let msg = text.slice(0, 200);
      try {
        const body = JSON.parse(text) as { code?: number; msg?: string };
        code = body.code;
        msg = body.msg ?? msg;
      } catch {
        // 非 JSON 响应（比如地区限制返回的 HTML），保留原文前 200 字
      }
      const hint = code !== undefined ? ERROR_HINTS[code] : undefined;
      throw new BinanceApiError(
        `拉取官方分层表失败：HTTP ${res.status}${code !== undefined ? `，code ${code}` : ""}，${msg}${
          hint ? `（${hint}）` : ""
        }`,
        res.status,
        code,
      );
    }

    const body: unknown = JSON.parse(text);
    if (!Array.isArray(body)) {
      throw new Error("官方分层表返回的不是数组，接口结构可能变了");
    }
    return body as OfficialSymbolBrackets[];
  };
}
