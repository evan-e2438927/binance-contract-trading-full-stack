import { AppError } from "@binance-contract-trading-full-stack/shared";
import { decode } from "hono/jwt";
import { verifyToken } from "../auth/tokens";
import {
  MARKET_STATUS_CHANNEL,
  PRIVATE_CHANNELS,
  ackMessage,
  errorMessage,
  parseClientMessage,
  parsePublicChannel,
  pingMessage,
  serverMessage,
} from "./protocol";

/**
 * WebSocket 连接中心（04-backend-design.md 第 12 节）：订阅、鉴权、心跳、推送。
 *
 * 不碰 socket 本身——每个连接进来时只交给它两个函数（发一条消息、关闭连接），
 * 所以这一层能脱离网络单测，`ws/server.ts` 才是和 `ws` 库打交道的地方。
 *
 * 几条规矩：
 * - **私有频道不用 sub**：`auth` 成功后自动订阅这个账户的 account / position / order / fill / liquidation / funding
 * - **一个连接只认一个账户**：再次 auth 换账户会先把上一个账户的私有订阅去掉，不会同时收两个人的推送
 * - **token 过期就降级**：按 token 里的 exp 排一个定时器，到点取消私有订阅并发一条 TOKEN_EXPIRED，
 *   不让一条长连接绕过 7 天有效期（设计文档没写这一条）
 * - **心跳**：每 30 秒发 `{ op: "ping" }`，60 秒没收到 pong 就断开（设计文档第 12 节）
 */

export const HEARTBEAT_MS = 30_000;
export const PONG_TIMEOUT_MS = 60_000;
/** 一个连接最多订阅多少个公共频道：19 个币对 × 4 类 + K 线，留够余量 */
export const MAX_CHANNELS_PER_CLIENT = 200;

export interface WsClient {
  readonly id: number;
  /** 收到一条客户端消息 */
  handleMessage(raw: string): Promise<void>;
  /** 连接关掉了（对方断开或我们断开） */
  handleClose(): void;
  readonly accountId: string | null;
  readonly channels: ReadonlySet<string>;
}

export interface WsHubOptions {
  jwtSecret: string;
  /** 这个币对是不是开放交易（公共频道只认开放的币对） */
  isOpenSymbol: (symbol: string) => boolean;
  now?: () => number;
  logger?: Pick<Console, "log" | "error">;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
}

export interface WsHub {
  /** 新连接。send 发一条文本消息，close 关闭连接 */
  connect(send: (raw: string) => void, close: (code: number, reason: string) => void): WsClient;
  /** 推给订阅了这个公共频道的所有连接 */
  publish(channel: string, data: unknown): void;
  /** 推给这个账户的所有连接（私有频道） */
  publishToAccount(accountId: string, channel: string, data: unknown): void;
  stop(): void;
  readonly size: number;
}

interface ClientState {
  id: number;
  send: (raw: string) => void;
  close: (code: number, reason: string) => void;
  channels: Set<string>;
  accountId: string | null;
  lastPongAt: number;
  tokenTimer: unknown;
  closed: boolean;
}

