# 10 · 搭建教程：行情层

> 服务端第一讲。引擎是纯的、不看钟、不联网——它只认 `EngineInput`。这一讲造的是**真实世界那一头**：
> 连上币安，把推送解析成引擎认的 `book` / `trade` / `markPrice`，断线自己重连，并且**如实报告现在的行情能不能信**。
>
> 这一层**不含任何业务逻辑**：不撮合、不算钱、不连数据库。事件交给谁、断线时暂停什么，是第 11 讲宿主的事。

**这一讲结束时你会有什么**（全部在 `apps/server/src/market/`）：

| 文件 | 干什么 |
| --- | --- |
| `streams.ts` | 订阅哪些流、连哪个地址 |
| `parse.ts` | 一条推送 → 类型化事件；格式不对抛错 |
| `connection.ts` | 一条 WebSocket：指数退避重连 + 静默断线看门狗 |
| `market-feed.ts` | 两条连接合成一个行情源：connecting / ready / degraded |
| `exchange-info.ts` | 查币对在币安是不是 `TRADING` |
| `watch.ts` | 验收脚本：终端每秒刷新 20 个币对的行情 |
| `__fixtures__/binance-streams-2026-09-17.jsonl` | 30 条录下来的真实推送 |

- `apps/server` 新增依赖 `engine`、`shared`（行情事件直接用引擎的输入类型），新脚本 `market:watch`
- 35 条新测试，server 共 44 条全绿

**先读**：`docs/design/04-backend-design.md` 第 2 节（行情层，**注意末尾两处"已过时 / 已定"**）、第 1 节启动顺序；`docs/design/07-binance-reference.md` 第 7 节（连接规则、推送字段）；`02-architecture.md` 第九节失真点 #7（行情断线暂停撮合）。

> **代码已经在仓库里了**：AI 写代码和讲义，你对照着读。代码块用脚本从源文件截取，和仓库逐字一致（只去掉公共缩进）。

---

## 第 1 节：跑起来看看

```bash
pnpm --filter server market:watch
```

```
跳过不在交易状态的币对：TONUSDT(SETTLING)

>>> 2026-09-17T08:11:22.009Z 行情状态：ready

2026-09-17T08:11:22.508Z  状态 ready（public open / market open）
BTCUSDT    最新     76438.8000  标记     76437.8000  买一     76438.8000  卖一     76438.9000  费率   0.000033
ETHUSDT    最新      2442.1900  标记      2442.1800  买一      2442.1800  卖一      2442.1900  费率   0.000035
…
```

（2026-09-17 实跑的输出节选。）拔掉网线或关掉代理，10 秒左右状态应该变 `degraded`；恢复网络，自动重连、重新收齐快照后回到 `ready`。**这一步我没法替你拔网线**：看门狗和重连逻辑由 `connection.test.ts` 用假时钟覆盖，真实断网要你手动验收一次。

---

## 第 2 节：这一讲定下来的事

| # | 决定 | 依据 |
| --- | --- | --- |
| 1 | **两条连接**：`/public` 订 depth20，`/market` 订 aggTrade + markPrice@1s + kline_1m | 币安把合约 WebSocket 拆了入口，旧地址只推 `/public` 类数据（缺口 #22）；原设计是一条连接 |
| 2 | 只在 URL 里订阅，不发 SUBSCRIBE 消息 | 币安每连接每秒最多收 10 条客户端消息 |
| 3 | 重连退避 1s, 2s, 4s, 8s, 16s, 30s…，**收到第一条数据才清零** | 设计文档第 2 节；只连上不推数据（比如入口地址错了）不能算恢复，否则会 1 秒一次猛重连 |
| 4 | **看门狗**：连着但 10 秒没有任何消息 → 主动断开重连 | 拔网线、代理掉线、NAT 超时时 TCP 可能很久不报 close；我们的流每 100ms / 1s 就有数据 |
| 5 | pong 不用自己回 | 币安每 3 分钟发 ping；Node 自带 WebSocket 按协议自动回 pong |
| 6 | 24 小时断开当普通断线处理 | 币安连接最多有效 24 小时 |
| 7 | **不用 REST 补快照** | depth20 和 markPrice 本身就是完整快照，不是增量，重连后 100ms / 1s 内就推一遍；原设计的 REST 补齐是多余的，还多一个"REST 快照和流对不上"的窗口 |
| 8 | 就绪 = 两条连接都连着 + **每个币对这次连上之后**都收到过盘口和标记价；连接一断，它负责的快照全部作废 | 断线前的快照不能证明现在的行情 |
| 9 | 行情事件不管什么状态都往外发 | 盘口和标记价是恢复就绪的前提；暂停撮合是宿主的决定（缺口 #16） |
| 10 | 价格数量从字符串直接 `parse()`；**格式不对就抛错**，这条连接的就绪条件作废 | CLAUDE.md 硬约束 1；"尽量解析"出来的错数字会直接进撮合 |
| 11 | aggTrade 数量取 `nq`，缺了不退回 `q` | 第 06 讲定；退回 `q` 会让排队悄悄变快 |
| 12 | 只订阅币安 `status = TRADING` 的币对 | 2026-09-17 发现 TONUSDT 已是 `SETTLING`，盘口为空，订阅了永远 ready 不了（缺口 #30） |

