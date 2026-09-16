# 01b · 搭建教程：杠杆分层表官方同步

> 第 01 讲的分层表是"拉一次、存进仓库、导入数据库"。这一讲把它换成：**server 每天用币安官方签名接口同步一次，写库前后各校验一次，币安调了表就留一份前后快照。**
> 数据源从"一个静态 JSON 文件"变成"一个每天会自己更新的外部接口"——难点不在调接口，而在**怎么保证一份坏数据永远进不了库**。

**这一讲结束时你会有什么**：

- `packages/db/src/brackets/`：签名客户端、校验、差异比较、同步编排，五个模块各管一件事
- 新表 `leverage_bracket_changes`（迁移 0002）：币安每次调表的前后整表快照
- 三个脚本：`sync:brackets`（可 `--dry-run`）、`verify:brackets`（对齐检查）、改过的 `seed:symbols`（按开放名单设置 `enabled`）
- `apps/server/src/jobs/bracket-sync.ts`：启动时跑一次，之后每天 UTC 00:05 跑一次
- 被删掉的：`seed/` 目录、`fetch:brackets`、`seed:brackets`

**先读**：

- `docs/design/01-domain-knowledge.md` 杠杆分层一节（速算额为什么让边界连续）
- `docs/design/03-database-design.md` 的 `leverage_brackets` 和 `leverage_bracket_changes` 两节
- 设计记录：`docs/superpowers/specs/2026-09-16-bracket-sync-design.md`

**本讲共 11 节，最后 db 包 6 个测试文件 51 条、server 1 个测试文件 9 条。**

> **代码已经在仓库里了**：讲义里每一段代码都是从仓库文件原样嵌入的。可以对照着读，也可以删掉自己敲一遍。

---

## 第 1 节：为什么换数据源

### 分层表的三代做法

| 时间 | 做法 | 问题 |
| --- | --- | --- |
| 设计之初 | 人工从币安页面抄进 JSON，季度复核 | 20 个币对 × 十几层，极易抄错；`verify:brackets` 只能查出**内部不连续**，查不出**整体抄错一档** |
| 第 01 讲 | `fetch:brackets` 调币安网页端 bapi，写进 JSON | 消除了抄写错误，但 bapi **不在官方文档里**，随时可能改结构或下线 |
| 本讲 | server 每天调官方签名接口 `GET /fapi/v1/leverageBracket` | 需要一把只读 API Key |

2026-09-16 实测：20 个开放币对，官方接口、bapi、仓库 JSON 三方逐层比对 **0 差异**。数据本身没问题，那为什么还要换？

**因为要"每天自动跑"。** 手动跑一次的脚本依赖一个非官方接口，挂了你当场就能看到；常驻服务里的定时任务依赖它，挂了可能几天没人发现。**自动化的东西必须站在有文档、有变更公告的接口上。**

### 为什么"校验通过就自动写库"

另一个选项是"只报告差异，人工确认后再写"。没选它，是因为**币安调表后，已有仓位立刻按新表算维持保证金**。我们晚一天跟进，模拟盘的强平价就和真实世界错一天。自动写库和真实行为一致；而"数据可能是坏的"这个风险，交给校验来挡，不交给人来挡。

---

## 第 2 节：准备只读 API Key

1. 币安 → API 管理 → 创建 API（系统生成）
2. **权限只勾「允许读取」**，交易、提现一律不开
3. 建议绑定 IP 白名单（本机或服务器的出口 IP）
4. 写进 `apps/server/.env`：

```bash
BINANCE_API_KEY=你的 Key
BINANCE_SECRET_KEY=你的 Secret
```

`apps/server/.env.schema` 里这两个变量已经声明为必填、敏感：

```bash
# @type=string(minLength=1)
BINANCE_API_KEY=

# @type=string(minLength=1)
BINANCE_SECRET_KEY=
```

db 包的脚本也要用到它们。db 包自己的 `.env.schema` 是从 server 那边 `@import` 过来的，把 `BINANCE_*` 加进 `pick`：

```bash
# @import(../../apps/server/, pick=[NODE_ENV, DATABASE_*, BINANCE_*])
# @generateTsTypes(path=./src/env.ts, exposeEnv=local)
# ---
```

改完跑一次类型生成，`src/env.ts` 里的 `ENV` 就有了这两个字段：

```bash
cd packages/db && pnpm exec varlock codegen
```

> ⚠️ **这把 Key 只在服务端用。** 它不进前端、不进 App、不进日志。用户用模拟盘完全不需要 Key——他们读的是我们数据库里的表。

---

## 第 3 节：模块全景

### 为什么拆成五个文件

同步这件事可以写成一个 150 行的函数：拉数据、校验、比较、写库、打日志一路下来。但那样的函数**没法测**——想测"浮点尾巴会被拒绝"，你得准备数据库、准备假网络、跑完整流程。

拆开之后，**越容易出错的部分越纯**：

| 文件 | 职责 | 副作用 | 测试方式 |
| --- | --- | --- | --- |
| `types.ts` | `BracketRow`：一层分层数据的字符串形态 | 无 | — |
| `open-symbols.ts` | 开放名单 | 无 | 纯单测 |
| `binance-client.ts` | 签名、请求、错误码翻译 | 网络（`fetch` 可注入） | 假 fetch |
| `normalize.ts` | 官方数据 → `BracketRow[]` + 全部校验规则 | **纯** | 纯单测 |
| `diff.ts` | 两张表逐层比较 | **纯** | 纯单测 |
| `sync.ts` | 编排：读库 → 拉取 → 校验 → 比较 → 写库 → 读回 | 数据库 | 本地库 + 回滚事务 |

### 数据流

```
读 symbols where enabled = true
  │
  ▼
拉官方全量（一次请求返回全部 ~1000 个币对）
  │
  ▼
逐个开放币对 normalize ──── 任何一个不过 / 官方缺了某个 ──► 整次中止，不写库
  │
  ▼
和库里 diff ──── 全都没变 ──► 结束，什么都不写
  │
  ▼
dryRun? ──── 是 ──► 返回报告结束
  │
  ▼
一个事务：变化的币对 delete + insert，每个写一条变更快照
  │
  ▼
读回来和官方再比一次 ──── 不一致 ──► 抛错
```

---

## 第 4 节：`types.ts` 与开放名单

### 概念：分层数据为什么用字符串

数据库里分层表是 `bigint`（定标 1e8），引擎里也是 `bigint`。但同步流程里这份数据要进 **jsonb**（变更快照）、要打日志、要做报告——硬约束第 4 条：**bigint 不许直接进 JSON**。所以同步流程内部统一用十进制字符串，写库时才 `parse()`。

### 动手

创建 `packages/db/src/brackets/types.ts`：

```ts
/**
 * 分层表的一层，数值用十进制字符串。
 *
 * 为什么不直接用 bigint：这个形状要进 JSON（变更记录的 jsonb、日志、报告），
 * 而 bigint 不许直接进 JSON。需要算的时候再用 shared 的 parse() 转成 Fixed。
 */
export interface BracketRow {
  bracket: number; // 层号，从 1 开始
  notionalFloor: string; // 名义价值下限
  notionalCap: string; // 名义价值上限
  maxLeverage: number; // 这一层允许的最大杠杆（整数倍数，不是金额）
  mmr: string; // 维持保证金率，小数形式："0.004" 即 0.4%
  cum: string; // 速算额
}
```

以前开放哪 20 个币对写死在 `fetch-brackets.ts` 的 `DEFAULT_SYMBOLS` 里，而 `symbols.enabled` 一个都没开——**两处来源，迟早对不上**。现在名单收进一个文件，`seed:symbols` 按它设置 `enabled`，同步只认 `enabled`，数据库就是唯一的真相。

创建 `packages/db/src/brackets/open-symbols.ts`：

```ts
/**
 * 对用户开放的币对，数组顺序就是前端列表的展示顺序。
 *
 * `seed:symbols` 按这份名单设置 `symbols.enabled` 和 `sortOrder`；分层表同步只处理
 * `enabled = true` 的币对。要开放或下架一个币对：改这里 → 跑 `seed:symbols` →
 * 跑 `sync:brackets`（或等 server 下一次每日同步）。
 */
export const OPEN_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "SUIUSDT",
  "TONUSDT",
  "FILUSDT",
] as const;

/** 某个币对的运营字段：在名单里就开放，排序从 1 开始；不在名单里就关闭、排序归 0。 */
export function openSymbolSetting(symbol: string): { enabled: boolean; sortOrder: number } {
  const index = (OPEN_SYMBOLS as readonly string[]).indexOf(symbol);
  return index === -1 ? { enabled: false, sortOrder: 0 } : { enabled: true, sortOrder: index + 1 };
}
```

测试 `packages/db/src/brackets/open-symbols.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { OPEN_SYMBOLS, openSymbolSetting } from "./open-symbols";

describe("openSymbolSetting", () => {
  it("名单里的币对开放，排序从 1 开始按名单顺序", () => {
    expect(openSymbolSetting("BTCUSDT")).toEqual({ enabled: true, sortOrder: 1 });
    expect(openSymbolSetting("ETHUSDT")).toEqual({ enabled: true, sortOrder: 2 });
  });

  it("名单外的币对关闭，排序归 0", () => {
    expect(openSymbolSetting("PEPEUSDT")).toEqual({ enabled: false, sortOrder: 0 });
  });

  it("名单 20 个且没有重复", () => {
    expect(OPEN_SYMBOLS).toHaveLength(20);
    expect(new Set(OPEN_SYMBOLS).size).toBe(20);
  });
});
```

---

## 第 5 节：签名客户端——`binance-client.ts`

### 概念：币安的签名是怎么回事

签名接口要证明两件事：**请求是持有 Secret 的人发的**，**请求没被篡改、也不是旧请求重放**。做法：

1. 查询串里带上 `timestamp`（毫秒）和 `recvWindow`（允许的时间偏差）
2. 用 Secret 对**整个查询串**做 HMAC-SHA256，得到十六进制的 `signature`，拼到查询串末尾
3. API Key 放在请求头 `X-MBX-APIKEY`

服务器用同一个 Secret 重算一遍比对。时间戳超出 `recvWindow` 就拒绝——所以**本机时钟不准也会失败**（错误码 `-1021`）。

### 为什么 `fetch` 和时钟都能注入

签名结果依赖时间戳。不注入时钟，测试每次跑的签名都不一样，只能断言"有个 signature"，断言不了"signature 是对的"。注入之后，时间固定为 `1_700_000_000_000`，签名就是确定的值。

