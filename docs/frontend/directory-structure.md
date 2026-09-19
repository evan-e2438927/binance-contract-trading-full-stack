# 前端目录整理方案（apps/web/src）

> 状态：**已执行**（2026-09-19）。只搬家和拆文件，没改任何行为；第九节的 5 个问题都按建议定了。
> 生成时间：2026-09-19

---

## 一、为什么现在整理

M00 做完以后，接口相关的东西都堆在 `lib/` 下的几个大文件里：

| 文件 | 行数 | 问题 |
| --- | --- | --- |
| `lib/types.ts` | ~390 | 全部接口的 DTO 挤在一个文件，行情、账户、排行榜混在一起；大部分字段没注释 |
| `lib/endpoints.ts` | ~120 | 6 个业务模块的接口函数挤在一个文件，查询和提交混在一起 |
| `lib/query-client.ts` | ~35 | QueryClient 配置和**所有模块的** queryKey 混在一起，queryKey 离用它的接口很远 |
| `lib/ws.ts` | ~25 | 全局连接实例和**业务频道名**混在一起；推送的类型要调用方自己写 `wsClient.on<OrderBook>(...)`，写错了编译器不管 |
| `lib/api.ts` / `ws-client.ts` / `session.ts` / `format.ts` / `config.ts` / `constants.ts` | — | 通用能力平铺，看不出哪几个是一组 |

M01～M12 每做一个模块都要往这几个大文件里加东西，越往后越难找。趁现在代码量还小（web 一共十几个文件）一次整理好。

---

## 二、整理后的目录

```
apps/web/src/
├─ app/                          ★ 业务模块：路由 + 该模块自己的组件，见第五节
├─ components/                   ★ 通用组件（不属于任何业务模块），见第五节
├─ hooks/                        跨模块的 React 组合逻辑（订阅 + 首屏拉取），见第六节
├─ providers/                    不动
├─ stores/                       跨模块的全局状态，不动（只改 import 路径）
│
├─ server-api-module/            ★ 服务端接口，按服务端的路由模块拆
│  ├─ common/
│  │  └─ types.ts                跨模块共用：Decimal、Page、PageQuery、shared 的枚举
│  ├─ market/                    /market/*（公共，不用登录）
│  │  ├─ queries.ts              symbols / ticker / depth / klines / fundingHistory / status
│  │  ├─ subscriptions.ts        market / depth / trade / ticker / kline 频道
│  │  └─ types.ts
│  ├─ auth/                      /auth/*
│  │  ├─ queries.ts              me
│  │  ├─ mutations.ts            nonce / verify / emailCode / emailVerify
│  │  └─ types.ts
│  ├─ account/                   /account/*
│  │  ├─ queries.ts              account / positions / openOrders / orderHistory / fills / ledger / funding / liquidations / equityCurve
│  │  ├─ mutations.ts            reset / setPositionMode / setNickname
│  │  ├─ subscriptions.ts        account / position / order / fill / liquidation / funding 私有频道
│  │  └─ types.ts
│  ├─ order/                     /orders
│  │  ├─ mutations.ts            place / cancel / cancelAll
│  │  └─ types.ts
│  ├─ position/                  /positions/*
│  │  ├─ mutations.ts            setLeverage / setMarginMode / adjustIsolatedMargin / close
│  │  └─ types.ts
│  └─ leaderboard/               /leaderboard
│     ├─ queries.ts
│     └─ types.ts
│
└─ lib/                          ★ 和业务无关的通用能力
   ├─ axios-client/
   │  ├─ client.ts               axios 实例、拦截器（带 token、错误转换）、request.get/post/delete（拆包络）
   │  ├─ api-error.ts            ApiError、toApiError
   │  ├─ types.ts                Envelope（响应包络）
   │  └─ api-error.test.ts       原 lib/api.test.ts
   ├─ ws-client/
   │  ├─ ws-client.ts            WsClient 类（协议层：auth、sub、pong、分发、引用计数）
   │  ├─ socket.ts               SocketLike、partysocket 工厂（连接层：重连、退避）
   │  ├─ protocol.ts             ServerPush、ConnectionStatus、ack / error 两个系统频道
   │  ├─ instance.ts             全局唯一的 wsClient
   │  └─ ws-client.test.ts
   ├─ session/
   │  └─ token.ts                登录 token 存取与订阅（axios 和 ws 都依赖它，所以单独一组）
   ├─ query/
   │  └─ query-client.ts         createQueryClient（只剩默认配置，queryKey 挪到各模块）
   ├─ format/
   │  ├─ number.ts               价格 / 数量 / USDT / 百分比 / 缩写 / 涨跌方向（bigint）
   │  ├─ time.ts                 日期时间、倒计时
   │  └─ number.test.ts / time.test.ts
   └─ config/
      ├─ env.ts                  SERVER_URL、WS_URL、CHARTING_LIBRARY_PATH
      └─ constants.ts            DEFAULT_SYMBOL、RETURN_TO_KEY
```