---

## 第 3 节：订阅什么、连哪里

```ts
export function streamsFor(connection: ConnectionName, symbol: string): string[] {
  const s = symbol.toLowerCase();
  return connection === "public"
    ? [`${s}@depth20@100ms`] // 20 档快照，每 100ms 一次（快照流，不需要维护序列号）
    : [`${s}@aggTrade`, `${s}@markPrice@1s`, `${s}@kline_1m`];
}
```

```ts
export function combinedStreamUrl(connection: ConnectionName, symbols: readonly string[], base = BINANCE_WS_BASE): string {
  const streams = symbols.flatMap((symbol) => streamsFor(connection, symbol));
  return `${base}/${connection}/stream?streams=${streams.join("/")}`;
}
```

**为什么是 depth20 快照，不是 depth 增量**（设计文档第 2 节）：增量流要自己维护本地盘口、对序列号、丢包了重拉 REST，出错就是一个悄悄不对的盘口。快照流每次推完整 20 档，永远不会 out-of-sync。

**我们只看得到 20 档**，这是失真点 #4 的来源（市价单超过可见深度一半就拒单）。

---

## 第 4 节：解析——不猜

```ts
export function parseStreamMessage(raw: string): MarketEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    throw new MarketParseError("不是合法 JSON", raw);
  }
  const envelope = asRecord(message, "推送", raw);
  const stream = str(envelope, "stream", raw);
  const data = asRecord(envelope.data, "data", raw);
  const kind = stream.split("@")[1];

  switch (kind) {
    case "depth20":
      return parseDepth(data, raw);
    case "aggTrade":
      return parseAggTrade(data, raw);
    case "markPrice":
      return parseMarkPrice(data, raw);
    case "kline_1m":
      return parseKline(data, raw);
    default:
      return null;
  }
}
```

四种流各一个解析函数，以 aggTrade 为例：

```ts
function parseAggTrade(data: Record<string, unknown>, raw: string): TradeEvent {
  expectEvent(data, "aggTrade", raw);
  const buyerIsMaker = data.m;
  if (typeof buyerIsMaker !== "boolean") throw new MarketParseError("aggTrade.m 不是布尔值", raw);
  return {
    t: "trade",
    symbol: str(data, "s", raw),
    tradeId: int(data, "a", raw),
    price: positive(data, "p", raw),
    qty: decimal(data, "nq", raw),
    buyerIsMaker,
    ts: int(data, "T", raw),
  };
}
```

字段读取都经过校验：

```ts
const DECIMAL = /^\d+(\.\d{1,8})?$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,8})?$/;
```

**为什么 `parse()` 前要先用正则挡一下**：`packages/shared` 的 `parse()` 假设输入是合法的十进制字符串，不做校验（它在热路径上）。`"7.6e4"` 喂进去会得到一个错的数，不会报错。协议边界上的数据必须先校验。

**盘口顺序也校验**：引擎假设 `bids[0]` 是买一、`asks[0]` 是卖一。币安真改了顺序，悄悄重排看起来"更健壮"，但那说明协议变了，别的字段含义可能也变了——停下来比猜对更重要。

**时间取哪个字段**：盘口和成交用撮合时间 `T`；标记价推送的 `T` 是**下次资金费结算时间**，事件时间要用 `E`。同一个字母在不同流里含义不一样，这是解析层最容易错的地方，所以每个字段都在 `07-binance-reference.md` 第 7 节列了对照。

---

## 第 5 节：一条连接——重连和看门狗

```ts
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
```

几个细节：