**签名算法本身用币安官方文档里的示例向量测**——这是独立于我们代码的第二条路径：我们的 `sign()` 算出和文档一样的结果，才说明算法没写错。

### 动手

创建 `packages/db/src/brackets/binance-client.ts`：

```ts
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
```

几个细节：

- **先 `text()` 再 `JSON.parse`**：出错时币安可能返回 HTML（地区限制等），直接 `res.json()` 会抛一个看不懂的解析错误，把原始错误信息吞掉。
- **错误码翻译成排查方向**：`-2015` 是最常见的——Key 不对、IP 不在白名单、没开读取权限，三者返回同一个码。
- **返回不是数组就抛错**：这个函数不做业务校验，但结构不对连往下传的资格都没有。

测试 `packages/db/src/brackets/binance-client.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { BinanceApiError, createBracketFetcher, sign } from "./binance-client";

describe("sign", () => {
  it("和币安官方文档的 HMAC-SHA256 示例一致", () => {
    // 来源：币安 API 文档「SIGNED (TRADE and USER_DATA) Endpoint Examples」
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const query =
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(sign(query, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });
});

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(status: number, body: unknown, captured: Captured[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify(body), { status, statusText: `status ${status}` });
  }) as typeof fetch;
}

describe("createBracketFetcher", () => {
  const base = { apiKey: "test-key", secretKey: "test-secret", now: () => 1_700_000_000_000 };

  it("带上 API Key 头、时间戳、recvWindow 和签名去请求官方接口", async () => {
    const captured: Captured[] = [];
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, [], captured) });

    await fetchBrackets();

    expect(captured).toHaveLength(1);
    const req = captured[0];
    if (!req) throw new Error("no request captured");
    expect(req.headers["x-mbx-apikey"]).toBe("test-key");

    const url = new URL(req.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://fapi.binance.com/fapi/v1/leverageBracket");
    expect(url.searchParams.get("timestamp")).toBe("1700000000000");
    expect(url.searchParams.get("recvWindow")).toBe("10000");
    const unsigned = `timestamp=1700000000000&recvWindow=10000`;
    expect(url.searchParams.get("signature")).toBe(sign(unsigned, "test-secret"));
  });

  it("原样返回官方数组", async () => {
    const payload = [{ symbol: "BTCUSDT", brackets: [] }];
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, payload) });
    await expect(fetchBrackets()).resolves.toEqual(payload);
  });

  it("非 200 时抛 BinanceApiError，带上币安错误码和排查提示", async () => {
    const fetchBrackets = createBracketFetcher({
      ...base,
      fetch: fakeFetch(401, { code: -2015, msg: "Invalid API-key, IP, or permissions for action." }),
    });

    const err = await fetchBrackets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BinanceApiError);
    expect(err).toMatchObject({ status: 401, code: -2015 });
    expect((err as Error).message).toMatch(/IP 白名单/);
  });

  it("时间戳偏差给出对应提示", async () => {
    const fetchBrackets = createBracketFetcher({
      ...base,
      fetch: fakeFetch(400, { code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }),
    });
    await expect(fetchBrackets()).rejects.toThrow(/本机时间/);
  });

  it("返回不是数组时抛错，而不是把烂数据往下传", async () => {
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, { brackets: [] }) });
    await expect(fetchBrackets()).rejects.toThrow(/不是数组/);
  });

  it("Key 为空时在发请求之前就报错", () => {
    expect(() => createBracketFetcher({ ...base, apiKey: "" })).toThrow(/BINANCE_API_KEY/);
    expect(() => createBracketFetcher({ ...base, secretKey: "" })).toThrow(/BINANCE_SECRET_KEY/);
  });
});
```

---

## 第 6 节：校验——`normalize.ts`

### 概念：三类坏数据

这是整讲最重要的文件。能进库的数据必须挡住三类问题：

**① 数值表示问题。** 官方返回的是 JSON number，经过 JS 就是 double。`0.1 + 0.2` 会变成 `0.30000000000000004`，大数会变成 `1e+21`。而 shared 的 `parse()` 遇到超过 8 位小数会**静默截断**——一个被悄悄抹平的小数位，会变成所有强平价上查不出来的系统性偏差。所以 `toDecimalString` **宁可抛错也不四舍五入**。

**② 结构问题。** 逐条规则：

| 规则 | 挡住什么 |
| --- | --- |
| 层号从 1 连续 | 漏层、重复层 |
| 第 1 层下限 = 0 | 名义价值很小的仓位找不到所在层 |
| 每层下限 = 上层上限 | 层与层之间有缝隙或重叠 |
| 上限 > 下限 | 空层 |
| 最大杠杆是正整数且逐层不增 | 仓位越大反而允许越高杠杆 |
| mmr 在 (0, 1) 且逐层不减 | 仓位越大反而要求越少维持保证金 |
| 速算额 ≥ 0 | 数据错位 |
| 边界上维持保证金连续 | 速算额和 mmr 对不上 |

**③ 语义问题：`notionalCoef`。** 币安会给个别账户单独调整分层（比如大户），这时返回里会带 `notionalCoef`（≠ 1）。那份表是"这个账户的"，不是"公开的"——拿它当所有模拟用户的标准就错了。所以遇到直接拒绝。

### 为什么校验函数单独拆出 `validateBracketRows`

同样的结构规则要用在两个地方：官方数据写库前，和数据库里的数据核对时（`verify:brackets`）。前者输入是 JSON number，后者是 bigint——**统一到 `BracketRow` 之后只写一份规则**。

### 动手

创建 `packages/db/src/brackets/normalize.ts`：

```ts
import { mul, parse, SCALE } from "@binance-contract-trading-full-stack/shared";
import type { BracketRow } from "./types";

/** 官方 GET /fapi/v1/leverageBracket 返回里的一层。 */
export interface OfficialBracket {
  bracket: number;
  initialLeverage: number;
  notionalCap: number;
  notionalFloor: number;
  maintMarginRatio: number;
  cum: number;
}

/** 官方返回数组里的一个币对。`notionalCoef` 只在账户被个性化调整时出现。 */
export interface OfficialSymbolBrackets {
  symbol: string;
  notionalCoef?: number;
  brackets: OfficialBracket[];
}

/**
 * JSON 数值 → 定标 1e8 能精确表示的十进制字符串。
 *
 * 币安返回的是 JSON number，经过 JS 浮点后可能带上 0.012500000000000001 这种尾巴，
 * 大数或极小数也可能被 String() 写成科学计数法。这些情况一律抛错而不是四舍五入——
 * shared 的 parse() 遇到超过 8 位小数会静默截断，一个被悄悄抹平的小数位，
 * 会变成所有强平价上一个查不出来的系统性偏差。
 */
export function toDecimalString(value: unknown, symbol: string, field: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${symbol} 的 ${field} 不是有限数：${String(value)}`);
  }
  const s = String(value);
  if (s.includes("e") || s.includes("E")) {
    throw new Error(`${symbol} 的 ${field} 是科学计数法，无法安全转成定标值：${s}`);
  }
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > 8) {
    throw new Error(
      `${symbol} 的 ${field} 小数位超过 8（定标 1e8 存不下）：${s}。这多半是浮点误差，需要人工确认。`,
    );
  }
  return s;
}

export interface ContinuityResult {
  ok: boolean;
  mismatches: { atBracket: number }[];
}

/**
 * 相邻两层在边界上的维持保证金必须相等。
 *
 * 维持保证金 = 名义价值 × mmr − cum。名义价值正好等于下层上限时，按下层算和按上层算
 * 应该得到同一个数，否则仓位刚跨过边界，维持保证金会凭空阶跃。
 */