### 模块怎么划

**跟服务端路由一一对应**（`apps/server/src/api/` 下的 market / account / orders / positions / leaderboard，加上 `auth/`）。理由：

- 服务端改了某个接口，前端去同名目录找，不用猜
- 接口归属按 URL 前缀判断，没有歧义。例如"历史委托"虽然是订单相关，但路径是 `/account/orders`，归 `account`

模块名用单数（`order`、`position`），和 URL 的复数不完全一样，这是有意的：目录名表示"业务模块"，不是路径。

### 每个模块里的文件

| 文件 | 放什么 | 没有就不建 |
| --- | --- | --- |
| `queries.ts` | GET 接口：请求函数 + 该模块的 queryKey + React Query 的 `queryOptions` | 是 |
| `mutations.ts` | POST / DELETE 接口的请求函数 | 是 |
| `subscriptions.ts` | 该模块的 WS 频道名 + 带类型的监听函数 | 是（**这是你清单外我加的**，理由见第四节） |
| `types.ts` | 请求体、响应、推送的 DTO，**每个结构和每个字段都带注释** | 否 |

不建 `index.ts` 汇总导出，调用方直接 import 具体文件（`@/server-api-module/market/queries`）。汇总文件容易引出循环依赖，也让"这个东西在哪"多绕一层。

---

## 三、文件写法约定

### types.ts：每个结构、每个字段都有注释

注释写三样东西：**是什么、单位 / 格式、什么时候是 null**。对应哪个接口写在结构的注释里。

```ts
/** 币对规格 + 杠杆分层表。来源：GET /market/symbols（数组） */
export interface SymbolSpec {
  /** 币对名，如 "BTCUSDT" */
  symbol: string;
  /** 价格最小变动单位，如 "0.10000000"。展示位数按它推（format/number.ts 的 decimalsOf），不按 pricePrecision */
  tickSize: Decimal;
  /** 最高价格限制；币安没给时为 null */
  maxPrice: Decimal | null;
  // ……每个字段都这样
}
```

字段含义拿不准的，以服务端 `apps/server/src/api/serialize.ts` 和 `docs/design/04-backend-design.md` 为准，不凭字段名猜。

### queries.ts：请求函数和 queryKey 放在一起

```ts
import { queryOptions } from "@tanstack/react-query";

import { request } from "@/lib/axios-client/client";
import type { SymbolSpec, Ticker } from "./types";

/** 该模块全部 queryKey 的根，失效时按前缀匹配 */
export const marketKeys = {
  all: ["market"] as const,
  symbols: () => [...marketKeys.all, "symbols"] as const,
  ticker: (symbol: string) => [...marketKeys.all, "ticker", symbol] as const,
};

/** GET /market/symbols：开放交易的币对规格 */
export const fetchSymbols = () => request.get<SymbolSpec[]>("/market/symbols");

/** 给 useQuery 用；分层表每天才同步一次，缓存 10 分钟 */
export const symbolsQuery = () =>
  queryOptions({ queryKey: marketKeys.symbols(), queryFn: fetchSymbols, staleTime: 10 * 60_000 });
```

- **请求函数**单独导出：store 的 `hydrate()`、`useSymbolMarket` 这类不走 React Query 的地方直接调
- **`xxxQuery()`** 给组件：`useQuery(symbolsQuery())`。queryKey、缓存时间跟着接口走，组件里不再各写各的
- 原来 `lib/query-client.ts` 里的 `queryKeys` 拆散到各模块；登出时清账户缓存用 `accountKeys.all`

### mutations.ts：只放请求函数

