import type { ConnectionStatus, ServerPush } from "./protocol";
import { defaultSocketFactory, SOCKET_OPEN, type SocketFactory, type SocketLike } from "./socket";

/**
 * WebSocket 客户端（05-frontend-design.md 第 5 节）。全局一个连接。
 *
 * 分两层：
 * - 连接层交给 partysocket（socket.ts）：断线重连、指数退避 1s → 30s 封顶、连接超时
 * - 协议层在这里：每次（重）连上都重新 auth、按内部订阅集重新 sub、回 pong、按频道分发
 *
 * 协议（apps/server/src/ws/protocol.ts，消息形状见 protocol.ts）：
 *   客户端 → { op: "auth", token } / { op: "sub" | "unsub", channels } / { op: "pong" }
 *   服务端 → { ch, ts, d }，外加心跳 { op: "ping" }；ch = "ack" 是回执，ch = "error" 是错误
 *   私有频道（account / position / order / fill / liquidation / funding）auth 成功后自动订阅，不用 sub
 *
 * 这里不认识任何业务频道：频道名和推送类型在 server-api-module/<模块>/subscriptions.ts。
 *
 * ★ 增量推送只在连接持续期间可信。断过一次，账户数据必须用 REST 全量重新对齐——
 *   这件事由监听 onOpen 的一方做（ws-bridge 调 account-store 的 hydrate），这里只负责告诉它"连上了"。
 */

type PushHandler = (push: ServerPush) => void;
type OpenHandler = (info: { reconnect: boolean }) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export class WsClient {
  private socket: SocketLike | null = null;
  private token: string | null = null;
  /** 频道 → 引用计数。多个组件订同一个频道（K 线图 + store）时只发一次 sub，最后一个退订才发 unsub */
  private readonly subs = new Map<string, number>();
  private readonly handlers = new Map<string, Set<PushHandler>>();
  private readonly openHandlers = new Set<OpenHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private status: ConnectionStatus = "idle";
  private everOpened = false;

  constructor(
    private readonly url: string,
    private readonly createSocket: SocketFactory = defaultSocketFactory,
  ) {}

  connect(): void {
    if (this.socket) return;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => this.handleOpen());
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    });
    socket.addEventListener("message", (event) => this.handleMessage((event as MessageEvent).data));
    this.setStatus("connecting");
    socket.reconnect();
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.everOpened = false;
    socket?.close(1000, "client disconnect");
    this.setStatus("idle");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 登录 / 登出时调用。
   * 登录：连着就立刻发 auth。登出：协议里没有"取消 auth"，只能断开重连，让私有订阅随旧连接一起消失。
   */
  setToken(token: string | null): void {
    const previous = this.token;
    this.token = token;
    if (!this.isOpen()) return;
    if (token) this.send({ op: "auth", token });
    else if (previous) this.socket?.reconnect(4000, "logout");
  }

  /** 订阅公共频道，返回退订函数。连接没开也可以先订，连上后自动发 */
  subscribe(channels: string[]): () => void {
    const added = channels.filter((ch) => {
      const count = this.subs.get(ch) ?? 0;
      this.subs.set(ch, count + 1);
      return count === 0;
    });
    if (added.length > 0 && this.isOpen()) this.send({ op: "sub", channels: added });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const removed = channels.filter((ch) => {
        const count = this.subs.get(ch) ?? 0;
        if (count <= 1) {
          this.subs.delete(ch);
          return count === 1;
        }
        this.subs.set(ch, count - 1);
        return false;
      });
      if (removed.length > 0 && this.isOpen()) this.send({ op: "unsub", channels: removed });
    };
  }

  /** 监听某个频道的推送（精确匹配频道名，如 "depth:BTCUSDT"、"account"、"error"），返回取消函数 */
  on<T = unknown>(channel: string, handler: (push: ServerPush<T>) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler as PushHandler);
    return () => set.delete(handler as PushHandler);
  }

  /** 每次连上（含重连）时回调，reconnect = true 表示之前断过 */
  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** 当前订阅集（测试和调试用） */
  subscribedChannels(): string[] {
    return [...this.subs.keys()];
  }

  private isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === SOCKET_OPEN;
  }

  private send(message: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(message));
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private handleOpen(): void {
    const reconnect = this.everOpened;
    this.everOpened = true;
    if (this.token) this.send({ op: "auth", token: this.token });
    const channels = [...this.subs.keys()];
    if (channels.length > 0) this.send({ op: "sub", channels });
    this.setStatus("open");
    for (const handler of this.openHandlers) handler({ reconnect });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if ((message as { op?: unknown }).op === "ping") {
      this.send({ op: "pong" });
      return;
    }
    const push = message as Partial<ServerPush>;
    if (typeof push.ch !== "string") return;
    const handlers = this.handlers.get(push.ch);
    if (!handlers) return;
    for (const handler of handlers) handler(push as ServerPush);
  }
}