export function checkContinuity(rows: BracketRow[]): ContinuityResult {
  const mismatches: { atBracket: number }[] = [];

  for (let i = 0; i < rows.length - 1; i++) {
    const lower = rows[i];
    const upper = rows[i + 1];
    if (!lower || !upper) continue;

    const n = parse(lower.notionalCap);
    const mmLower = mul(n, parse(lower.mmr)) - parse(lower.cum);
    const mmUpper = mul(n, parse(upper.mmr)) - parse(upper.cum);

    if (mmLower !== mmUpper) {
      mismatches.push({ atBracket: lower.bracket });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * 校验一整张分层表的结构。官方数据写库前、数据库里的数据核对时都走这一个函数。
 *
 * 期望 rows 已按层号升序。任何一条不满足就抛错，错误信息指到具体币对、具体层。
 */
export function validateBracketRows(symbol: string, rows: BracketRow[]): void {
  if (rows.length === 0) {
    throw new Error(`${symbol} 没有分层数据`);
  }

  rows.forEach((row, i) => {
    const at = `${symbol} 第 ${row.bracket} 层`;
    const prev = rows[i - 1];

    if (row.bracket !== i + 1) {
      throw new Error(`${symbol} 的层号不连续：第 ${i + 1} 个位置是第 ${row.bracket} 层`);
    }

    const floor = parse(row.notionalFloor);
    const cap = parse(row.notionalCap);
    if (!prev && floor !== 0n) {
      throw new Error(`${symbol} 第 1 层的下限应该是 0，实际是 ${row.notionalFloor}`);
    }
    if (prev && floor !== parse(prev.notionalCap)) {
      throw new Error(`${at}的下限 ${row.notionalFloor} 没有接上上一层的上限 ${prev.notionalCap}`);
    }
    if (cap <= floor) {
      throw new Error(`${at}的上限必须大于下限：${row.notionalFloor} → ${row.notionalCap}`);
    }

    if (!Number.isInteger(row.maxLeverage) || row.maxLeverage < 1) {
      throw new Error(`${at}的最大杠杆异常：${row.maxLeverage}`);
    }
    const mmr = parse(row.mmr);
    if (mmr <= 0n || mmr >= SCALE) {
      throw new Error(`${at}的维持保证金率应该在 (0, 1) 之间，实际是 ${row.mmr}`);
    }

    if (prev && row.maxLeverage > prev.maxLeverage) {
      throw new Error(`${at}的杠杆不应高于上一层：${prev.maxLeverage} → ${row.maxLeverage}`);
    }
    if (prev && mmr < parse(prev.mmr)) {
      throw new Error(`${at}的维持保证金率不应低于上一层：${prev.mmr} → ${row.mmr}`);
    }

    if (parse(row.cum) < 0n) {
      throw new Error(`${at}的速算额不应为负：${row.cum}`);
    }
  });

  const continuity = checkContinuity(rows);
  if (!continuity.ok) {
    throw new Error(
      `${symbol} 的分层表连续性校验不通过，边界不连续的层：${continuity.mismatches
        .map((m) => m.atBracket)
        .join(", ")}`,
    );
  }
}

/** 官方返回的一个币对 → 校验过的 BracketRow[]。任何异常都抛错，绝不返回半对的数据。 */
export function normalizeSymbolBrackets(entry: OfficialSymbolBrackets): BracketRow[] {
  const { symbol } = entry;

  if (entry.notionalCoef !== undefined && entry.notionalCoef !== 1) {
    throw new Error(
      `${symbol} 返回了 notionalCoef=${entry.notionalCoef}：这个账户的分层被个性化调整过，不是公开表，不能用`,
    );
  }
  if (!Array.isArray(entry.brackets) || entry.brackets.length === 0) {
    throw new Error(`${symbol} 没有分层数据`);
  }

  const rows = [...entry.brackets]
    .sort((a, b) => a.bracket - b.bracket)
    .map(
      (b): BracketRow => ({
        bracket: b.bracket,
        notionalFloor: toDecimalString(b.notionalFloor, symbol, "notionalFloor"),
        notionalCap: toDecimalString(b.notionalCap, symbol, "notionalCap"),
        maxLeverage: b.initialLeverage,
        mmr: toDecimalString(b.maintMarginRatio, symbol, "mmr"),
        cum: toDecimalString(b.cum, symbol, "cum"),
      }),
    );

  validateBracketRows(symbol, rows);
  return rows;
}
```

注意规则的**检查顺序**：单层自身的（杠杆、mmr 范围）→ 和上一层比较的（杠杆不增、mmr 不减）→ 速算额 → 最后整表连续性。顺序决定报错信息指向哪里：一张 mmr 下降的表，边界多半也不连续，先报"mmr 下降"比先报"不连续"更接近病根。

测试 `packages/db/src/brackets/normalize.test.ts`——**每条规则至少一个失败用例**：

```ts
import { describe, expect, it } from "vitest";
import {
  checkContinuity,
  normalizeSymbolBrackets,
  toDecimalString,
  type OfficialBracket,
  type OfficialSymbolBrackets,
} from "./normalize";

/**
 * 形状照抄官方 GET /fapi/v1/leverageBracket 的返回。
 * 数值是自洽的示例（边界上维持保证金相等），不是币安当前的真实表——
 * 真实表会变，测试不跟着它走。
 */
function officialBTC(): OfficialSymbolBrackets {
  return {
    symbol: "BTCUSDT",
    brackets: [
      { bracket: 1, initialLeverage: 150, notionalCap: 300000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
      { bracket: 2, initialLeverage: 100, notionalCap: 800000, notionalFloor: 300000, maintMarginRatio: 0.005, cum: 300 },
      { bracket: 3, initialLeverage: 75, notionalCap: 3000000, notionalFloor: 800000, maintMarginRatio: 0.0065, cum: 1500 },
    ],
  };
}

function withBracket(index: number, patch: Partial<OfficialBracket>): OfficialSymbolBrackets {
  const entry = officialBTC();
  const target = entry.brackets[index];
  if (!target) throw new Error("fixture index out of range");
  entry.brackets[index] = { ...target, ...patch };
  return entry;
}

describe("toDecimalString", () => {
  it("整数和普通小数原样转成字符串", () => {
    expect(toDecimalString(300000, "BTCUSDT", "notionalCap")).toBe("300000");
    expect(toDecimalString(0.004, "BTCUSDT", "mmr")).toBe("0.004");
    expect(toDecimalString(0, "BTCUSDT", "cum")).toBe("0");
  });

  it("超过 8 位小数（浮点尾巴）直接拒绝，不悄悄截断", () => {
    // 0.1 + 0.2 === 0.30000000000000004，典型的浮点尾巴
    expect(() => toDecimalString(0.1 + 0.2, "BTCUSDT", "mmr")).toThrow(/小数位超过 8/);
    expect(() => toDecimalString(0.123456789, "BTCUSDT", "mmr")).toThrow(/小数位超过 8/);
  });

  it("科学计数法拒绝", () => {
    expect(() => toDecimalString(1e21, "BTCUSDT", "notionalCap")).toThrow(/科学计数法/);
    expect(() => toDecimalString(1e-9, "BTCUSDT", "mmr")).toThrow(/科学计数法/);
  });

  it("非数字、NaN、Infinity 拒绝", () => {
    expect(() => toDecimalString("0.004", "BTCUSDT", "mmr")).toThrow(/不是有限数/);
    expect(() => toDecimalString(Number.NaN, "BTCUSDT", "mmr")).toThrow(/不是有限数/);
    expect(() => toDecimalString(Number.POSITIVE_INFINITY, "BTCUSDT", "mmr")).toThrow(/不是有限数/);
  });
});

describe("normalizeSymbolBrackets", () => {
  it("把官方返回转成按层号升序的 BracketRow[]", () => {
    const rows = normalizeSymbolBrackets(officialBTC());
    expect(rows).toEqual([
      { bracket: 1, notionalFloor: "0", notionalCap: "300000", maxLeverage: 150, mmr: "0.004", cum: "0" },
      { bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300" },
      { bracket: 3, notionalFloor: "800000", notionalCap: "3000000", maxLeverage: 75, mmr: "0.0065", cum: "1500" },
    ]);
  });

  it("返回顺序打乱时按层号排好", () => {
    const entry = officialBTC();
    entry.brackets.reverse();
    expect(normalizeSymbolBrackets(entry).map((r) => r.bracket)).toEqual([1, 2, 3]);
  });

  it("notionalCoef 为 1 视为公开表，放行", () => {
    expect(() => normalizeSymbolBrackets({ ...officialBTC(), notionalCoef: 1 })).not.toThrow();
  });

  it("notionalCoef ≠ 1 说明账户被个性化调整，拒绝", () => {
    expect(() => normalizeSymbolBrackets({ ...officialBTC(), notionalCoef: 1.5 })).toThrow(/notionalCoef/);
  });

  it("空分层表拒绝", () => {
    expect(() => normalizeSymbolBrackets({ symbol: "BTCUSDT", brackets: [] })).toThrow(/没有分层/);
  });

  it("层号不连续拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(2, { bracket: 4 }))).toThrow(/层号不连续/);
  });

  it("第 1 层下限不是 0 拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { notionalFloor: 10 }))).toThrow(/第 1 层的下限/);
  });

  it("下限和上一层上限接不上拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { notionalFloor: 250000 }))).toThrow(/没有接上/);
  });

  it("上限不大于下限拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(2, { notionalCap: 800000 }))).toThrow(/上限必须大于下限/);
  });

  it("最大杠杆不是正整数拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { initialLeverage: 0 }))).toThrow(/最大杠杆/);
    expect(() => normalizeSymbolBrackets(withBracket(0, { initialLeverage: 12.5 }))).toThrow(/最大杠杆/);
  });

  it("最大杠杆逐层上升拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { initialLeverage: 200 }))).toThrow(/杠杆不应高于上一层/);
  });

  it("维持保证金率逐层下降拒绝", () => {
    // 同时调 cum 让边界仍然连续，确保是"mmr 下降"这条规则在起作用
    expect(() =>
      normalizeSymbolBrackets(withBracket(1, { maintMarginRatio: 0.003, cum: -300 })),
    ).toThrow(/维持保证金率不应低于上一层/);
  });

  it("维持保证金率不在 (0, 1) 拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { maintMarginRatio: 0 }))).toThrow(/维持保证金率/);
  });

  it("速算额为负拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(0, { cum: -1 }))).toThrow(/速算额/);
  });

  it("边界上维持保证金不连续拒绝", () => {
    expect(() => normalizeSymbolBrackets(withBracket(1, { cum: 301 }))).toThrow(/连续性/);
  });
});

describe("checkContinuity", () => {
  it("连续的表通过", () => {
    expect(checkContinuity(normalizeSymbolBrackets(officialBTC()))).toEqual({ ok: true, mismatches: [] });
  });

  it("报告出不连续的那一层", () => {
    const rows = normalizeSymbolBrackets(officialBTC());
    const broken = rows.map((r) => (r.bracket === 3 ? { ...r, cum: "1499" } : r));
    expect(checkContinuity(broken)).toEqual({ ok: false, mismatches: [{ atBracket: 2 }] });
  });
});
```

> **练习**：把 `validateBracketRows` 里"mmr 不减"那条规则注释掉，跑测试，看哪条变红。再想一想：如果连这条测试也一起删掉，还有什么能挡住一张 mmr 下降但边界连续的表？（答案：没有。这就是"每条规则至少一个失败用例"的意义。）

---

## 第 7 节：差异——`diff.ts`

### 概念：按数值比，不按字符串比

数据库读出来的 `300000n` 格式化后是 `"300000.00000000"`，官方来的是 `"300000"`。按字符串比，每次同步都会认为"全变了"，每天写一遍库、每天多一条假的变更快照。所以 `diff` 里除了杠杆（本来就是整数），一律 `parse()` 成 Fixed 再比。

### 动手

创建 `packages/db/src/brackets/diff.ts`：

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";
import type { BracketRow } from "./types";

const COMPARED_FIELDS = ["notionalFloor", "notionalCap", "maxLeverage", "mmr", "cum"] as const;

export type BracketField = (typeof COMPARED_FIELDS)[number];

export type BracketChange =
  | { bracket: number; kind: "added"; after: BracketRow }
  | { bracket: number; kind: "removed"; before: BracketRow }
  | {
      bracket: number;
      kind: "changed";
      fields: { field: BracketField; before: string; after: string }[];
    };

/** 按数值比较：数据库读出来的 "300000.00000000" 和官方的 "300000" 是同一个数。 */
function sameValue(field: BracketField, a: BracketRow, b: BracketRow): boolean {
  if (field === "maxLeverage") return a.maxLeverage === b.maxLeverage;
  return parse(a[field]) === parse(b[field]);
}

/** 旧表 → 新表的逐层差异。两张表完全一致时返回空数组。 */
export function diffBrackets(before: BracketRow[], after: BracketRow[]): BracketChange[] {
  const beforeByBracket = new Map(before.map((r) => [r.bracket, r]));
  const afterByBracket = new Map(after.map((r) => [r.bracket, r]));
  const allBrackets = [...new Set([...beforeByBracket.keys(), ...afterByBracket.keys()])].sort(
    (a, b) => a - b,
  );

  const changes: BracketChange[] = [];
  for (const bracket of allBrackets) {
    const b = beforeByBracket.get(bracket);
    const a = afterByBracket.get(bracket);

    if (!b && a) {
      changes.push({ bracket, kind: "added", after: a });
    } else if (b && !a) {
      changes.push({ bracket, kind: "removed", before: b });
    } else if (b && a) {
      const fields = COMPARED_FIELDS.filter((f) => !sameValue(f, b, a)).map((field) => ({
        field,
        before: String(b[field]),
        after: String(a[field]),
      }));
      if (fields.length > 0) {
        changes.push({ bracket, kind: "changed", fields });
      }
    }
  }
  return changes;
}

const FIELD_LABELS: Record<BracketField, string> = {
  notionalFloor: "下限",
  notionalCap: "上限",
  maxLeverage: "最大杠杆",
  mmr: "维持保证金率",
  cum: "速算额",
};

/** 一条变更的人话描述，给脚本输出和 server 日志用。 */
export function describeBracketChange(change: BracketChange): string {
  switch (change.kind) {
    case "added":
      return `第 ${change.bracket} 层新增（上限 ${change.after.notionalCap}，${change.after.maxLeverage}x，mmr ${change.after.mmr}）`;
    case "removed":
      return `第 ${change.bracket} 层删除`;
    case "changed":
      return `第 ${change.bracket} 层 ${change.fields
        .map((f) => `${FIELD_LABELS[f.field]} ${f.before} → ${f.after}`)
        .join("，")}`;
  }
}
```

