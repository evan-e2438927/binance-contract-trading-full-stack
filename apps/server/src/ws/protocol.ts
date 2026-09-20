import { z } from "zod";
import { isValidStep } from "@binance-contract-trading-full-stack/shared";
import { KLINE_INTERVALS } from "../market/binance-rest";

/**
 * WebSocket 协议（04-backend-design.md 第 12 节）。
 *
 * 客户端 → 服务端：`{ op: "auth" | "sub" | "unsub" | "pong" }`
 * 服务端 → 客户端：`{ ch, ts, d }`，外加心跳 `{ op: "ping" }`
 *
 * 设计文档没写"订阅成功 / 出错怎么回"（缺口 #49）：这里补两种服务端消息，形状和数据推送一致——
 * `ch: "ack"` 回执（哪个 op、订阅了哪些频道），`ch: "error"` 用 REST 同一套错误码。
 */

export const PUBLIC_CHANNEL_KINDS = ["ticker", "depth", "trade", "kline"] as const;
/** 鉴权之后自动订阅，不用 sub（设计文档第 12 节"私有频道"） */
export const PRIVATE_CHANNELS = ["account", "position", "order", "fill", "liquidation", "funding"] as const;
export const MARKET_STATUS_CHANNEL = "market";

const channelName = z.string().min(1).max(64);

export const clientMessageSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("auth"), token: z.string().min(1).max(4096) }),
  z.strictObject({ op: z.literal("sub"), channels: z.array(channelName).min(1).max(100) }),
  z.strictObject({ op: z.literal("unsub"), channels: z.array(channelName).min(1).max(100) }),
  z.strictObject({ op: z.literal("pong") }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: string): { ok: true; message: ClientMessage } | { ok: false; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: "不是合法 JSON" };
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `消息格式不对：${parsed.error.issues.map((i) => i.message).join("；")}` };
  return { ok: true, message: parsed.data };
}

export interface ParsedChannel {
  /** 规范化之后的频道名（币对大写），推送和退订都用它 */
  name: string;
  kind: (typeof PUBLIC_CHANNEL_KINDS)[number] | "market";
  symbol?: string;
  interval?: string;
  /** depth 频道的聚合精度（2026-09-20）。必须是该币对 tickSize 的合法倍数 */
  step?: string;
}

/**
 * 解析并校验一个公共频道名；不认识、币对没开放、interval / step 不支持都返回 null。
 *
 * `depth` 带第三段精度，和 `kline` 带 interval 是同一个形状：`depth:BNBUSDT:0.1`。
 * 2026-09-20 加的——盘口改成**服务端按精度聚合好再推**，精度必须跟着订阅走（S03 讲义）。
 * 不带第三段的 `depth:BNBUSDT` 仍然认，按 tickSize（最细）算，老客户端不会断。
 */
export function parsePublicChannel(
  name: string,
  isOpenSymbol: (symbol: string) => boolean,
  tickSizeOf?: (symbol: string) => string | undefined,
): ParsedChannel | null {
  if (name === MARKET_STATUS_CHANNEL) return { name, kind: "market" };
  const [kind, rawSymbol, interval, ...rest] = name.split(":");
  if (rest.length > 0 || !kind || !rawSymbol) return null;
  if (!(PUBLIC_CHANNEL_KINDS as readonly string[]).includes(kind)) return null;
  const symbol = rawSymbol.toUpperCase();
  if (!isOpenSymbol(symbol)) return null;
  if (kind === "kline") {
    if (!interval || !(KLINE_INTERVALS as readonly string[]).includes(interval)) return null;
    return { name: `kline:${symbol}:${interval}`, kind: "kline", symbol, interval };
  }
  if (kind === "depth") {
    const tickSize = tickSizeOf?.(symbol);
    // 拿不到 tickSize 就只认不带精度的老写法，不瞎猜
    if (interval === undefined) {
      return { name: `depth:${symbol}`, kind: "depth", symbol, step: tickSize };
    }
    if (tickSize === undefined || !isValidStep(tickSize, interval)) return null;
    return { name: `depth:${symbol}:${interval}`, kind: "depth", symbol, step: interval };
  }
  if (interval !== undefined) return null;
  return { name: `${kind}:${symbol}`, kind: kind as ParsedChannel["kind"], symbol };
}

export interface ServerMessage {
  ch: string;
  ts: number;
  d: unknown;
}

export const serverMessage = (ch: string, ts: number, d: unknown): string => JSON.stringify({ ch, ts, d } satisfies ServerMessage);
export const pingMessage = (): string => JSON.stringify({ op: "ping" });
export const ackMessage = (ts: number, d: unknown): string => serverMessage("ack", ts, d);
export const errorMessage = (ts: number, code: string, message: string): string => serverMessage("error", ts, { code, message });