```ts
/** POST /orders：下单。成功返回的订单状态以随后的 WS order 推送为准 */
export const placeOrder = (body: PlaceOrderBody) => request.post<Order>("/orders", body);
```

不包 `useMutation`。这个项目下单、撤单、调杠杆之后，界面靠 WS 推送更新 store，不靠 mutation 回调去失效缓存；需要 loading 状态的组件自己 `useMutation({ mutationFn: placeOrder })` 就够了。

### subscriptions.ts：频道名和推送类型绑在一起

```ts
import { wsClient } from "@/lib/ws-client/instance";
import type { OrderBook, TickerPush, Trade } from "./types";

/** 频道名（apps/server/src/ws/protocol.ts） */
export const marketChannels = {
  depth: (symbol: string) => `depth:${symbol}`,
  ticker: (symbol: string) => `ticker:${symbol}`,
  // ……
};

/** 监听盘口推送（WS depth:<SYMBOL>，20 档全量快照），返回取消函数 */
export const onDepth = (symbol: string, handler: (book: OrderBook) => void) =>
  wsClient.on<OrderBook>(marketChannels.depth(symbol), ({ d }) => handler(d));
```

---

## 四、为什么多加一个 subscriptions.ts

你列的是 queries / mutations / types 三样。这个项目的数据有一半是 WS 推来的（盘口、成交、ticker、余额、仓位、挂单），它们也是"服务端接口"，只是换了个通道：

- 现在频道名在 `lib/ws.ts` 一个大对象里，推送类型要调用方自己写泛型：`wsClient.on<OrderBook>(channels.depth(symbol), ...)`。泛型写错了编译器不会报
- 放进模块后，`onDepth(symbol, handler)` 一个函数把频道名和类型绑死，调用方不可能配错
- 推送类型（`TickerPush`、`KlinePush`、`MarketStatusPush`）本来就在该模块的 `types.ts` 里，频道放在旁边最顺

`lib/ws-client/` 里只留和业务无关的：连接、重连、auth、订阅引用计数、分发，以及协议自带的 `ack` / `error` 两个系统频道。

---

## 五、业务模块（app/）与通用组件（components/）

### 5.1 原则

- **`app/<业务模块>/`**：一个页面模块自己用的东西都放在它自己的目录里，包括路由文件（page / layout）和只有它用的组件
- **`components/`**：只放通用组件，不认识任何具体业务（不知道"仓位""委托"是什么）
- 组件放哪看**谁在用**：只有一个模块用就放模块里；两个以上模块用，就挪到 `app/_shared/`

### 5.2 目录

```
app/
├─ layout.tsx                  根布局：Providers + 外壳（顶栏、横幅、强平弹窗）
├─ not-found.tsx               全站 404
├─ error.tsx                   全站错误兜底（M01 待做，这次不建）
│
├─ _shared/                    ★ 多个模块共用的业务组件
│  └─ ui-components/
│     ├─ app-header.tsx          原 components/layout/
│     ├─ account-entry.tsx       原 components/layout/
│     ├─ connection-indicator.tsx 原 components/layout/
│     ├─ market-status-banner.tsx 原 components/layout/
│     ├─ login-dialog.tsx        原 components/common/（顶栏任何页面都能弹）
│     └─ liquidation-dialog.tsx  原 components/common/（根布局挂载，全站弹）
│
├─ (home)/                     首页。括号是路由组，不进 URL，还是 "/"
│  ├─ page.tsx                   原 app/page.tsx
│  └─ _ui-components/
│     └─ symbol-market-list.tsx  原 components/home/
│
├─ trade/                      交易页（M02～M04、M07～M09）
│  ├─ page.tsx                   /trade → 跳默认币对
│  ├─ [symbol]/
│  │  └─ page.tsx                币对不存在页以后可以拆成同目录的 not-found.tsx（这次不动）
│  └─ _ui-components/          /trade 和 /trade/[symbol] 共用
│     └─ trade-view.tsx          原 components/trade/
│
├─ orders/                     历史记录（M10）
│  ├─ page.tsx
│  └─ _ui-components/          （以后）
├─ leaderboard/                排行榜（M11）
│  ├─ page.tsx
│  └─ _ui-components/          （以后）
├─ rules/                      模拟规则（M12）
│  └─ page.tsx
└─ login/                      登录回跳（M05）
   └─ callback/page.tsx

components/                    ★ 通用组件
└─ module-placeholder.tsx      原 components/common/
```