1. **每个回调先检查 `socket !== current`**。看门狗主动关掉的旧连接，它的 `close` 事件可能在新连接建好之后才到——不挡住，就会再排一次重连，最后同时开着两条连接
2. **看门狗到点先检查距离最后一条消息多久**，没超时就按剩余时间再等。不是"每条消息重置一次定时器"——那样每秒要清几十次定时器
3. **`attempt` 在收到消息时清零，不是连上时**。一个入口地址写错的连接会立刻 open 然后什么都不推：如果连上就清零，看门狗每 10 秒断一次、1 秒后又连，永远不退避
4. **所有依赖都能注入**（`createSocket`、`now`、`setTimer`）。测试用假时钟一毫秒一毫秒地推进，1s → 2s → 4s … 30s 的退避序列、10 秒看门狗都能精确断言，不用真的等

---

## 第 6 节：两条连接合成一个行情源

```ts
export function startMarketFeed(options: MarketFeedOptions): MarketFeed {
  const logger = options.logger ?? console;
  const open = options.openConnection ?? openConnection;
  const symbols = new Set(options.symbols.map((s) => s.toUpperCase()));
  if (symbols.size === 0) throw new Error("行情层至少要订阅一个币对");

  const states: Record<ConnectionName, ConnectionState> = { public: "closed", market: "closed" };
  // 这次连上之后，哪些币对已经收到过盘口 / 标记价。连接一断就清空：断线前的快照不能证明现在的行情
  const sawBook = new Set<string>();
  const sawMark = new Set<string>();
  let status: FeedStatus = "connecting";
  let everReady = false;
  let stopped = false; // 主动停掉之后连接关闭不算断线，不再报状态、不再发事件

  function refreshStatus(): void {
    if (stopped) return;
    const ready =
      states.public === "open" &&
      states.market === "open" &&
      sawBook.size === symbols.size &&
      sawMark.size === symbols.size;
    if (ready) everReady = true;
    const next: FeedStatus = ready ? "ready" : everReady ? "degraded" : "connecting";
    if (next === status) return;
    status = next;
    logger.log(`[market] 行情状态 → ${next}`);
    options.onStatusChange?.(next);
  }

  /** 这条连接负责的就绪条件作废：public 管盘口，market 管标记价 */
  function invalidate(name: ConnectionName): void {
    (name === "public" ? sawBook : sawMark).clear();
  }

  function handleMessage(name: ConnectionName, text: string): void {
    if (stopped) return;
    let event: MarketEvent | null;
    try {
      event = parseStreamMessage(text);
    } catch (error) {
      if (!(error instanceof MarketParseError)) throw error;
      // 解析不了说明协议可能变了：这条连接的数据先不信，等下一轮完整快照再恢复就绪
      logger.error(`[market:${name}] 推送解析失败：${error.message}`, error.raw.slice(0, 500));
      invalidate(name);
      refreshStatus();
      return;
    }
    if (!event || !symbols.has(event.symbol)) return;

    if (event.t === "book") sawBook.add(event.symbol);
    if (event.t === "markPrice") sawMark.add(event.symbol);
    options.onEvent(event);
    refreshStatus();
  }

  const connections = (["public", "market"] as const).map((name) =>
    open({
      ...options.connectionOptions,
      name,
      url: combinedStreamUrl(name, [...symbols], options.base ?? BINANCE_WS_BASE),
      logger,
      onMessage: (text) => handleMessage(name, text),
      onStateChange: (state) => {
        states[name] = state;
        if (state !== "open") invalidate(name);
        refreshStatus();
      },
    }),
  );

  return {
    status: () => status,
    symbolReady: (symbol) =>
      states.public === "open" && states.market === "open" && sawBook.has(symbol) && sawMark.has(symbol),
    connectionState: (name) => states[name],
    stop() {
      stopped = true;
      for (const connection of connections) connection.stop();
    },
  };
}
```

三种状态的含义：

| 状态 | 什么时候 | 宿主该做什么（第 11 讲） |
| --- | --- | --- |
| `connecting` | 启动后还没就绪过 | 不接受下单（设计第 1 节启动顺序第 5 步） |
| `ready` | 两条连接都连着，每个币对这次连上之后都收到过盘口和标记价 | 正常撮合 |
| `degraded` | 就绪过，后来断了或收到解析不了的推送 | 暂停撮合，恢复后不补算断线期间的成交（失真点 #7） |

**为什么断线要清空"收到过"的记录**：市场断线 30 秒，价格可能已经走了很远。断线前的盘口还在引擎里，如果重连一成功就说 ready，撮合会先用那份 30 秒前的盘口吃一笔。必须等**这次连上之后**的新快照。

**为什么解析失败也降级**：一条推送解析不了，可能是网络传坏了一次，也可能是币安改了协议。前者下一轮快照（100ms / 1s 后）就恢复；后者会一直降级——这正是我们想要的，交易停下来等人看。

