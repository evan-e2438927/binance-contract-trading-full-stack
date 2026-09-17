/**
 * 一条币安 WebSocket 连接：断了就按指数退避重连，太久没收到消息也当断了处理。
 *
 * 币安的连接规则（本地文档 websocket-market-streams/Connect）：
 * - 一条连接最多有效 24 小时，到点会被断开——所以"断线重连"不是异常路径，是每天都会走的路
 * - 服务器每 3 分钟发 ping 帧，10 分钟内收不到 pong 就断开。Node 自带的 WebSocket（undici）
 *   按协议自动回 pong，不用我们处理
 *
 * 还有一种断法币安管不了：网络静默断开（拔网线、代理掉了、NAT 超时），TCP 层可能很久都不报 close。
 * 所以加一个看门狗：超过 staleMs 没收到任何消息，主动关掉重连。我们订阅的流都是高频的
 * （depth 每 100ms、markPrice 每 1s），正常情况下不可能安静 10 秒。
 *
 * 这个文件只管"连着 / 没连着"，不懂任何行情字段；解析在 parse.ts，就绪判断在 market-feed.ts。
 */

/** 最小的 WebSocket 接口：Node 自带的 WebSocket 满足它，测试里用假的。 */
export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export type ConnectionState = "connecting" | "open" | "closed";

export interface ConnectionOptions {
  name: string;
  url: string;
  onMessage: (text: string) => void;
  /** 每次状态变化都调用：connecting → open → closed → connecting → …，stop() 之后停在 closed */
  onStateChange?: (state: ConnectionState) => void;
  /** 默认 `new WebSocket(url)` */
  createSocket?: (url: string) => SocketLike;
  /** 重连等待，单位毫秒。默认 1s, 2s, 4s, 8s, 16s, 30s, 30s…（04-backend-design.md 第 2 节） */
  backoffMs?: (attempt: number) => number;
  /** 多久没收到消息算静默断线，默认 10 秒 */
  staleMs?: number;
  logger?: Pick<Console, "log" | "error">;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Connection {
  readonly name: string;
  state(): ConnectionState;
  stop(): void;
}

export const DEFAULT_STALE_MS = 10_000;

export function defaultBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export function openConnection(options: ConnectionOptions): Connection {
  const createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  const backoffMs = options.backoffMs ?? defaultBackoffMs;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  let state: ConnectionState = "closed";
  let socket: SocketLike | null = null;
  let attempt = 0; // 连续失败次数，收到第一条消息后清零
  let lastMessageAt = 0;
  let watchdog: unknown = null;
  let reconnectTimer: unknown = null;
  let stopped = false;

  function setState(next: ConnectionState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function connect(): void {
    reconnectTimer = null;
    if (stopped) return;
    setState("connecting");
    const current = createSocket(options.url);
    socket = current;

    current.onopen = () => {
      if (socket !== current) return;
      lastMessageAt = now();
      setState("open");
      armWatchdog(staleMs);
    };
    current.onmessage = (event) => {
      if (socket !== current) return;
      lastMessageAt = now();
      attempt = 0; // 真的收到数据了才算恢复，只连上不推数据不算
      if (typeof event.data === "string") options.onMessage(event.data);
    };
    current.onerror = (event) => {
      if (socket !== current) return;
      logger.error(`[market:${options.name}] WebSocket 出错`, event);
    };
    current.onclose = () => {
      if (socket !== current) return; // 看门狗主动关掉的旧连接，close 事件晚到，忽略
      dropSocket();
      scheduleReconnect("连接关闭");
    };
  }

  function dropSocket(): void {
    if (watchdog !== null) clearTimer(watchdog);
    watchdog = null;
    socket = null;
    setState("closed");
  }

  function scheduleReconnect(reason: string): void {
    if (stopped || reconnectTimer !== null) return;
    const wait = backoffMs(attempt);
    attempt++;
    logger.log(`[market:${options.name}] ${reason}，${wait}ms 后第 ${attempt} 次重连`);
    reconnectTimer = setTimer(connect, wait);
  }

  /** 到点检查一次：没超时就按剩余时间再等，超时就断开重连。最晚在最后一条消息之后 staleMs 发现。 */
  function armWatchdog(ms: number): void {
    watchdog = setTimer(() => {
      watchdog = null;
      if (state !== "open") return;
      const silentMs = now() - lastMessageAt;
      if (silentMs < staleMs) {
        armWatchdog(staleMs - silentMs);
        return;
      }
      const stale = socket;
      dropSocket(); // 先断开引用：旧 socket 的 close 事件晚到时会被忽略
      stale?.close();
      scheduleReconnect(`${silentMs}ms 没有收到消息，判定静默断线`);
    }, ms);
  }

  connect();

  return {
    name: options.name,
    state: () => state,
    stop() {
      stopped = true;
      if (reconnectTimer !== null) clearTimer(reconnectTimer);
      reconnectTimer = null;
      const current = socket;
      dropSocket();
      current?.close();
    },
  };
}