以后会进 `components/` 的是这类：带涨跌色的数字（`PriceText`）、资金费倒计时（`Countdown`）、空状态、表格外壳。

### 5.3 你的结构上我补的几点

**1. 模块内的组件目录加下划线：`_ui-components`**

`app/` 下每个文件夹默认都是一个 URL 段。不加下划线其实也访问不到（没有 `page.tsx` 的文件夹不会变成路由），但 Next 16 文档推荐用 `_` 前缀的"私有文件夹"：整个目录明确排除出路由系统，也不会和以后 Next 新增的约定文件撞名。`_shared` 同理。

**2. 首页用路由组 `(home)`**

首页是根路由 `/`，它的 `page.tsx` 只能在 `app/` 下。如果首页组件直接放 `app/_ui-components/`，会和全站的东西混在一起。用 `(home)` 包一层，URL 不变，首页也有了自己的目录，和其他模块结构一致。

**3. 多个模块共用的业务组件放 `app/_shared/`**

顶栏、登录弹窗、强平弹窗这类东西有业务含义，不能进 `components/`；又不属于任何一个页面。统一放 `app/_shared/ui-components/`。

规则：**模块之间不许互相 import `_ui-components`**。交易页要用首页的组件时（比如以后币对切换下拉要复用 `symbol-market-list`），先把它挪到 `_shared`，再两边引用。这样删掉或重写一个模块不会牵连别的模块。

**4. layout 按需建，不强制**

`layout.tsx` 只在模块内几个页面共用外框时才建（比如以后历史记录页的 tab 栏）。现在没有模块需要，先不建空文件。同理，`loading.tsx`、`error.tsx`、`not-found.tsx` 这几个 Next 约定文件也按需放进模块目录，比如"币对不存在"就是 `trade/[symbol]/not-found.tsx`。

**5. page.tsx 只做接线**

`page.tsx` 保持服务端组件：读路由参数、设置页面标题、渲染模块的根组件。交互逻辑、`"use client"` 都在 `_ui-components` 里。原因：页面标题（`metadata`）只能在服务端组件里导出。

**6. 模块私有的 hooks / store 也可以放进模块**

只有一个模块用的 hook 或 store（比如以后下单面板的表单状态），放 `app/trade/_hooks/`、`app/trade/_stores/`。两个以上模块用的才放 `src/hooks/`、`src/stores/`。现在还没有模块私有的，这次不建。

**7. components/ 和 packages/ui 的分工**

| 位置 | 放什么 | 例子 |
| --- | --- | --- |
| `packages/ui` | shadcn 基础组件，不认识这个项目 | Button、Dialog、Table |
| `apps/web/src/components` | 通用组件，懂项目约定（数值是字符串、null 显示 `--`、涨绿跌红），但不认识具体业务 | PriceText、Countdown、ModulePlaceholder |
| `app/_shared/ui-components` | 多个模块共用的业务组件 | 顶栏、登录弹窗、强平弹窗 |
| `app/<模块>/_ui-components` | 只有这个模块用的业务组件 | 交易页的盘口、下单面板 |

**8. 测试放在被测文件旁边**

和现在一样：`xxx.ts` 旁边放 `xxx.test.ts`，不单独建 `__tests__/` 目录。

---

## 六、hooks 和 stores