`BracketChange` 是一个**可辨识联合**：`added` 只有 `after`，`removed` 只有 `before`，`changed` 只有 `fields`。`describeBracketChange` 里的 `switch` 不需要 `default`——三种情况穷尽了，漏写一种编译器会报"函数缺少返回值"。

测试 `packages/db/src/brackets/diff.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { describeBracketChange, diffBrackets } from "./diff";
import type { BracketRow } from "./types";

const TABLE: BracketRow[] = [
  { bracket: 1, notionalFloor: "0", notionalCap: "300000", maxLeverage: 150, mmr: "0.004", cum: "0" },
  { bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300" },
];

describe("diffBrackets", () => {
  it("完全相同返回空数组", () => {
    expect(diffBrackets(TABLE, structuredClone(TABLE))).toEqual([]);
  });

  it("按数值比较，不按字符串：'300000' 和 '300000.00000000' 视为相同", () => {
    const padded = TABLE.map((r) => ({ ...r, notionalCap: `${r.notionalCap}.00000000` }));
    expect(diffBrackets(TABLE, padded)).toEqual([]);
  });

  it("列出变化的层和字段，带前后值", () => {
    const after = TABLE.map((r) =>
      r.bracket === 2 ? { ...r, maxLeverage: 75, cum: "350" } : r,
    );
    expect(diffBrackets(TABLE, after)).toEqual([
      {
        bracket: 2,
        kind: "changed",
        fields: [
          { field: "maxLeverage", before: "100", after: "75" },
          { field: "cum", before: "300", after: "350" },
        ],
      },
    ]);
  });

  it("新增的层标为 added", () => {
    const extra: BracketRow = {
      bracket: 3, notionalFloor: "800000", notionalCap: "3000000", maxLeverage: 75, mmr: "0.0065", cum: "1500",
    };
    expect(diffBrackets(TABLE, [...TABLE, extra])).toEqual([{ bracket: 3, kind: "added", after: extra }]);
  });

  it("消失的层标为 removed", () => {
    expect(diffBrackets(TABLE, TABLE.slice(0, 1))).toEqual([
      { bracket: 2, kind: "removed", before: TABLE[1] },
    ]);
  });

  it("旧表为空（首次导入）时每层都是 added", () => {
    expect(diffBrackets([], TABLE).map((c) => c.kind)).toEqual(["added", "added"]);
  });
});

describe("describeBracketChange", () => {
  it("三种变更都能说成人话", () => {
    const second = TABLE[1];
    if (!second) throw new Error("fixture");
    expect(describeBracketChange({ bracket: 2, kind: "removed", before: second })).toBe("第 2 层删除");
    expect(describeBracketChange({ bracket: 2, kind: "added", after: second })).toBe(
      "第 2 层新增（上限 800000，100x，mmr 0.005）",
    );
    expect(
      describeBracketChange({
        bracket: 1,
        kind: "changed",
        fields: [
          { field: "maxLeverage", before: "150", after: "125" },
          { field: "cum", before: "0", after: "10" },
        ],
      }),
    ).toBe("第 1 层 最大杠杆 150 → 125，速算额 0 → 10");
  });
});
```

---

## 第 8 节：变更快照表与迁移

### 概念：为什么需要这张表

以前分层表在仓库的 JSON 里，币安哪天调了什么，`git log` 能告诉你。现在数据直接从接口进数据库，**git 历史里没有它了**。排查"这个仓位的强平价为什么昨天和今天不一样"时，需要一个地方回答"那几天分层表变过吗"。

存**整表快照**而不是逐字段差异：想看"当时的表长什么样"直接取 `after`；差异随时能用 `diffBrackets(before, after)` 重算。反过来，只存差异的话，要还原某天的整表得从头重放。

### 动手

创建 `packages/db/src/schema/leverage-bracket-changes.ts`：

```ts
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BracketRow } from "../brackets/types";
import { symbols } from "./symbols";

/**
 * 杠杆分层表变更记录 —— 每日同步发现币安调了表，就在这里留一份前后整表快照。
 *
 * 分层表不再进版本库（数据直接从官方签名接口同步进 `leverage_brackets`），git 历史
 * 追溯不到"币安哪天调了什么"，这张表补上这一环：排查"为什么这个仓位的强平价昨天
 * 和今天不一样"时，先来这里看那段时间分层表有没有变。
 *
 * 存整表快照而不是逐字段差异：想知道"当时的表长什么样"可以直接取，差异随时能用
 * `diffBrackets(before, after)` 重新算。数值是十进制字符串（bigint 不进 JSON）。
 *
 * 只追加，不更新不删除。同步时没有变化就不写。
 */
export const leverageBracketChanges = pgTable(
  "leverage_bracket_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    before: jsonb("before").$type<BracketRow[]>().notNull(), // 变更前整表；首次导入为 []
    after: jsonb("after").$type<BracketRow[]>().notNull(), // 变更后整表
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lbc_symbol_changed_idx").on(t.symbol, t.changedAt.desc())],
);

export type LeverageBracketChange = typeof leverageBracketChanges.$inferSelect;
export type NewLeverageBracketChange = typeof leverageBracketChanges.$inferInsert;
```

在 `packages/db/src/schema/index.ts` 的"市场规格"组里导出它：

```ts
export * from "./enums";

// 市场规格
export * from "./leverage-bracket-changes";
export * from "./leverage-brackets";
export * from "./symbols";

// 账户
export * from "./account-symbol-settings";
export * from "./accounts";
export * from "./auth-nonces";

// 交易
export * from "./fills";
export * from "./orders";
export * from "./positions";

// 账目
export * from "./equity-snapshots";
export * from "./funding-payments";
export * from "./ledger-entries";
export * from "./liquidations";

// 练手表，与业务无关
export * from "./books";
```

生成并应用迁移：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run db:generate
pnpm --filter @binance-contract-trading-full-stack/db run db:migrate
```

生成的 `packages/db/src/migrations/0002_faithful_black_widow.sql`（文件名里的随机词每个人不一样）：

```sql
CREATE TABLE "leverage_bracket_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leverage_bracket_changes" ADD CONSTRAINT "leverage_bracket_changes_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lbc_symbol_changed_idx" ON "leverage_bracket_changes" USING btree ("symbol","changed_at" DESC NULLS LAST);
```

**检查一下这份 SQL 只有 `CREATE TABLE` / `ADD CONSTRAINT` / `CREATE INDEX`**，没有任何 `DROP`。本地库和别的项目共用，用 `db:migrate` 而不是 `db:push`——`push` 会拿 schema 和整个库比对，可能提议删掉不属于本项目的表。

同时更新 `leverage_brackets` 的表注释，说明数据来源变了：

```ts
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { symbols } from "./symbols";

/**
 * 杠杆分层表 —— 强平价公式的输入，全库最不能出错的一张表。
 *
 * 币安的维持保证金率不是固定值，而是随仓位名义价值分层递增：仓位越大，要求的维持保证金
 * 率越高、允许的最大杠杆越低。维持保证金 = 名义价值 × mmr − cum，`cum`（速算额）是为了
 * 让相邻两层在边界上连续（否则名义价值刚跨过边界，维持保证金会阶跃）。
 *
 * 数据来自币安官方签名接口 `GET /fapi/v1/leverageBracket`（只读 API Key，仅在服务端使用），
 * 由 `brackets/sync.ts` 同步：server 每天 UTC 00:05 自动跑，也可以手动 `sync:brackets`。
 * **不允许手写或让 AI 生成这里的数字**——抄错一档不会破坏连续性，却会让这个币对的所有
 * 强平价系统性偏移。写库前后各校验一次，随时可以 `verify:brackets` 核对库里和官方是否一致。
 *
 * 写入频率：每日同步，币安没调表就不写。每次变化在 `leverage_bracket_changes` 留前后快照。
 */
export const leverageBrackets = pgTable(
  "leverage_brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    bracket: integer("bracket").notNull(), // 层号，从 1 开始，层号越大杠杆上限越低
    notionalFloor: bigint("notional_floor", { mode: "bigint" }).notNull(), // 这一层的名义价值下限
    notionalCap: bigint("notional_cap", { mode: "bigint" }).notNull(), // 这一层的名义价值上限
    maxLeverage: integer("max_leverage").notNull(), // 这一层允许的最大杠杆倍数
    mmr: bigint("mmr", { mode: "bigint" }).notNull(), // 维持保证金率，定标 1e8，如 0.4% 存 400000n
    cum: bigint("cum", { mode: "bigint" }).notNull(), // 速算额，配合 mmr 算维持保证金：名义价值 × mmr − cum
  },
  (t) => [
    uniqueIndex("lb_symbol_bracket_uq").on(t.symbol, t.bracket),
    index("lb_symbol_cap_idx").on(t.symbol, t.notionalCap),
  ],
);