export function createWsHub(options: WsHubOptions): WsHub {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;

  const clients = new Set<ClientState>();
  /** 公共频道 → 订阅它的连接；私有频道靠 accountId 找 */
  const subscribers = new Map<string, Set<ClientState>>();
  let nextId = 1;
  let heartbeat: unknown = null;

  function send(client: ClientState, raw: string): void {
    if (client.closed) return;
    try {
      client.send(raw);
    } catch (error) {
      logger.error(`[ws] 连接 ${client.id} 发送失败`, error);
    }
  }

  function subscribe(client: ClientState, channel: string): void {
    if (client.channels.has(channel)) return;
    client.channels.add(channel);
    const set = subscribers.get(channel) ?? new Set();
    set.add(client);
    subscribers.set(channel, set);
  }

  function unsubscribe(client: ClientState, channel: string): void {
    client.channels.delete(channel);
    const set = subscribers.get(channel);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) subscribers.delete(channel);
  }

  function privateChannelsOf(accountId: string): string[] {
    return PRIVATE_CHANNELS.map((c) => `${c}:${accountId}`);
  }

  function dropPrivate(client: ClientState): void {
    if (!client.accountId) return;
    for (const channel of privateChannelsOf(client.accountId)) unsubscribe(client, channel);
    clearTimer(client.tokenTimer);
    client.tokenTimer = null;
    client.accountId = null;
  }

  async function handleAuth(client: ClientState, token: string): Promise<void> {
    let accountId: string;
    try {
      accountId = await verifyToken(token, options.jwtSecret);
    } catch (error) {
      const code = error instanceof AppError ? error.code : "UNAUTHORIZED";
      const message = error instanceof AppError ? error.message : "登录状态无效，请重新登录";
      send(client, errorMessage(now(), code, message));
      return;
    }
    dropPrivate(client);
    client.accountId = accountId;
    for (const channel of privateChannelsOf(accountId)) subscribe(client, channel);

    // token 到期就降级成公共连接：长连接不能绕过有效期
    const exp = decode(token).payload.exp;
    if (typeof exp === "number") {
      const ms = exp * 1000 - now();
      client.tokenTimer = setTimer(() => {
        dropPrivate(client);
        send(client, errorMessage(now(), "TOKEN_EXPIRED", "登录已过期，请重新登录并重新 auth"));
      }, Math.max(0, ms));
    }
    send(client, ackMessage(now(), { op: "auth", accountId }));
  }

  function handleSub(client: ClientState, channels: string[], op: "sub" | "unsub"): void {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const raw of channels) {
      const parsed = parsePublicChannel(raw, options.isOpenSymbol);
      if (!parsed) {
        rejected.push(raw);
        continue;
      }
      if (op === "sub") {
        if (client.channels.size >= MAX_CHANNELS_PER_CLIENT && !client.channels.has(parsed.name)) {
          rejected.push(raw);
          continue;
        }
        subscribe(client, parsed.name);
      } else {
        unsubscribe(client, parsed.name);
      }
      accepted.push(parsed.name);
    }
    send(client, ackMessage(now(), { op, channels: accepted, rejected }));
    if (rejected.length > 0) {
      // 私有频道不用 sub，写清楚原因，不然前端会以为是币对写错了
      const hint = rejected.some((r) => (PRIVATE_CHANNELS as readonly string[]).includes(r))
        ? "私有频道在 auth 成功后自动订阅，不需要 sub"
        : `频道不存在或币对未开放：${rejected.join(", ")}`;
      send(client, errorMessage(now(), "INVALID_PARAMS", hint));
    }
  }

  function tick(): void {
    const t = now();
    for (const client of clients) {
      if (t - client.lastPongAt > pongTimeoutMs) {
        logger.log(`[ws] 连接 ${client.id} ${Math.round((t - client.lastPongAt) / 1000)} 秒没有 pong，断开`);
        client.close(1001, "心跳超时");
        continue;
      }
      send(client, pingMessage());
    }
    heartbeat = setTimer(tick, heartbeatMs);
  }
  heartbeat = setTimer(tick, heartbeatMs);

  return {
    get size() {
      return clients.size;
    },
    connect(sendRaw, close) {
      const client: ClientState = {
        id: nextId++,
        send: sendRaw,
        close,
        channels: new Set(),
        accountId: null,
        lastPongAt: now(),
        tokenTimer: null,
        closed: false,
      };
      clients.add(client);
      return {
        id: client.id,
        get accountId() {
          return client.accountId;
        },
        get channels() {
          return client.channels;
        },
        async handleMessage(raw) {
          const parsed = parseClientMessage(raw);
          if (!parsed.ok) {
            send(client, errorMessage(now(), "INVALID_PARAMS", parsed.message));
            return;
          }
          const message = parsed.message;
          switch (message.op) {
            case "auth":
              await handleAuth(client, message.token);
              return;
            case "sub":
            case "unsub":
              handleSub(client, message.channels, message.op);
              return;
            case "pong":
              client.lastPongAt = now();
              return;
          }
        },
        handleClose() {
          if (client.closed) return;
          client.closed = true;
          for (const channel of [...client.channels]) unsubscribe(client, channel);
          clearTimer(client.tokenTimer);
          clients.delete(client);
        },
      };
    },
    publish(channel, data) {
      const set = subscribers.get(channel);
      if (!set || set.size === 0) return;
      const raw = serverMessage(channel, now(), data);
      for (const client of set) send(client, raw);
    },
    publishToAccount(accountId, channel, data) {
      const set = subscribers.get(`${channel}:${accountId}`);
      if (!set || set.size === 0) return;
      // 推给用户的频道名不带账户 id：前端订的是 "order"，不是 "order:<我的 id>"
      const raw = serverMessage(channel, now(), data);
      for (const client of set) send(client, raw);
    },
    stop() {
      clearTimer(heartbeat);
      for (const client of [...clients]) {
        clearTimer(client.tokenTimer);
        client.close(1001, "服务端关闭");
        clients.delete(client);
      }
      subscribers.clear();
    },
  };
}

export { MARKET_STATUS_CHANNEL };