- **stores/**：不动。四个 store 本身就是按领域分的（market / account / auth / ui），而且都跨模块使用，只把 import 改到新路径
- **hooks/**：保留，只放跨模块的组合逻辑（订阅 + 首屏拉取 + 写 store）
  - `use-symbols.ts`：变成两行，`useQuery(symbolsQuery())`。首页、交易页、强平弹窗都在用，留在全局
  - `use-symbol-market.ts`：改用 `fetchDepth` / `fetchTicker` / `onDepth` / `onTicker`，逻辑不变。`useTickers` 首页在用，以后交易页的币对切换也用，留在全局

## 七、新旧对照

| 原来 | 去向 |
| --- | --- |
| `lib/api.ts` | `lib/axios-client/client.ts` + `api-error.ts`；导出名 `api` 改成 `request`（避免和 `server-api-module` 混） |
| `lib/api.test.ts` | `lib/axios-client/api-error.test.ts` |
| `lib/types.ts` 的 `Envelope` | `lib/axios-client/types.ts` |
| `lib/types.ts` 的 `Decimal`、`Page`、shared 枚举再导出 | `server-api-module/common/types.ts` |
| `lib/types.ts` 其余 DTO | 各模块 `types.ts`（Position → position，Order → order，Fill / Ledger / Funding / Liquidation / EquityCurve → account，行情和推送 → market，Me / LoginResult → auth，排行榜 → leaderboard） |
| `lib/endpoints.ts` 的 `PageQuery`、`PlaceOrderBody` | `common/types.ts`、`order/types.ts` |
| `lib/endpoints.ts` 的 `xxxApi` | 各模块 `queries.ts` / `mutations.ts` |
| `lib/query-client.ts` 的 `queryKeys` | 拆到各模块 `queries.ts` 的 `xxxKeys` |
| `lib/query-client.ts` 的 `createQueryClient` | `lib/query/query-client.ts` |
| `lib/ws-client.ts` | `lib/ws-client/ws-client.ts` + `socket.ts` + `protocol.ts` |
| `lib/ws.ts` 的 `wsClient` | `lib/ws-client/instance.ts` |
| `lib/ws.ts` 的 `channels` | 业务频道 → `market/`、`account/` 的 `subscriptions.ts`；ack / error → `lib/ws-client/protocol.ts` |
| `lib/session.ts` | `lib/session/token.ts` |
| `lib/format.ts` + 测试 | `lib/format/number.ts`、`time.ts` + 测试 |
| `lib/config.ts`、`lib/constants.ts` | `lib/config/env.ts`、`constants.ts` |
| `app/page.tsx` | `app/(home)/page.tsx` |
| `components/home/symbol-market-list.tsx` | `app/(home)/_ui-components/` |
| `components/trade/trade-view.tsx` | `app/trade/_ui-components/` |
| `components/layout/*`（4 个） | `app/_shared/ui-components/` |
| `components/common/login-dialog.tsx`、`liquidation-dialog.tsx` | `app/_shared/ui-components/` |
| `components/common/module-placeholder.tsx` | `components/module-placeholder.tsx` |

依赖方向（单向）：

```
app/<模块> ──► app/_shared ──► components
     │              │
     └──────────────┴──► hooks ──► stores ──► server-api-module ──► lib
```

- `app/<模块>` 之间不互相 import
- `app/_shared` 不 import 任何 `app/<模块>`
- `components/` 不 import `app/`、`stores/`、`server-api-module/`（通用组件只吃 props）
- `lib/` 不 import 以上任何一层

`providers/ws-bridge.tsx` 是接线层，可以 import 以上所有东西。

---

## 八、怎么做、怎么验

1. 用 `git mv` 搬文件，保留历史
2. 顺序：`lib/` 各组 → `server-api-module/` → `app/` 模块和 `components/` → 批量改 import → 删掉旧文件和空目录
3. `types.ts` 补注释，照服务端 `serialize.ts` 逐字段核对
4. 同步更新引用了旧路径的文档：`docs/frontend/README.md`（M00 表格、通用规则第 1 条）、`docs/design/05-frontend-design.md`
5. 验证（全部过才算完）：
   - `pnpm -F web check-types`（只看 web；native 本来就红，不管）
   - `pnpm -F web test`：现有 `api` / `format` / `ws-client` / `account-store` 测试全绿，数量不减
   - `pnpm -F web lint`
   - 起 dev server 打开首页和 `/trade/BTCUSDT`：币对列表、盘口、ticker 正常跳，连接状态显示"已连接"

**不做的事**：不改任何逻辑、不改接口形状、不加新功能。搬完以后功能和现在一模一样。

---

## 九、已定的选择（2026-09-19）

1. 加 `subscriptions.ts`（第四节）
2. `queries.ts` = 请求函数 + queryKey + `queryOptions`，不写 `useXxxQuery`
3. 模块跟服务端路由走：market / auth / account / order / position / leaderboard
4. 模块内组件目录叫 `_ui-components`，多模块共用的放 `app/_shared/ui-components/`
5. 首页用路由组 `(home)`