export type LeverageBracket = typeof leverageBrackets.$inferSelect;
export type NewLeverageBracket = typeof leverageBrackets.$inferInsert;
```

---

## 第 9 节：编排——`sync.ts`

### 概念：全有或全无

20 个开放币对里，有 1 个校验不过，要不要把另外 19 个写进去？

**不要。** 开放币对只有 20 个，都是主流币。其中一个的数据坏了，最可能的原因是**接口本身出了问题**（结构变了、返回被截断），而不是"币安恰好把这一个币对的表配错了"。这时候另外 19 个的数据也不可信。整次中止、保留旧表、报错，第二天再试——**宁可旧一天，不要错一次**。

同理，官方返回里缺了某个开放币对，也中止，**不删它的旧数据**。

### 概念：为什么写完还要读回来

事务提交成功只说明"数据库接受了这些行"，不说明"这些行就是你想写的"。`parse()` 截断、字段映射写错一个、`insert` 漏了一层——这些都不会让事务失败。读回来和官方逐层再比一次，是独立于写入代码的第二条路径。

### 概念：`DbExecutor`

`syncLeverageBrackets` 接受的 `db` 可以是连接，也可以是事务。这是为了测试：**整个测试用例包在一个最后必定回滚的事务里**，同步函数在里面开的事务会变成保存点（savepoint），测完一起回滚，库里不留痕迹。

### 动手

创建 `packages/db/src/brackets/sync.ts`：

```ts
import { format, parse, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../index";
import { leverageBracketChanges } from "../schema/leverage-bracket-changes";
import { leverageBrackets, type LeverageBracket } from "../schema/leverage-brackets";
import { symbols } from "../schema/symbols";
import type { FetchBrackets } from "./binance-client";
import { diffBrackets, type BracketChange } from "./diff";
import { normalizeSymbolBrackets, validateBracketRows } from "./normalize";
import type { BracketRow } from "./types";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** 数据库连接或事务都行——测试里在一个会回滚的事务里跑同步。 */
export type DbExecutor = Database | Transaction;

export interface SymbolBracketChange {
  symbol: string;
  changes: BracketChange[];
  before: BracketRow[];
  after: BracketRow[];
}

export interface SyncReport {
  dryRun: boolean;
  /** 本次检查的开放币对，按 sortOrder。 */
  checked: string[];
  /** 有变化的币对。dryRun 时是"将要写入"，否则是"已经写入"。 */
  changed: SymbolBracketChange[];
}

export interface SyncOptions {
  db: DbExecutor;
  fetchBrackets: FetchBrackets;
  dryRun?: boolean;
}

/** Fixed → 去掉多余零的十进制字符串：300000.00000000 → "300000"，0.00400000 → "0.004"。 */
function fixedToDecimal(value: Fixed): string {
  const s = format(value);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function recordToRow(r: LeverageBracket): BracketRow {
  return {
    bracket: r.bracket,
    notionalFloor: fixedToDecimal(r.notionalFloor),
    notionalCap: fixedToDecimal(r.notionalCap),
    maxLeverage: r.maxLeverage,
    mmr: fixedToDecimal(r.mmr),
    cum: fixedToDecimal(r.cum),
  };
}

async function loadEnabledSymbols(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.enabled, true))
    .orderBy(asc(symbols.sortOrder), asc(symbols.symbol));

  if (rows.length === 0) {
    throw new Error("symbols 表里没有 enabled 的币对，先跑 seed:symbols 按 open-symbols.ts 设置开放名单");
  }
  return rows.map((r) => r.symbol);
}

async function loadStoredRows(db: DbExecutor, symbolNames: string[]): Promise<Map<string, BracketRow[]>> {
  const records = await db
    .select()
    .from(leverageBrackets)
    .where(inArray(leverageBrackets.symbol, symbolNames))
    .orderBy(asc(leverageBrackets.symbol), asc(leverageBrackets.bracket));

  const bySymbol = new Map<string, BracketRow[]>();
  for (const r of records) {
    const list = bySymbol.get(r.symbol) ?? [];
    list.push(recordToRow(r));
    bySymbol.set(r.symbol, list);
  }
  return bySymbol;
}

/** 拉官方全量，只取开放币对并逐个校验。缺一个或错一个都整体抛错。 */
async function loadOfficialRows(
  fetchBrackets: FetchBrackets,
  symbolNames: string[],
): Promise<Map<string, BracketRow[]>> {
  const payload = await fetchBrackets();
  const bySymbol = new Map(payload.map((entry) => [entry.symbol, entry]));

  const missing = symbolNames.filter((s) => !bySymbol.has(s));
  if (missing.length > 0) {
    throw new Error(`官方分层表里没有这些开放币对：${missing.join(", ")}，同步中止，旧数据保持不变`);
  }

  const result = new Map<string, BracketRow[]>();
  for (const symbol of symbolNames) {
    const entry = bySymbol.get(symbol);
    if (entry) result.set(symbol, normalizeSymbolBrackets(entry));
  }
  return result;
}

/**
 * 用官方签名接口同步开放币对的杠杆分层表。
 *
 * 1. 读 enabled 币对 → 2. 拉官方全量并逐个校验（任何一个不过就整体中止，不写库）
 * → 3. 和库里比 → 4. dryRun 到此为止 → 5. 一个事务里替换变化的币对并记变更
 * → 6. 读回来和官方逐层再比一次，不一致就抛错。
 */
export async function syncLeverageBrackets(options: SyncOptions): Promise<SyncReport> {
  const { db, fetchBrackets, dryRun = false } = options;

  const checked = await loadEnabledSymbols(db);
  const official = await loadOfficialRows(fetchBrackets, checked);
  const stored = await loadStoredRows(db, checked);

  const changed: SymbolBracketChange[] = [];
  for (const symbol of checked) {
    const before = stored.get(symbol) ?? [];
    const after = official.get(symbol) ?? [];
    const changes = diffBrackets(before, after);
    if (changes.length > 0) changed.push({ symbol, changes, before, after });
  }

  if (dryRun || changed.length === 0) {
    return { dryRun, checked, changed };
  }

  await db.transaction(async (tx) => {
    for (const { symbol, before, after } of changed) {
      await tx.delete(leverageBrackets).where(eq(leverageBrackets.symbol, symbol));
      await tx.insert(leverageBrackets).values(
        after.map((row) => ({
          symbol,
          bracket: row.bracket,
          notionalFloor: parse(row.notionalFloor),
          notionalCap: parse(row.notionalCap),
          maxLeverage: row.maxLeverage,
          mmr: parse(row.mmr),
          cum: parse(row.cum),
        })),
      );
      await tx.insert(leverageBracketChanges).values({ symbol, before, after });
    }
  });

  // 第二道校验：写进去的东西读回来必须和官方逐层一致，防止写入环节丢精度或漏行
  const written = await loadStoredRows(
    db,
    changed.map((c) => c.symbol),
  );
  for (const { symbol, after } of changed) {
    const leftover = diffBrackets(written.get(symbol) ?? [], after);
    if (leftover.length > 0) {
      throw new Error(`${symbol} 写库后读回与官方不一致：${JSON.stringify(leftover)}`);
    }
  }

  return { dryRun, checked, changed };
}

export interface VerifyReport {
  checked: string[];
  /** 库里的表和官方不一致的币对。 */
  mismatched: { symbol: string; changes: BracketChange[] }[];
  /** 库里的表自身结构不合法（含没有数据）的币对。 */
  invalid: { symbol: string; error: string }[];
}

/**
 * 对齐检查：库里每个开放币对的分层表，自身结构是否合法、是否和官方完全一致。
 * 只读，不写库。
 */
export async function verifyLeverageBrackets(options: {
  db: DbExecutor;
  fetchBrackets: FetchBrackets;
}): Promise<VerifyReport> {
  const { db, fetchBrackets } = options;

  const checked = await loadEnabledSymbols(db);
  const stored = await loadStoredRows(db, checked);
  const official = await loadOfficialRows(fetchBrackets, checked);

  const report: VerifyReport = { checked, mismatched: [], invalid: [] };
  for (const symbol of checked) {
    const rows = stored.get(symbol) ?? [];
    try {
      validateBracketRows(symbol, rows);
    } catch (err) {
      report.invalid.push({ symbol, error: err instanceof Error ? err.message : String(err) });
    }

    const changes = diffBrackets(rows, official.get(symbol) ?? []);
    if (rows.length > 0 && changes.length > 0) {
      report.mismatched.push({ symbol, changes });
    }
  }
  return report;
}
```

`verifyLeverageBrackets` 和同步共用读库、拉取两个函数，但**只读**：库里的表结构不合法算 `invalid`，和官方不一致算 `mismatched`，两者可以同时出现。

创建 `packages/db/src/brackets/index.ts`，并在 `packages/db/src/index.ts` 里导出，让 server 能 `import { syncLeverageBrackets } from "@binance-contract-trading-full-stack/db"`：

```ts
export { BinanceApiError, createBracketFetcher, sign, type FetchBrackets } from "./binance-client";
export { describeBracketChange, diffBrackets, type BracketChange } from "./diff";
export { checkContinuity, normalizeSymbolBrackets, validateBracketRows } from "./normalize";
export { OPEN_SYMBOLS, openSymbolSetting } from "./open-symbols";
export {
  syncLeverageBrackets,
  verifyLeverageBrackets,
  type DbExecutor,
  type SyncReport,
  type VerifyReport,
} from "./sync";
export type { BracketRow } from "./types";
```

```ts
import { drizzle } from "drizzle-orm/node-postgres";

import type { DatabaseConfig } from "./config";
import * as schema from "./schema";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DATABASE_URL, { schema });
}

export type Database = ReturnType<typeof createDb>;

export * from "./brackets";
export * from './schema';
```

### 动手：连库测试

创建 `packages/db/src/brackets/sync.test.ts`：

```ts
import "varlock/auto-load";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ENV } from "../env";
import { createDb } from "../index";
import { leverageBracketChanges } from "../schema/leverage-bracket-changes";
import { leverageBrackets } from "../schema/leverage-brackets";
import { symbols } from "../schema/symbols";
import type { FetchBrackets } from "./binance-client";
import type { OfficialSymbolBrackets } from "./normalize";
import { syncLeverageBrackets, verifyLeverageBrackets, type DbExecutor } from "./sync";

/**
 * 这组测试连本地数据库跑，但每个用例都包在一个最终回滚的事务里：
 * 造假币对、关掉真实币对的 enabled、跑同步、断言，然后整个回滚，库里不留痕迹。
 */