**为什么 `stop()` 之后不报 degraded**：主动停掉时连接关闭是预期的，报 degraded 会让宿主以为行情出问题了（验收时实际踩到过：Ctrl+C 退出前多打了一行 degraded）。

**按币对就绪** `symbolReady(symbol)`：整体 ready 要求所有币对都就绪。第 11 讲宿主可以按币对判断，一个币对的问题不必停掉所有币对。

---

## 第 7 节：TONUSDT——验收时发现的真问题

第一次跑 `market:watch`，19 个币对都有数据，**TONUSDT 只有标记价，没有成交和盘口**，状态一直卡在 `connecting`。查币安：

```
$ curl https://fapi.binance.com/fapi/v1/exchangeInfo  → TONUSDT  status: SETTLING
$ curl https://fapi.binance.com/fapi/v1/depth?symbol=TONUSDT  → {"bids":[],"asks":[]}
```

TONUSDT 已经在下架结算，但还在我们的开放名单 `OPEN_SYMBOLS` 里。于是：

```ts
export function symbolStatuses(response: unknown, symbols: readonly string[]): SymbolStatus[] {
  const list = (response as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(list)) throw new Error("exchangeInfo 响应里没有 symbols 数组");
  const byName = new Map<string, string>();
  for (const item of list) {
    const { symbol, status } = (item ?? {}) as { symbol?: unknown; status?: unknown };
    if (typeof symbol !== "string" || typeof status !== "string") throw new Error("exchangeInfo.symbols 里有格式不对的条目");
    byName.set(symbol, status);
  }
  return symbols.map((symbol) => ({ symbol, status: byName.get(symbol) ?? "MISSING" }));
}
```

`watch.ts` 启动时先查一遍，只订阅 `TRADING` 的币对。生产上币对清单由宿主从 `symbols` 表读（`status` 列由 `seed:symbols` 从 exchangeInfo 同步），第 11 讲接上。

**开放名单要不要去掉 TONUSDT、换成别的币对，是产品决定，要你定**（缺口 #30）。

---

## 第 8 节：测试怎么组织

| 文件 | 条数 | 测什么 |
| --- | --- | --- |
| `parse.test.ts` | 17 | 30 条真实推送全部能解析；四种流的字段对照（期望值直接从原始 JSON 字符串 parse，不手抄数字）；9 种格式错误都抛错；盘口乱序抛错；负费率；未知流返回 null |
| `connection.test.ts` | 9 | 退避序列、清零时机、状态序列、24 小时断开、看门狗、晚到的 close、stop |
| `market-feed.test.ts` | 7 | 两个地址、就绪条件、按币对就绪、断线降级与恢复、解析失败降级、币对过滤、stop |
| `exchange-info.test.ts` | 2 | 状态查找、响应格式错误 |

`testing.ts` 里是假时钟和假 WebSocket。

**故意改错跑一遍**：

| 改法 | 红几条 |
| --- | --- |
| 成交量取 `q` 不取 `nq` | 1 |
| 退避不清零 | 1 |
| 看门狗不生效 | 2 |
| 断线不作废快照 | 1 |
| 不过滤订阅之外的币对 | 1 |
| 不查盘口顺序 | 1 |
| 用旧地址 `/stream` | 1 |

---

## 验收清单

- [ ] `pnpm --filter server test` 全绿（44 条）
- [ ] `engine` / `shared` / `db` / `server` 四个包 `check-types` 通过
- [ ] `pnpm --filter server market:watch`：跳过 TONUSDT，其余 19 个币对几秒内 `ready`，价格每秒刷新
- [ ] 拔网线（或关代理）约 10 秒后状态变 `degraded`，恢复网络后自动回到 `ready`
- [ ] Ctrl+C 退出时不打印 `degraded`

全部打勾，进第 11 讲：仓储层与引擎宿主。

---

## 读完可以自测

1. 为什么要拆成两条连接？只连 `/stream` 会怎样？
2. 标记价推送里的 `T` 和成交推送里的 `T` 分别是什么？
3. `parse("7.6e4")` 会得到什么？为什么解析层要先用正则挡？
4. 网线被拔掉，WebSocket 为什么可能很久都不触发 close？看门狗怎么发现的？
5. 退避次数为什么在"收到第一条数据"时清零，而不是"连上"时？
6. 重连成功后为什么不立刻回到 ready？如果立刻回到 ready，第一笔撮合会用到什么盘口？
7. 为什么不用 REST 在重连后补一次盘口快照？
8. 行情源 `degraded` 时，行情事件为什么还往外发？