const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

afterAll(async () => {
  await db.$client.end();
});

class Rollback extends Error {}

async function inRollback(fn: (tx: DbExecutor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

const SYM_A = "ZZSYNCAUSDT";
const SYM_B = "ZZSYNCBUSDT";

/** 事务内：只让两个假币对处于开放状态。 */
async function setupSymbols(tx: DbExecutor): Promise<void> {
  await tx.update(symbols).set({ enabled: false });
  await tx.insert(symbols).values(
    [SYM_A, SYM_B].map((symbol, i) => ({
      symbol,
      baseAsset: symbol.replace("USDT", ""),
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      tickSize: parse("0.1"),
      stepSize: parse("0.001"),
      minQty: parse("0.001"),
      minNotional: parse("5"),
      enabled: true,
      sortOrder: i + 1,
    })),
  );
}

function official(symbol: string, secondCum = 300, secondLeverage = 100): OfficialSymbolBrackets {
  return {
    symbol,
    brackets: [
      { bracket: 1, initialLeverage: 150, notionalCap: 300000, notionalFloor: 0, maintMarginRatio: 0.004, cum: 0 },
      {
        bracket: 2,
        initialLeverage: secondLeverage,
        notionalCap: 800000,
        notionalFloor: 300000,
        maintMarginRatio: 0.005,
        cum: secondCum,
      },
    ],
  };
}

function fetcher(payload: OfficialSymbolBrackets[]): FetchBrackets {
  return async () => structuredClone(payload);
}

async function rowsOf(tx: DbExecutor, symbol: string) {
  return tx
    .select()
    .from(leverageBrackets)
    .where(eq(leverageBrackets.symbol, symbol))
    .orderBy(asc(leverageBrackets.bracket));
}

async function changesOf(tx: DbExecutor) {
  return tx
    .select()
    .from(leverageBracketChanges)
    .where(inArray(leverageBracketChanges.symbol, [SYM_A, SYM_B]));
}

describe("syncLeverageBrackets", () => {
  it("首次同步：写入分层表，每个币对记一条 before=[] 的变更", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B), official("OTHERUSDT")]),
      });

      expect(report.checked).toEqual([SYM_A, SYM_B]);
      expect(report.changed.map((c) => c.symbol)).toEqual([SYM_A, SYM_B]);

      const rows = await rowsOf(tx, SYM_A);
      expect(rows.map((r) => [r.bracket, r.notionalCap, r.maxLeverage, r.mmr, r.cum])).toEqual([
        [1, parse("300000"), 150, parse("0.004"), 0n],
        [2, parse("800000"), 100, parse("0.005"), parse("300")],
      ]);

      const changes = await changesOf(tx);
      expect(changes).toHaveLength(2);
      const changeA = changes.find((c) => c.symbol === SYM_A);
      expect(changeA?.before).toEqual([]);
      expect(changeA?.after[1]).toEqual({
        bracket: 2, notionalFloor: "300000", notionalCap: "800000", maxLeverage: 100, mmr: "0.005", cum: "300",
      });
    });
  });

  it("数据没变：不改表，不记变更", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });
      const idsBefore = (await rowsOf(tx, SYM_A)).map((r) => r.id);

      const report = await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.changed).toEqual([]);
      expect((await rowsOf(tx, SYM_A)).map((r) => r.id)).toEqual(idsBefore);
      expect(await changesOf(tx)).toHaveLength(2); // 仍然只有首次导入那两条
    });
  });

  it("币安调表：只替换变化的币对，变更记录留下前后整表", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      // SYM_A 第 2 层：杠杆 100 → 75（cum 不变，边界仍连续）
      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A, 300, 75), official(SYM_B)]),
      });

      expect(report.changed).toHaveLength(1);
      expect(report.changed[0]?.symbol).toBe(SYM_A);
      expect(report.changed[0]?.changes).toEqual([
        { bracket: 2, kind: "changed", fields: [{ field: "maxLeverage", before: "100", after: "75" }] },
      ]);
      expect((await rowsOf(tx, SYM_A))[1]?.maxLeverage).toBe(75);

      const changesA = (await changesOf(tx)).filter((c) => c.symbol === SYM_A);
      expect(changesA).toHaveLength(2);
      const latest = changesA.find((c) => c.before.length > 0);
      expect(latest?.before[1]?.maxLeverage).toBe(100);
      expect(latest?.after[1]?.maxLeverage).toBe(75);
    });
  });

  it("dryRun：报告差异，但不写任何东西", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      const report = await syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]),
        dryRun: true,
      });

      expect(report.dryRun).toBe(true);
      expect(report.changed).toHaveLength(2);
      expect(await rowsOf(tx, SYM_A)).toEqual([]);
      expect(await changesOf(tx)).toEqual([]);
    });
  });

  it("任何一个开放币对校验不过：整次中止，一个都不写", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);

      // SYM_B 第 2 层速算额错了 1，边界不连续
      const run = syncLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A), official(SYM_B, 301)]),
      });

      await expect(run).rejects.toThrow(/ZZSYNCBUSDT.*连续性/);
      expect(await rowsOf(tx, SYM_A)).toEqual([]);
      expect(await changesOf(tx)).toEqual([]);
    });
  });

  it("官方没返回某个开放币对：中止，不删它的旧数据", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      const run = syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A)]) });

      await expect(run).rejects.toThrow(/ZZSYNCBUSDT/);
      expect(await rowsOf(tx, SYM_B)).toHaveLength(2);
    });
  });

  it("没有任何开放币对时明确报错，提示先跑 seed:symbols", async () => {
    await inRollback(async (tx) => {
      await tx.update(symbols).set({ enabled: false });
      await expect(
        syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([]) }),
      ).rejects.toThrow(/seed:symbols/);
    });
  });
});

describe("verifyLeverageBrackets", () => {
  it("库里和官方一致：没有差异", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report).toEqual({ checked: [SYM_A, SYM_B], mismatched: [], invalid: [] });
    });
  });

  it("官方调表后库里还没同步：报告差异", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher([official(SYM_A), official(SYM_B)]) });

      const report = await verifyLeverageBrackets({
        db: tx,
        fetchBrackets: fetcher([official(SYM_A, 300, 75), official(SYM_B)]),
      });

      expect(report.mismatched.map((m) => m.symbol)).toEqual([SYM_A]);
      expect(report.invalid).toEqual([]);
    });
  });

  it("库里的表被改坏（不连续）：报告为 invalid", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];
      await syncLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });
      await tx
        .update(leverageBrackets)
        .set({ cum: parse("301") })
        .where(eq(leverageBrackets.symbol, SYM_B));

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.invalid.map((i) => i.symbol)).toEqual([SYM_B]);
      expect(report.mismatched.map((m) => m.symbol)).toEqual([SYM_B]);
    });
  });

  it("开放币对在库里没有分层表：报告为 invalid", async () => {
    await inRollback(async (tx) => {
      await setupSymbols(tx);
      const payload = [official(SYM_A), official(SYM_B)];

      const report = await verifyLeverageBrackets({ db: tx, fetchBrackets: fetcher(payload) });

      expect(report.invalid.map((i) => i.symbol)).toEqual([SYM_A, SYM_B]);
    });
  });
});
```

几个要点：

- **`inRollback`**：测试函数跑完主动抛一个 `Rollback`，让事务回滚；外面只吞 `Rollback`，断言失败等其它错误照常抛出。
- **假币对 `ZZSYNC*`**：不碰真实币对的分层表。`setupSymbols` 先把全部币对 `enabled` 关掉，再插两个开放的假币对——同步逻辑只认 `enabled`，所以测试完全隔离。
- **"没有变化"用 `id` 判断**：如果同步偷偷 delete + insert 了一遍，行的 `id` 会变。只断言"数值一样"是抓不住这种浪费的。

这组测试需要本地数据库在跑（`DATABASE_URL` 可连），并且已经应用了迁移 0002。

---

## 第 10 节：脚本

### 动手：`sync:brackets`

创建 `packages/db/src/scripts/sync-brackets.ts`：

```ts
import "varlock/auto-load";
import { createBracketFetcher } from "../brackets/binance-client";
import { describeBracketChange } from "../brackets/diff";
import { syncLeverageBrackets } from "../brackets/sync";
import { ENV } from "../env";
import { createDb } from "../index";

/**
 * 用官方签名接口 GET /fapi/v1/leverageBracket 同步开放币对的杠杆分层表。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run sync:brackets            # 同步并写库
 *   pnpm --filter @binance-contract-trading-full-stack/db run sync:brackets --dry-run  # 只看差异，不写库
 *
 * server 每天 UTC 00:05 会自动跑同一段逻辑，这个脚本用于手动触发和排查。
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  const fetchBrackets = createBracketFetcher({
    apiKey: ENV.BINANCE_API_KEY,
    secretKey: ENV.BINANCE_SECRET_KEY,
  });

  try {
    const report = await syncLeverageBrackets({ db, fetchBrackets, dryRun });

    for (const { symbol, changes } of report.changed) {
      console.log(`${dryRun ? "将更新" : "已更新"} ${symbol}：`);
      for (const change of changes) console.log(`  - ${describeBracketChange(change)}`);
    }
    const unchanged = report.checked.length - report.changed.length;
    console.log(
      `\nsync:brackets${dryRun ? "（dry-run，未写库）" : ""} 完成：检查 ${report.checked.length} 个开放币对，` +
        `${report.changed.length} 个有变化，${unchanged} 个与官方一致。`,
    );
  } finally {
    await db.$client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

### 动手：`verify:brackets`

重写 `packages/db/src/scripts/verify-brackets.ts`（以前查 JSON，现在查数据库 + 对齐官方）：

```ts
import "varlock/auto-load";
import { createBracketFetcher } from "../brackets/binance-client";
import { describeBracketChange } from "../brackets/diff";
import { verifyLeverageBrackets } from "../brackets/sync";
import { ENV } from "../env";
import { createDb } from "../index";

/**
 * 对齐检查（只读）：库里每个开放币对的分层表
 *   1. 自身结构合法——层号连续、上下限衔接、杠杆不增、mmr 不减、边界维持保证金连续；
 *   2. 和官方签名接口的返回逐层逐字段一致。
 * 任何一个币对不过，退出码为 1。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets
 */
async function main() {
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  const fetchBrackets = createBracketFetcher({
    apiKey: ENV.BINANCE_API_KEY,
    secretKey: ENV.BINANCE_SECRET_KEY,
  });

  try {
    const report = await verifyLeverageBrackets({ db, fetchBrackets });
    const invalid = new Map(report.invalid.map((i) => [i.symbol, i.error]));
    const mismatched = new Map(report.mismatched.map((m) => [m.symbol, m.changes]));

    for (const symbol of report.checked) {
      const error = invalid.get(symbol);
      const changes = mismatched.get(symbol);
      if (!error && !changes) {
        console.log(`✓ ${symbol}`);
        continue;
      }
      console.error(`✗ ${symbol}`);
      if (error) console.error(`  结构不合法：${error}`);
      for (const change of changes ?? []) console.error(`  与官方不一致：${describeBracketChange(change)}`);
    }

    const failed = new Set([...invalid.keys(), ...mismatched.keys()]).size;
    console.log(`\nverify:brackets：${report.checked.length} 个开放币对，${failed} 个未通过。`);
    if (failed > 0) {
      console.log("与官方不一致时跑 sync:brackets 同步；结构不合法说明库里的数据被改坏了，同样用 sync:brackets 覆盖。");
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

> `verify:brackets` 以前在 `06-testing-design.md` 里是进 CI 的。现在它要调签名接口，**不进 CI**——CI 里没有也不该有这把 Key。结构和连续性规则已经被 `normalize.test.ts` 覆盖，`pnpm test` 就包含了。

### 动手：`seed:symbols` 按名单设置 `enabled`

改 `packages/db/src/scripts/seed-symbols.ts`：开跑前先确认名单里的币对在 exchangeInfo 里都存在（名单打错字要当场报错，而不是悄悄少开一个），写入时带上 `openSymbolSetting`：

```ts
import "varlock/auto-load";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { OPEN_SYMBOLS, openSymbolSetting } from "../brackets/open-symbols";
import { createDb } from "../index";
import { ENV } from "../env";
import { symbols, type NewSymbol } from "../schema/symbols";

const EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

interface BinanceFilter {
  filterType: string;
  /** 每种 filter 只带自己那几个字段，取别的 key 就是 undefined——类型如实反映这一点。 */
  [key: string]: string | number | undefined;
}

interface BinanceExchangeInfoSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  filters: BinanceFilter[];
}

function findFilter(filters: BinanceFilter[], filterType: string): BinanceFilter {
  const found = filters.find((f) => f.filterType === filterType);
  if (!found) {
    throw new Error(`symbol 缺少 filter: ${filterType}`);
  }
  return found;
}

/** 取 filter 里的必填字段。缺了就抛错，不拿 "undefined" 去 parse 出一个假数字。 */
function requireField(filter: BinanceFilter, key: string): string {
  const value = filter[key];
  if (value === undefined) {
    throw new Error(`filter ${filter.filterType} 缺少字段: ${key}`);
  }
  return String(value);
}

/** 纯函数：币安 exchangeInfo 的一条 symbol 记录 → 待写入 symbols 表的行。不碰网络、不碰数据库。 */
export function mapExchangeInfoSymbol(raw: BinanceExchangeInfoSymbol): NewSymbol {
  const priceFilter = findFilter(raw.filters, "PRICE_FILTER");
  const lotSizeFilter = findFilter(raw.filters, "LOT_SIZE");
  const minNotionalFilter = findFilter(raw.filters, "MIN_NOTIONAL");

  return {
    symbol: raw.symbol,
    baseAsset: raw.baseAsset,
    quoteAsset: raw.quoteAsset,
    status: raw.status,
    pricePrecision: raw.pricePrecision,
    quantityPrecision: raw.quantityPrecision,
    tickSize: parse(requireField(priceFilter, "tickSize")),
    stepSize: parse(requireField(lotSizeFilter, "stepSize")),
    minQty: parse(requireField(lotSizeFilter, "minQty")),
    minNotional: parse(requireField(minNotionalFilter, "notional")),
  };
}

async function main() {
  const res = await fetch(EXCHANGE_INFO_URL);
  if (!res.ok) {
    throw new Error(`拉取 exchangeInfo 失败: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { symbols: BinanceExchangeInfoSymbol[] };

  const listed = new Set(body.symbols.map((s) => s.symbol));
  const unknown = OPEN_SYMBOLS.filter((s) => !listed.has(s));
  if (unknown.length > 0) {
    throw new Error(`open-symbols.ts 里这些币对在币安 exchangeInfo 里不存在：${unknown.join(", ")}，同步中止`);
  }

  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  let created = 0;
  let updated = 0;

  for (const raw of body.symbols) {
    // enabled / sortOrder 是我们自己的运营字段，按 open-symbols.ts 的名单设置
    const row = { ...mapExchangeInfoSymbol(raw), ...openSymbolSetting(raw.symbol) };
    const existing = await db.select().from(symbols).where(eq(symbols.symbol, row.symbol)).limit(1);

    if (existing.length === 0) {
      await db.insert(symbols).values(row);
      created += 1;
    } else {
      await db
        .update(symbols)
        .set({
          baseAsset: row.baseAsset,
          quoteAsset: row.quoteAsset,
          status: row.status,
          pricePrecision: row.pricePrecision,
          quantityPrecision: row.quantityPrecision,
          tickSize: row.tickSize,
          stepSize: row.stepSize,
          minQty: row.minQty,
          minNotional: row.minNotional,
          enabled: row.enabled,
          sortOrder: row.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(symbols.symbol, row.symbol));
      updated += 1;
    }
  }

  console.log(`seed:symbols 完成：新建 ${created} 个，更新 ${updated} 个，开放 ${OPEN_SYMBOLS.length} 个。`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

`symbols.ts` 表注释里"同步脚本不会覆盖这两列"那句也要跟着改——现在 `seed:symbols` 就是负责设置这两列的地方。

### 动手：`package.json`

删掉 `fetch:brackets` 和 `seed:brackets`，加上 `sync:brackets`：

```json
{
  "name": "@binance-contract-trading-full-stack/db",
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    },
    "./*": {
      "default": "./src/*.ts"
    }
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate:deploy": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:migrate": "drizzle-kit migrate",
    "sync:brackets": "tsx src/scripts/sync-brackets.ts",
    "verify:brackets": "tsx src/scripts/verify-brackets.ts",
    "seed:symbols": "tsx src/scripts/seed-symbols.ts",
    "reconcile:ledger": "tsx src/scripts/reconcile-ledger.ts"
  },
  "dependencies": {
    "drizzle-orm": "catalog:",
    "pg": "^8.23.0",
    "zod": "catalog:",
    "@binance-contract-trading-full-stack/shared": "workspace:*"
  },
  "devDependencies": {
    "@binance-contract-trading-full-stack/config": "workspace:*",
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.31.10",
    "typescript": "^6.0.3",
    "tsx": "^4.23.13",
    "varlock": "catalog:",
    "vitest": "catalog:"
  }
}
```

### 删掉旧文件

```bash
rm -r packages/db/src/seed
rm packages/db/src/scripts/fetch-brackets.ts packages/db/src/scripts/seed-brackets.ts
```

`seed/` 里有 `leverage-brackets.json`、`leverage-brackets.schema.ts`、`README.md`。它们在 git 历史 `2267d10` 里都能找回。`checkContinuity` 和 `BracketRow` 已经搬进 `brackets/`。

**为什么不留着当兜底**：两个数据源并存，迟早有人（包括以后的你）不确定该信哪个。官方接口挂了，正确的反应是"同步失败、保留旧表、报错"，而不是"自动切到另一个来源"。

---

## 第 11 节：server 每日定时任务

### 概念：为什么用 `setTimeout` 链而不是 `setInterval`

`setInterval(fn, 24h)` 从启动那一刻开始数 24 小时。server 下午 3 点重启，同步时间就漂到每天下午 3 点；机器休眠几小时，间隔也跟着漂。

`setTimeout` 链是：**每次跑完，按当前时间重新算"下一个 UTC 00:05 还有多久"**。不管什么时候启动、中间停过多久，总会对齐回 00:05，而且不需要持久化任何定时器状态。

### 概念：三个保护

| 保护 | 为什么 |
| --- | --- |
| **启动时先跑一次** | server 停了三天再起来，不该等到下一个 00:05 才知道表变没变 |
| **防重入** | 某次同步卡住（网络慢），不能让下一次叠上去并发写同一张表 |
| **失败只记日志** | 同步失败时库里是旧表，服务照常能用；为了一个每日任务让整个 server 退出不值得 |

### 动手

先给 server 加上测试：`apps/server/package.json` 加 `"test": "vitest run"` 和 devDependency `"vitest": "catalog:"`，然后 `pnpm install`。

```json
{
  "name": "server",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "compile": "bun build --compile --no-compile-autoload-dotenv --minify --sourcemap --bytecode ./src/index.ts --outfile server",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.mjs",
    "env:generate": "varlock codegen"
  },
  "dependencies": {
    "@binance-contract-trading-full-stack/db": "workspace:*",
    "@hono/node-server": "^2.1.1",
    "hono": "^4.13.7",
    "varlock": "catalog:",
    "zod": "catalog:",
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@binance-contract-trading-full-stack/config": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "^0.23.0",
    "tsx": "^4.23.13",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  },
  "trustedDependencies": [
    "supabase"
  ]
}
```

创建 `apps/server/src/jobs/bracket-sync.ts`：

```ts
import { describeBracketChange, type SyncReport } from "@binance-contract-trading-full-stack/db";

const RUN_AT_UTC_HOUR = 0;
const RUN_AT_UTC_MINUTE = 5;

/**
 * 下一次同步时刻：严格晚于 now 的最近一个 UTC 00:05。
 *
 * 选 00:05 而不是整点：币安调表公告通常按 UTC 日期生效，错开整点几分钟，
 * 也避开同一时刻的资金费结算等其它整点任务。
 */
export function nextRunAt(now: Date): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_AT_UTC_HOUR, RUN_AT_UTC_MINUTE),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export interface BracketSyncJobOptions {
  /** 跑一次同步。server 里是 syncLeverageBrackets，测试里是假的。 */
  run: () => Promise<SyncReport>;
  /** 分层表真的变了才调用。引擎宿主接入后在这里热加载分层表。 */
  onChanged?: (report: SyncReport) => void | Promise<void>;
  logger?: Pick<Console, "log" | "error">;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface BracketSyncJob {
  /** 立刻跑一次；上一次还没结束就跳过。 */
  runNow(): Promise<void>;
  /** 等当前这次（如果有）跑完，测试用。 */
  idle(): Promise<void>;
  stop(): void;
}

/**
 * 分层表每日同步任务：启动时跑一次，之后每天 UTC 00:05 跑一次。
 *
 * - 用 setTimeout 链而不是 setInterval：每次跑完按当前时间重新算下一次，进程重启、
 *   机器休眠后都能自己对齐回 00:05，不依赖任何持久化的定时器状态。
 * - 失败只记日志：同步失败时库里保留旧表，服务照常运行，第二天再试。
 */
export function startBracketSyncJob(options: BracketSyncJobOptions): BracketSyncJob {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  let current: Promise<void> | null = null;
  /** 最近一轮"执行 + 排下一次"，idle() 等它。 */
  let cycle: Promise<void> = Promise.resolve();
  let timer: unknown = null;
  let stopped = false;

  async function execute(): Promise<void> {
    try {
      const report = await options.run();
      logger.log(
        `[bracket-sync] 检查 ${report.checked.length} 个开放币对，${report.changed.length} 个有变化`,
      );
      if (report.changed.length === 0) return;

      for (const { symbol, changes } of report.changed) {
        logger.log(`[bracket-sync] ${symbol}：${changes.map(describeBracketChange).join("；")}`);
      }
      await options.onChanged?.(report);
    } catch (err) {
      logger.error("[bracket-sync] 同步失败，库里保留旧分层表：", err);
    }
  }

  function runNow(): Promise<void> {
    if (current) {
      logger.log("[bracket-sync] 上一次同步还没结束，跳过本次");
      return Promise.resolve();
    }
    current = execute().finally(() => {
      current = null;
    });
    return current;
  }

  function schedule(): void {
    if (stopped) return;
    const at = now();
    const delayMs = nextRunAt(at).getTime() - at.getTime();
    timer = setTimer(() => {
      if (stopped) return;
      cycle = runNow().then(schedule);
    }, delayMs);
  }

  cycle = runNow().then(schedule);

  return {
    runNow,
    idle: () => cycle,
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
  };
}
```

`idle()` 返回的是"最近一轮执行 + 排下一次"的 Promise。测试里要等到**排期也完成**才能断言 `scheduled` 的长度，只等执行结束是不够的。

测试 `apps/server/src/jobs/bracket-sync.test.ts`——定时器换成手动触发，时钟固定：

```ts
import type { SyncReport } from "@binance-contract-trading-full-stack/db";
import { describe, expect, it } from "vitest";
import { nextRunAt, startBracketSyncJob } from "./bracket-sync";

describe("nextRunAt", () => {
  it("当天 00:05 之前 → 当天 00:05", () => {
    expect(nextRunAt(new Date("2026-09-16T00:04:59.999Z")).toISOString()).toBe("2026-09-16T00:05:00.000Z");
  });

  it("正好 00:05 → 明天 00:05（这一刻的那次已经在跑了）", () => {
    expect(nextRunAt(new Date("2026-09-16T00:05:00.000Z")).toISOString()).toBe("2026-09-17T00:05:00.000Z");
  });

  it("00:05 之后 → 明天 00:05，跨月跨年也对", () => {
    expect(nextRunAt(new Date("2026-09-16T13:00:00Z")).toISOString()).toBe("2026-09-17T00:05:00.000Z");
    expect(nextRunAt(new Date("2026-09-30T23:59:00Z")).toISOString()).toBe("2026-10-01T00:05:00.000Z");
    expect(nextRunAt(new Date("2026-12-31T08:00:00Z")).toISOString()).toBe("2027-01-01T00:05:00.000Z");
  });
});

function report(changedSymbols: string[] = []): SyncReport {
  return {
    dryRun: false,
    checked: ["BTCUSDT", "ETHUSDT"],
    changed: changedSymbols.map((symbol) => ({ symbol, changes: [], before: [], after: [] })),
  };
}

/** 把定时器换成手动触发，记下每次排期的延迟。 */
function manualTimer() {
  const scheduled: { fn: () => void; ms: number }[] = [];
  return {
    scheduled,
    setTimer: (fn: () => void, ms: number) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimer: () => {},
  };
}

const silent = { log: () => {}, error: () => {} };

describe("startBracketSyncJob", () => {
  it("启动时立即跑一次，然后排到下一个 UTC 00:05", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();

    expect(calls).toBe(1);
    expect(timer.scheduled).toHaveLength(1);
    expect(timer.scheduled[0]?.ms).toBe(12 * 60 * 60 * 1000 + 5 * 60 * 1000);
    job.stop();
  });

  it("定时器触发后再跑一次，并排好下一次", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-17T00:05:00Z"),
      ...timer,
    });
    await job.idle();

    timer.scheduled[0]?.fn();
    await job.idle();

    expect(calls).toBe(2);
    expect(timer.scheduled).toHaveLength(2);
    expect(timer.scheduled[1]?.ms).toBe(24 * 60 * 60 * 1000);
    job.stop();
  });

  it("上一次还没跑完：跳过，不并发跑两次", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: () => {
        calls += 1;
        return new Promise<SyncReport>((resolve) => {
          release = () => resolve(report());
        });
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });

    await job.runNow(); // 启动那次还挂着，这次应该直接跳过
    expect(calls).toBe(1);

    release();
    await job.idle();
    job.stop();
  });

  it("同步失败只记日志，不抛出，下一次照常排期", async () => {
    const errors: unknown[] = [];
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        throw new Error("binance down");
      },
      logger: { log: () => {}, error: (...args: unknown[]) => errors.push(args) },
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();

    expect(errors).toHaveLength(1);
    expect(timer.scheduled).toHaveLength(1);
    job.stop();
  });

  it("只有真的有变化才回调 onChanged", async () => {
    const seen: SyncReport[] = [];
    const reports = [report(), report(["BTCUSDT"])];
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => reports.shift() ?? report(),
      onChanged: (r) => {
        seen.push(r);
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();
    expect(seen).toHaveLength(0);

    timer.scheduled[0]?.fn();
    await job.idle();
    expect(seen.map((r) => r.changed.map((c) => c.symbol))).toEqual([["BTCUSDT"]]);
    job.stop();
  });

  it("stop 之后定时器触发也不再跑", async () => {
    let calls = 0;
    const timer = manualTimer();
    const job = startBracketSyncJob({
      run: async () => {
        calls += 1;
        return report();
      },
      logger: silent,
      now: () => new Date("2026-09-16T12:00:00Z"),
      ...timer,
    });
    await job.idle();
    job.stop();

    timer.scheduled[0]?.fn();
    await job.idle();
    expect(calls).toBe(1);
  });
});
```

接进 `apps/server/src/index.ts`：

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.server";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";
import {
  createBracketFetcher,
  syncLeverageBrackets,
} from "@binance-contract-trading-full-stack/db";
import { startBracketSyncJob } from "./jobs/bracket-sync";
import { booksRoute } from "./routers/books";
import { getDb } from "./services";

app.route("/books", booksRoute); // 👈 新增

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

// 杠杆分层表每日同步：启动时跑一次，之后每天 UTC 00:05。只读 Key，只在服务端使用。
const fetchBrackets = createBracketFetcher({
  apiKey: env.BINANCE_API_KEY,
  secretKey: env.BINANCE_SECRET_KEY,
});
startBracketSyncJob({
  run: () => syncLeverageBrackets({ db: getDb(), fetchBrackets }),
  onChanged: () => {
    // TODO(第 11 讲 引擎宿主)：在这里把新分层表热加载进引擎。
    // 在那之前，分层表变更要重启 server 才会进入引擎（02-architecture.md 已知失真点 #9）。
    console.log("[bracket-sync] 分层表已更新；引擎热加载尚未接入，需重启 server 生效");
  },
});
```

### 已知限制：引擎还拿不到新表

`onChanged` 现在只打一行日志。引擎宿主要到第 11 讲才有，那时在这里把新分层表热加载进引擎。**在那之前，分层表变了要重启 server 才生效**——这一条记进了 `02-architecture.md` 第九节已知失真点 #9。

---

## 跑一遍

```bash
# 1. 按开放名单设置 enabled
pnpm --filter @binance-contract-trading-full-stack/db run seed:symbols
# → seed:symbols 完成：新建 0 个，更新 897 个，开放 20 个。

# 2. 先 dry-run 看差异
pnpm --filter @binance-contract-trading-full-stack/db run sync:brackets --dry-run
# → sync:brackets（dry-run，未写库） 完成：检查 20 个开放币对，0 个有变化，20 个与官方一致。

# 3. 对齐检查
pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets
# → ✓ BTCUSDT … ✓ FILUSDT
# → verify:brackets：20 个开放币对，0 个未通过。

# 4. 启动 server，日志里能看到
pnpm run dev:server
# → [bracket-sync] 检查 20 个开放币对，0 个有变化
```

第 2 步显示 0 个变化，是因为你第 01 讲用 bapi 导入的数据和官方完全一致。这也是那次实测的结论。

---

## 验收清单

- [ ] `apps/server/.env` 有 `BINANCE_API_KEY` / `BINANCE_SECRET_KEY`，Key 只开了「允许读取」
- [ ] `pnpm --filter @binance-contract-trading-full-stack/db run check-types` 通过
- [ ] `pnpm --filter @binance-contract-trading-full-stack/db run test`：6 个文件、51 条测试全部通过
- [ ] `pnpm --filter server run check-types` 通过；`pnpm --filter server run test`：1 个文件、9 条测试全部通过
- [ ] 迁移 0002 已应用，库里有 `leverage_bracket_changes` 表
- [ ] `seed:symbols` 后 `enabled` 的币对正好 20 个
- [ ] `verify:brackets` 20 个全部 ✓
- [ ] 做过第 6 节的练习：注释掉一条规则，看到对应测试变红
- [ ] 能说清楚：为什么一个币对校验不过要整次中止；为什么 diff 按数值比；为什么用 `setTimeout` 链

建议的提交：

```bash
git add packages/db apps/server docs CLAUDE.md HANDOFF.md packages/engine/src/testing/fixtures.ts pnpm-lock.yaml
git commit -m "feat(brackets): 官方签名接口每日同步杠杆分层表，三道校验 + 变更快照表"
```

> ⚠️ 工作区里还有第 02 讲引擎的未提交改动，`git add` 之前先 `git status` 看清楚，需要的话分两次提交。
