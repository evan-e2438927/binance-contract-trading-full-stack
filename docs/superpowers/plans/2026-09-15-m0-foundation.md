# M0 地基 Implementation Plan

> ⚠️ **状态：仅作参考，不再是待执行的 AI 任务列表。** 写完这份计划后确认了 `HANDOFF.md` 第五节的本意——数据库/后端两层要用户自己动手写，AI 只写教程带路，前端才是 AI 直接实现。数据库层（`packages/shared` + `packages/db`）的教程版本在 `docs/tutorial/01-database.md`，请跟那份走。`packages/engine` 骨架部分（本文 Task 4、5）还没转成教程，留到"02-backend.md"那一讲。这份文件里的代码经过和设计文档反复核对，教程直接复用了它，不必重新推导。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好三块地基——`packages/shared`（定标数值库）、`packages/engine`（撮合内核的骨架，不含真实撮合逻辑）、`packages/db`（12 张表）——加上围绕它们的四个运维脚本，让后续里程碑能在类型安全、可重放、账目自洽的基础上写真正的撮合/风控逻辑。

**Architecture:** 严格按 `02-architecture.md` 的依赖方向 `server ──► engine ──► shared`、`server ──► db ──► shared` 施工。`packages/shared` 先行（零依赖），`packages/engine` 骨架与 `packages/db` 表结构可以并行，但两者都要从 `shared` 消费同一份枚举/错误码，不允许各自重复定义。

**Tech Stack:** TypeScript 6 + `bigint` 定标 1e8、Drizzle ORM (postgres) + drizzle-kit、Vitest、pnpm workspace + turbo、tsx（跑脚本）。

**Spec:** `docs/design/02-architecture.md`（第五、六节）、`docs/design/03-database-design.md`（全篇）、`docs/design/04-backend-design.md`（第 3、6、11、13 节）、`docs/design/06-testing-design.md`（第 1、2 节）、根 `CLAUDE.md`、`HANDOFF.md` 第五节。

## Global Constraints

- 金额、价格、数量一律 `bigint` 定标 1e8；禁止 `number`/`parseFloat`/`Number()`/`toFixed()` 出现在计算路径上。例外：`leverage`（整数倍数）、数组下标、时间戳、计数器——这些变量名必须加 `Num` 后缀。
- `packages/engine` 零依赖：不许 import 数据库/网络/文件系统，不许出现 `Date.now()`、`Math.random()`、`console.*`、`setTimeout`/`setInterval`。时间戳一律从输入（`EngineInput.ts` 字段）带进来。
- 舍入必须走 `packages/shared`，不许在业务代码里临时写舍入逻辑。五种场景：价格对齐（买下卖上）、数量对齐（下）、手续费（上）、已实现盈亏（截断）、保证金/强平价等展示类数值（就近取整）。
- `bigint` 不许直接进 JSON；序列化边界统一 `parse()`/`format()` 转换。
- 依赖方向单向：`web ──► shared`、`server ──► engine ──► shared`、`server ──► db ──► shared`。`engine` 依赖 `db`/`server` 是架构错误。
- **杠杆分层表的数字必须人工从币安页面核对，不许凭记忆/训练数据生成。** 本计划里 `leverage-brackets.json` 只搭骨架，实际数值留空，由人工填入。
- 包命名统一 `@binance-contract-trading-full-stack/<name>`；文件风格双引号 + 分号（跟随现有 `packages/db/src/schema/books.ts`）；`tsconfig.json` 一律 `extends "@binance-contract-trading-full-stack/config/tsconfig.base.json"` 并设 `"noEmit": true`。

---

## Task 1: `packages/shared` 包骨架 + `fixed.ts` 核心（parse/format/mul/div）

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/fixed.ts`
- Test: `packages/shared/src/fixed.test.ts`
- Modify: `pnpm-workspace.yaml`（catalog 加 `vitest`）
- Modify: `turbo.json`（加 `test` task）
- Modify: `package.json`（根，加 `test` script）

**Interfaces:**
- Produces: `SCALE: bigint`、`type Fixed = bigint`、`parse(input: string): Fixed`、`format(value: Fixed, precision?: number): string`、`mul(a: Fixed, b: Fixed): Fixed`、`div(a: Fixed, b: Fixed): Fixed` —— 后续所有任务（engine、db 的舍入、脚本）都从 `@binance-contract-trading-full-stack/shared` 导入这些名字，不得改名。

- [ ] **Step 1: 建包骨架**

`packages/shared/package.json`：

```json
{
  "name": "@binance-contract-trading-full-stack/shared",
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
    "test": "vitest run"
  },
  "devDependencies": {
    "@binance-contract-trading-full-stack/config": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  }
}
```

`packages/shared/tsconfig.json`：

```json
{
  "extends": "@binance-contract-trading-full-stack/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  }
}
```

`packages/shared/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

在 `pnpm-workspace.yaml` 的 `catalog:` 下加一行：

```yaml
  vitest: ^5.0.1
```

在根 `package.json` 的 `scripts` 里加：

```json
    "test": "turbo run test",
```

在 `turbo.json` 的 `tasks` 里加：

```json
    "test": {
      "dependsOn": ["^test"]
    },
```

- [ ] **Step 2: 写失败的测试**

`packages/shared/src/fixed.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { SCALE, div, format, mul, parse } from "./fixed";

describe("fixed", () => {
  it.each([
    ["0", 0n],
    ["50000.25", 5000025000000n],
    ["-50000.25", -5000025000000n],
    ["0.00000001", 1n],
    ["0.000000001", 0n],
    ["92233720368", 9223372036800000000n],
  ] as const)("parse(%s)", (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it("format 补齐 8 位小数", () => {
    expect(format(parse("50000.25"))).toBe("50000.25000000");
  });

  it("format 支持自定义精度", () => {
    expect(format(parse("50000.25"), 2)).toBe("50000.25");
  });

  it("负数往返一致", () => {
    expect(format(parse("-1.5"))).toBe("-1.50000000");
  });

  it("mul: a * b / SCALE", () => {
    expect(mul(parse("2"), parse("3"))).toBe(parse("6"));
    expect(mul(parse("0.1"), parse("0.1"))).toBe(parse("0.01"));
  });

  it("div: a * SCALE / b（截断，不四舍五入）", () => {
    expect(div(parse("6"), parse("3"))).toBe(parse("2"));
    expect(div(parse("2"), parse("3"))).toBe(66666666n); // 0.66666666，第 9 位截断
  });

  it("div 除以零抛错", () => {
    expect(() => div(parse("1"), 0n)).toThrow();
  });

  it("SCALE 是 1e8", () => {
    expect(SCALE).toBe(100_000_000n);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
```

预期：报错 `Cannot find module './fixed'`（文件还不存在）。

- [ ] **Step 4: 实现 `fixed.ts`**

`packages/shared/src/fixed.ts`：

```ts
export const SCALE = 100_000_000n;

/** 定标后的整数：1 单位 = 1e-8。全系统金额/价格/数量的唯一表示形式。 */
export type Fixed = bigint;

/** 十进制字符串 → 定标整数。超过 8 位小数直接截断，不四舍五入。 */
export function parse(input: string): Fixed {
  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [intPart = "0", fracPartRaw = ""] = unsigned.split(".");
  const fracPart = fracPartRaw.slice(0, 8).padEnd(8, "0");
  const value = BigInt(`${intPart}${fracPart}`);
  return negative ? -value : value;
}

/** 定标整数 → 十进制字符串，precision 控制小数位数（默认 8）。 */
export function format(value: Fixed, precision = 8): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const intPart = abs / SCALE;
  const fracPart = (abs % SCALE).toString().padStart(8, "0").slice(0, precision);
  const sign = negative ? "-" : "";
  return precision > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/** 乘法，截断（对负数截断到零，不是向下取整）。 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return (a * b) / SCALE;
}

/** 除法，截断。除数为零抛错。 */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("division by zero");
  return (a * SCALE) / b;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

预期：全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/vitest.config.ts \
  packages/shared/src/fixed.ts packages/shared/src/fixed.test.ts \
  pnpm-workspace.yaml turbo.json package.json
git commit -m "feat(shared): 定标数值核心 fixed.ts（parse/format/mul/div）"
```

---

## Task 2: `fixed.ts` 五种舍入（`mulCeil` / `divRound` / `alignPrice` / `alignQty`）

**Files:**
- Modify: `packages/shared/src/fixed.ts`
- Modify: `packages/shared/src/fixed.test.ts`

**Interfaces:**
- Consumes: `SCALE`、`Fixed`、`parse` from Task 1.
- Produces: `mulCeil(a: Fixed, b: Fixed): Fixed`（手续费用）、`divRound(a: Fixed, b: Fixed): Fixed`（保证金率/强平价/未实现盈亏用）、`alignPrice(price: Fixed, tickSize: Fixed, side: "BUY" | "SELL"): Fixed`、`alignQty(qty: Fixed, stepSize: Fixed): Fixed` —— engine 后续算强平价、手续费、下单校验链第 5 步会直接调这四个函数。

> `02-architecture.md` 第五节"舍入规则"表里的另外两行（价格/数量对齐、已实现盈亏截断）分别对应 `alignPrice`/`alignQty` 和 Task 1 已有的 `mul`/`div`（bigint 除法本身就是截断，不需要额外函数）。

- [ ] **Step 1: 写失败的测试**

在 `fixed.test.ts` 追加：

```ts
import { alignPrice, alignQty, divRound, mulCeil } from "./fixed";

describe("mulCeil（手续费向上取整）", () => {
  it("有余数时向上进一", () => {
    // 0.00000003 * 0.00000007，乘积远小于最小单位，也要收够 1 个最小单位的手续费
    expect(mulCeil(parse("0.00000003"), parse("0.00000007"))).toBe(1n);
  });

  it("整除时不受影响", () => {
    expect(mulCeil(parse("2"), parse("3"))).toBe(parse("6"));
  });
});

describe("divRound（四舍五入，用于保证金率/强平价/未实现盈亏）", () => {
  it("1/3 → 0.33333333（第 9 位是 3，舍）", () => {
    expect(divRound(parse("1"), parse("3"))).toBe(parse("0.33333333"));
  });

  it("2/3 → 0.66666667（第 9 位是 6，进），与 div 的截断结果不同", () => {
    expect(divRound(parse("2"), parse("3"))).toBe(parse("0.66666667"));
    expect(div(parse("2"), parse("3"))).toBe(parse("0.66666666"));
  });
});

describe("alignPrice（买下卖上对齐 tickSize）", () => {
  it("买单向下对齐", () => {
    expect(alignPrice(parse("50000.17"), parse("0.1"), "BUY")).toBe(parse("50000.1"));
  });

  it("卖单向上对齐", () => {
    expect(alignPrice(parse("50000.17"), parse("0.1"), "SELL")).toBe(parse("50000.2"));
  });

  it("已经对齐时原样返回", () => {
    expect(alignPrice(parse("50000.1"), parse("0.1"), "BUY")).toBe(parse("50000.1"));
  });
});

describe("alignQty（向下对齐 stepSize）", () => {
  it("有余数时截掉", () => {
    expect(alignQty(parse("0.567"), parse("0.1"))).toBe(parse("0.5"));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
```

预期：`mulCeil`/`divRound`/`alignPrice`/`alignQty` 未定义。

- [ ] **Step 3: 实现**

在 `fixed.ts` 追加（`div` 函数之后）：

```ts
/** 乘法，向上取整（远离零），用于手续费——摩擦成本不被低估。假设操作数均非负。 */
export function mulCeil(a: Fixed, b: Fixed): Fixed {
  const product = a * b;
  const q = product / SCALE;
  const r = product % SCALE;
  return r === 0n ? q : q + 1n;
}

/** 除法，四舍五入（round half up），用于保证金率/强平价/未实现盈亏等展示类数值。 */
export function divRound(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("division by zero");
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const numerator = absA * SCALE * 2n + absB;
  const rounded = numerator / (absB * 2n);
  return negative ? -rounded : rounded;
}

/** 价格对齐 tickSize：买单向下，卖单向上。保守，不凭空给用户更好的价。 */
export function alignPrice(price: Fixed, tickSize: Fixed, side: "BUY" | "SELL"): Fixed {
  if (tickSize <= 0n) throw new Error("tickSize must be positive");
  const remainder = price % tickSize;
  if (remainder === 0n) return price;
  const floor = price - remainder;
  return side === "BUY" ? floor : floor + tickSize;
}

/** 数量对齐 stepSize：一律向下。不能超出用户想下的量。 */
export function alignQty(qty: Fixed, stepSize: Fixed): Fixed {
  if (stepSize <= 0n) throw new Error("stepSize must be positive");
  return qty - (qty % stepSize);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fixed.ts packages/shared/src/fixed.test.ts
git commit -m "feat(shared): fixed.ts 补齐五种舍入（mulCeil/divRound/alignPrice/alignQty）"
```

---

## Task 3: `enums.ts` + `errors.ts` + `shared` 出口

**Files:**
- Create: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/errors.test.ts`
- Create: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: 11 个枚举元组 + 类型（`CHAIN`/`Chain`、`POSITION_MODE`/`PositionMode`、`POSITION_SIDE`/`PositionSide`、`MARGIN_MODE`/`MarginMode`、`ORDER_SIDE`/`OrderSide`、`ORDER_TYPE`/`OrderType`、`TIME_IN_FORCE`/`TimeInForce`、`ORDER_STATUS`/`OrderStatus`、`FILL_ROLE`/`FillRole`、`WORKING_TYPE`/`WorkingType`、`LEDGER_TYPE`/`LedgerType`）；`ERROR_CODES`/`ErrorCode`（27 个码）、`ERROR_HTTP_STATUS: Record<ErrorCode, number>`、`class AppError extends Error`。这些是 Task 6（db enums）和 Task 4（engine types）的唯一数据来源，不许在别处重复声明字面量数组。

- [ ] **Step 1: 写失败的测试**

`packages/shared/src/errors.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS } from "./errors";

describe("errors", () => {
  it("04-backend-design.md 第 13 节列了 27 个错误码", () => {
    expect(ERROR_CODES.length).toBe(27);
  });

  it("每个错误码都有对应的 HTTP 状态码", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code], code).toBeTypeOf("number");
    }
  });

  it("AppError 携带 code 和 message", () => {
    const err = new AppError("INSUFFICIENT_MARGIN", "可用余额不足");
    expect(err.code).toBe("INSUFFICIENT_MARGIN");
    expect(err.message).toBe("可用余额不足");
    expect(err).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
```

- [ ] **Step 3: 实现 `enums.ts`**

`packages/shared/src/enums.ts`：

```ts
export const CHAIN = ["evm", "solana"] as const;
export type Chain = (typeof CHAIN)[number];

export const POSITION_MODE = ["ONE_WAY", "HEDGE"] as const;
export type PositionMode = (typeof POSITION_MODE)[number];

export const POSITION_SIDE = ["BOTH", "LONG", "SHORT"] as const;
export type PositionSide = (typeof POSITION_SIDE)[number];

export const MARGIN_MODE = ["CROSS", "ISOLATED"] as const;
export type MarginMode = (typeof MARGIN_MODE)[number];

export const ORDER_SIDE = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDE)[number];

export const ORDER_TYPE = [
  "LIMIT",
  "MARKET",
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
] as const;
export type OrderType = (typeof ORDER_TYPE)[number];

export const TIME_IN_FORCE = ["GTC", "IOC", "FOK", "GTX"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

export const ORDER_STATUS = [
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "REJECTED",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const FILL_ROLE = ["MAKER", "TAKER"] as const;
export type FillRole = (typeof FILL_ROLE)[number];

export const WORKING_TYPE = ["MARK_PRICE", "CONTRACT_PRICE"] as const;
export type WorkingType = (typeof WORKING_TYPE)[number];

export const LEDGER_TYPE = [
  "INITIAL",
  "RESET",
  "REALIZED_PNL",
  "FEE",
  "FUNDING",
  "LIQUIDATION",
  "LIQUIDATION_FEE",
  "MARGIN_TRANSFER",
] as const;
export type LedgerType = (typeof LEDGER_TYPE)[number];
```

- [ ] **Step 4: 实现 `errors.ts`**

`packages/shared/src/errors.ts`：

```ts
export const ERROR_CODES = [
  // 认证
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "NONCE_INVALID",
  "SIGNATURE_INVALID",
  // 下单（对应 04-backend-design.md 第 6 节校验链）
  "SYMBOL_NOT_TRADING",
  "MARKET_NOT_READY",
  "INVALID_PARAMS",
  "POSITION_SIDE_MISMATCH",
  "PRICE_FILTER",
  "LOT_SIZE",
  "MIN_NOTIONAL",
  "PERCENT_PRICE",
  "REDUCE_ONLY_REJECTED",
  "LEVERAGE_TOO_HIGH",
  "INSUFFICIENT_MARGIN",
  "MARKET_ORDER_TOO_LARGE",
  "POST_ONLY_REJECTED",
  "TOO_MANY_ORDERS",
  // 仓位与账户
  "ORDER_NOT_FOUND",
  "POSITION_NOT_FOUND",
  "MARGIN_MODE_LOCKED",
  "POSITION_MODE_LOCKED",
  "RESET_COOLING_DOWN",
  "MARGIN_WOULD_LIQUIDATE",
  // 系统
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  NONCE_INVALID: 400,
  SIGNATURE_INVALID: 400,
  SYMBOL_NOT_TRADING: 400,
  MARKET_NOT_READY: 503,
  INVALID_PARAMS: 400,
  POSITION_SIDE_MISMATCH: 400,
  PRICE_FILTER: 400,
  LOT_SIZE: 400,
  MIN_NOTIONAL: 400,
  PERCENT_PRICE: 400,
  REDUCE_ONLY_REJECTED: 400,
  LEVERAGE_TOO_HIGH: 400,
  INSUFFICIENT_MARGIN: 400,
  MARKET_ORDER_TOO_LARGE: 400,
  POST_ONLY_REJECTED: 400,
  TOO_MANY_ORDERS: 429,
  ORDER_NOT_FOUND: 404,
  POSITION_NOT_FOUND: 404,
  MARGIN_MODE_LOCKED: 409,
  POSITION_MODE_LOCKED: 409,
  RESET_COOLING_DOWN: 409,
  MARGIN_WOULD_LIQUIDATE: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** 服务端 ↔ 前端统一错误信封 { ok:false, error:{code,message} } 里的 error。message 是给用户直接看的中文。 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}
```

`packages/shared/src/index.ts`：

```ts
export * from "./enums";
export * from "./errors";
export * from "./fixed";
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/errors.ts packages/shared/src/errors.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): 枚举与错误码（对齐 03/04 设计文档），补 shared 出口"
```

---

## Task 4: `packages/engine` 包骨架 + `types.ts`

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/types.ts`

**Interfaces:**
- Consumes: `Fixed`、`ErrorCode`、`LedgerType`、`MarginMode`、`OrderStatus`、`OrderType`、`PositionMode`、`PositionSide`、`TimeInForce`、`WorkingType` from `@binance-contract-trading-full-stack/shared`（Task 3）。
- Produces: `Level`、`Account`、`Position`、`Order`、`Fill`、`PlaceOrderRequest`、`EngineInput`、`EngineEvent`、`EngineSnapshot`、`Engine` —— Task 5（`create-engine.ts`）以及未来里程碑的撮合/风控逻辑都实现/消费这些类型，字段名和 `02-architecture.md` 第六节、`04-backend-design.md` 第 3 节逐字对齐。

- [ ] **Step 1: 建包骨架**

`packages/engine/package.json`：

```json
{
  "name": "@binance-contract-trading-full-stack/engine",
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
    "test": "vitest run"
  },
  "dependencies": {
    "@binance-contract-trading-full-stack/shared": "workspace:*"
  },
  "devDependencies": {
    "@binance-contract-trading-full-stack/config": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  }
}
```

`packages/engine/tsconfig.json`：

```json
{
  "extends": "@binance-contract-trading-full-stack/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  }
}
```

`packages/engine/vitest.config.ts`：同 Task 1 的 `packages/shared/vitest.config.ts`（复制一份即可，`environment: "node"`）。

- [ ] **Step 2: 写 `types.ts`（无独立单测——纯类型声明，靠 Task 5 的 `create-engine.test.ts` 间接验证可编译）**

`packages/engine/src/types.ts`：

```ts
import type {
  ErrorCode,
  Fixed,
  LedgerType,
  MarginMode,
  OrderStatus,
  OrderType,
  PositionMode,
  PositionSide,
  TimeInForce,
  WorkingType,
} from "@binance-contract-trading-full-stack/shared";

export interface Level {
  price: Fixed;
  qty: Fixed;
}

export interface Account {
  id: string;
  walletBalance: Fixed;
  positionMode: PositionMode;
}

export interface Position {
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  marginMode: MarginMode;
  leverageNum: number;
  /** 始终 ≥ 0，方向完全由 positionSide 决定。 */
  qty: Fixed;
  entryPrice: Fixed;
  /** 仅逐仓有效。 */
  isolatedMargin: Fixed;
  openedAt: number;
}

export interface Order {
  id: string;
  clientOrderId: string;
  accountId: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: PositionSide;
  type: OrderType;
  timeInForce: TimeInForce;
  /** 市价单为 null。 */
  price: Fixed | null;
  stopPrice: Fixed | null;
  workingType: WorkingType;
  qty: Fixed;
  executedQty: Fixed;
  avgPrice: Fixed;
  reduceOnly: boolean;
  closePosition: boolean;
  status: OrderStatus;
  triggered: boolean;
  /** 拟真排队：前方还剩多少量。 */
  queueAhead: Fixed;
  queueEstimated: boolean;
  frozenMargin: Fixed;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  orderId: string;
  accountId: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: PositionSide;
  price: Fixed;
  qty: Fixed;
  role: "MAKER" | "TAKER";
  fee: Fixed;
  realizedPnl: Fixed;
  isLiquidation: boolean;
  ts: number;
}

export interface PlaceOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: PositionSide;
  type: OrderType;
  timeInForce?: TimeInForce;
  price?: Fixed;
  stopPrice?: Fixed;
  workingType?: WorkingType;
  qty?: Fixed;
  reduceOnly?: boolean;
  closePosition?: boolean;
}

export type EngineInput =
  | { t: "book"; symbol: string; bids: Level[]; asks: Level[]; ts: number }
  | { t: "trade"; symbol: string; price: Fixed; qty: Fixed; buyerIsMaker: boolean; ts: number }
  | {
      t: "markPrice";
      symbol: string;
      markPrice: Fixed;
      fundingRate: Fixed;
      nextFundingTs: number;
      ts: number;
    }
  | { t: "placeOrder"; accountId: string; req: PlaceOrderRequest; ts: number }
  | { t: "cancelOrder"; accountId: string; orderId: string; ts: number }
  | { t: "settleFunding"; symbol: string; rate: Fixed; markPrice: Fixed; ts: number }
  | { t: "setLeverage"; accountId: string; symbol: string; leverageNum: number; ts: number }
  | { t: "setMarginMode"; accountId: string; symbol: string; mode: MarginMode; ts: number };

export type EngineEvent =
  | { t: "orderUpdate"; order: Order }
  | { t: "fill"; fill: Fill }
  | { t: "positionUpdate"; position: Position }
  | {
      t: "balanceUpdate";
      accountId: string;
      walletBalance: Fixed;
      reason: LedgerType;
      delta: Fixed;
      refId?: string;
    }
  | { t: "liquidation"; accountId: string; symbol: string; positions: Position[]; markPrice: Fixed }
  | { t: "fundingPaid"; accountId: string; symbol: string; amount: Fixed; rate: Fixed }
  | { t: "rejected"; clientOrderId: string; code: ErrorCode; message: string };

/**
 * 引擎全部内存状态的快照。字段目前只到"骨架"精度（account/position/order 三张表），
 * 盘口、标记价等行情态不入快照——行情由宿主在 book/markPrice 事件里持续喂入，重启后可以
 * 重新订阅，没必要跟着账户状态一起存快照。真正的撮合逻辑落地时如需要更多字段，在这里加。
 */
export interface EngineSnapshot {
  accounts: Account[];
  positions: Position[];
  orders: Order[];
}

export interface Engine {
  apply(input: EngineInput): EngineEvent[];
  snapshot(): EngineSnapshot;
  restore(snapshot: EngineSnapshot): void;
}
```

- [ ] **Step 3: 确认编译通过（暂时还没有实现 `create-engine.ts`，只检查类型文件本身）**

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run check-types
```

预期：会报 `src/index.ts` 缺失一类的错误——这是正常的，`index.ts` 和实现在 Task 5 补上。如果此时 `package.json` 的 `exports` 还没有 `index.ts` 文件，`check-types` 只检查 `src/**/*.ts` 现存文件，`types.ts` 本身应该无错。若报错来自 `types.ts`，先修好再继续。

- [ ] **Step 4: Commit**

```bash
git add packages/engine/package.json packages/engine/tsconfig.json packages/engine/vitest.config.ts packages/engine/src/types.ts
git commit -m "feat(engine): 包骨架 + 跨层契约类型（EngineInput/EngineEvent/Engine）"
```

---

## Task 5: `create-engine.ts` 骨架实现 + 引擎纯净性 guard 测试

**Files:**
- Create: `packages/engine/src/create-engine.ts`
- Create: `packages/engine/src/create-engine.test.ts`
- Create: `packages/engine/src/purity.test.ts`
- Create: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `Engine`、`EngineInput`、`EngineEvent`、`EngineSnapshot` from Task 4 `./types`.
- Produces: `createEngine(initial?: EngineSnapshot): Engine` —— 这是宿主（`apps/server/src/engine-host`，未来里程碑）拿到引擎实例的唯一入口，`apply` 目前对任何输入都返回空数组（真撮合逻辑是后续里程碑的工作），但接口形状已经锁定。

- [ ] **Step 1: 写失败的测试**

`packages/engine/src/create-engine.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createEngine } from "./create-engine";

describe("createEngine", () => {
  it("骨架阶段 apply 对任意输入返回空事件数组", () => {
    const engine = createEngine();
    const events = engine.apply({
      t: "cancelOrder",
      accountId: "acc-1",
      orderId: "order-1",
      ts: 0,
    });
    expect(events).toEqual([]);
  });

  it("snapshot 反映构造时传入的初始状态", () => {
    const initial = {
      accounts: [{ id: "acc-1", walletBalance: 1_000_000_000_000n, positionMode: "ONE_WAY" as const }],
      positions: [],
      orders: [],
    };
    const engine = createEngine(initial);
    expect(engine.snapshot()).toEqual(initial);
  });

  it("restore 之后 snapshot 反映新状态，不影响旧快照对象", () => {
    const engine = createEngine();
    const before = engine.snapshot();
    const next = {
      accounts: [{ id: "acc-2", walletBalance: 0n, positionMode: "HEDGE" as const }],
      positions: [],
      orders: [],
    };
    engine.restore(next);
    expect(engine.snapshot()).toEqual(next);
    expect(before).toEqual({ accounts: [], positions: [], orders: [] });
  });
});
```

`packages/engine/src/purity.test.ts`（自动化守住 CLAUDE.md 硬约束 #2）：

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = import.meta.dirname;

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bDate\.now\(/,
  /\bMath\.random\(/,
  /\bconsole\./,
  /\bsetTimeout\(/,
  /\bsetInterval\(/,
  /from\s+["']node:/,
  /from\s+["']fs["']/,
  /from\s+["']drizzle-orm/,
  /from\s+["']pg["']/,
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith(".test.ts")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("engine 纯净性（CLAUDE.md 硬约束 #2）", () => {
  it("源码不出现数据库/网络/文件系统/时钟/随机数调用", () => {
    for (const file of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${file} 命中禁止模式 ${pattern}`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run test
```

预期：`create-engine.ts` 不存在，`create-engine.test.ts` 报模块找不到；`purity.test.ts` 应该能跑（此时只扫到 `types.ts` 和测试文件本身，会通过——这条先记下，Step 4 之后重跑一次确认仍然通过）。

- [ ] **Step 3: 实现**

`packages/engine/src/create-engine.ts`：

```ts
import type { Engine, EngineEvent, EngineInput, EngineSnapshot } from "./types";

const EMPTY_SNAPSHOT: EngineSnapshot = { accounts: [], positions: [], orders: [] };

/**
 * 骨架阶段的引擎：只落实 Engine 接口的形状和内存状态的存取，
 * 不含任何撮合/风控/清算逻辑——那是后续里程碑的工作。
 */
export function createEngine(initial: EngineSnapshot = EMPTY_SNAPSHOT): Engine {
  let state: EngineSnapshot = {
    accounts: [...initial.accounts],
    positions: [...initial.positions],
    orders: [...initial.orders],
  };

  return {
    apply(_input: EngineInput): EngineEvent[] {
      return [];
    },
    snapshot(): EngineSnapshot {
      return {
        accounts: [...state.accounts],
        positions: [...state.positions],
        orders: [...state.orders],
      };
    },
    restore(snapshot: EngineSnapshot): void {
      state = {
        accounts: [...snapshot.accounts],
        positions: [...snapshot.positions],
        orders: [...snapshot.orders],
      };
    },
  };
}
```

`packages/engine/src/index.ts`：

```ts
export * from "./create-engine";
export * from "./types";
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/engine run test
pnpm --filter @binance-contract-trading-full-stack/engine run check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/create-engine.ts packages/engine/src/create-engine.test.ts \
  packages/engine/src/purity.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): createEngine 骨架实现 + 纯净性 guard 测试"
```

---

## Task 6: `packages/db` `enums.ts`（接入 shared）

**Files:**
- Create: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/package.json`（加 `shared` 依赖）

**Interfaces:**
- Consumes: `CHAIN`、`POSITION_MODE`、`POSITION_SIDE`、`MARGIN_MODE`、`ORDER_SIDE`、`ORDER_TYPE`、`TIME_IN_FORCE`、`ORDER_STATUS`、`FILL_ROLE`、`WORKING_TYPE`、`LEDGER_TYPE` from `@binance-contract-trading-full-stack/shared`（Task 3）。
- Produces: `chainEnum`、`positionModeEnum`、`positionSideEnum`、`marginModeEnum`、`orderSideEnum`、`orderTypeEnum`、`timeInForceEnum`、`orderStatusEnum`、`fillRoleEnum`、`workingTypeEnum`、`ledgerTypeEnum`（都是 Drizzle `pgEnum`）—— Task 7/8/9 的表定义直接 `import { xxxEnum } from "./enums"`。

这一步是纯 schema 声明，没有可跑的业务逻辑测试；用 `check-types` 当验证手段。

- [ ] **Step 1: 加依赖**

在 `packages/db/package.json` 的 `"dependencies"` 里加：

```json
    "@binance-contract-trading-full-stack/shared": "workspace:*",
```

- [ ] **Step 2: 实现 `enums.ts`**

`packages/db/src/schema/enums.ts`：

```ts
import {
  CHAIN,
  FILL_ROLE,
  LEDGER_TYPE,
  MARGIN_MODE,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_MODE,
  POSITION_SIDE,
  TIME_IN_FORCE,
  WORKING_TYPE,
} from "@binance-contract-trading-full-stack/shared";
import { pgEnum } from "drizzle-orm/pg-core";

export const chainEnum = pgEnum("chain", CHAIN);
export const positionModeEnum = pgEnum("position_mode", POSITION_MODE);
export const positionSideEnum = pgEnum("position_side", POSITION_SIDE);
export const marginModeEnum = pgEnum("margin_mode", MARGIN_MODE);
export const orderSideEnum = pgEnum("order_side", ORDER_SIDE);
export const orderTypeEnum = pgEnum("order_type", ORDER_TYPE);
export const timeInForceEnum = pgEnum("time_in_force", TIME_IN_FORCE);
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUS);
export const fillRoleEnum = pgEnum("fill_role", FILL_ROLE);
export const workingTypeEnum = pgEnum("working_type", WORKING_TYPE);
export const ledgerTypeEnum = pgEnum("ledger_type", LEDGER_TYPE);
```

在 `packages/db/src/schema/index.ts` 追加：

```ts
export * from "./enums";
```

（保留原有 `export * from "./books";`。）

- [ ] **Step 3: 安装依赖 + 验证**

```bash
pnpm install
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/src/schema/enums.ts packages/db/src/schema/index.ts
git commit -m "feat(db): 11 个 pgEnum，接入 packages/shared 的枚举元组"
```

---

## Task 7: `symbols` + `leverage_brackets` 表

**Files:**
- Create: `packages/db/src/schema/symbols.ts`
- Create: `packages/db/src/schema/leverage-brackets.ts`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Produces: `symbols`（表 + `Symbol`/`NewSymbol` 类型）、`leverageBrackets`（表 + `LeverageBracket`/`NewLeverageBracket` 类型）——Task 11（`seed:symbols`）、Task 12（`verify:brackets`/`seed:brackets`）都要 `import { symbols, leverageBrackets } from "@binance-contract-trading-full-stack/db"`。

- [ ] **Step 1: 实现 `symbols.ts`**

`packages/db/src/schema/symbols.ts`：

```ts
import { bigint, boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(),
  baseAsset: text("base_asset").notNull(),
  quoteAsset: text("quote_asset").notNull(),
  status: text("status").notNull(),
  pricePrecision: integer("price_precision").notNull(),
  quantityPrecision: integer("quantity_precision").notNull(),
  tickSize: bigint("tick_size", { mode: "bigint" }).notNull(),
  stepSize: bigint("step_size", { mode: "bigint" }).notNull(),
  minQty: bigint("min_qty", { mode: "bigint" }).notNull(),
  minNotional: bigint("min_notional", { mode: "bigint" }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
```

- [ ] **Step 2: 实现 `leverage-brackets.ts`**

`packages/db/src/schema/leverage-brackets.ts`：

```ts
import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { symbols } from "./symbols";

export const leverageBrackets = pgTable(
  "leverage_brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    bracket: integer("bracket").notNull(),
    notionalFloor: bigint("notional_floor", { mode: "bigint" }).notNull(),
    notionalCap: bigint("notional_cap", { mode: "bigint" }).notNull(),
    maxLeverage: integer("max_leverage").notNull(),
    /** 定标 1e8：0.4% → 400000n，不许用 float 存比例。 */
    mmr: bigint("mmr", { mode: "bigint" }).notNull(),
    cum: bigint("cum", { mode: "bigint" }).notNull(),
  },
  (t) => [
    uniqueIndex("lb_symbol_bracket_uq").on(t.symbol, t.bracket),
    index("lb_symbol_cap_idx").on(t.symbol, t.notionalCap),
  ],
);

export type LeverageBracket = typeof leverageBrackets.$inferSelect;
export type NewLeverageBracket = typeof leverageBrackets.$inferInsert;
```

在 `schema/index.ts` 追加：

```ts
export * from "./leverage-brackets";
export * from "./symbols";
```

- [ ] **Step 3: 验证**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/symbols.ts packages/db/src/schema/leverage-brackets.ts packages/db/src/schema/index.ts
git commit -m "feat(db): symbols + leverage_brackets 表（市场规格组）"
```

---

## Task 8: `accounts` + `auth_nonces` + `account_symbol_settings` 表

**Files:**
- Create: `packages/db/src/schema/accounts.ts`
- Create: `packages/db/src/schema/auth-nonces.ts`
- Create: `packages/db/src/schema/account-symbol-settings.ts`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `chainEnum`、`positionModeEnum`、`marginModeEnum`（Task 6）、`symbols`（Task 7）。
- Produces: `accounts`、`authNonces`、`accountSymbolSettings`（各带 `$inferSelect`/`$inferInsert` 类型）——Task 9 的 `positions`/`orders`/`fills`/ledger 组都要 `references(() => accounts.id)`。

- [ ] **Step 1: 实现 `accounts.ts`**

`packages/db/src/schema/accounts.ts`：

```ts
import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chainEnum, positionModeEnum } from "./enums";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** EVM 统一小写；Solana 保持 base58 原样。 */
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    walletBalance: bigint("wallet_balance", { mode: "bigint" }).notNull().default(0n),
    positionMode: positionModeEnum("position_mode").notNull().default("ONE_WAY"),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }),
    /** 排行榜显示名，默认脱敏地址。 */
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_chain_address_uq").on(t.chain, t.address)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
```

- [ ] **Step 2: 实现 `auth-nonces.ts`**

`packages/db/src/schema/auth-nonces.ts`：

```ts
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chainEnum } from "./enums";

export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    nonce: text("nonce").notNull(),
    /** 完整的待签名文本，验签必须用这份服务端原文，不能用客户端回传的文本。 */
    message: text("message").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("nonces_addr_idx").on(t.chain, t.address),
    index("nonces_expires_idx").on(t.expiresAt),
  ],
);

export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
```

- [ ] **Step 3: 实现 `account-symbol-settings.ts`**

`packages/db/src/schema/account-symbol-settings.ts`：

```ts
import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum } from "./enums";
import { symbols } from "./symbols";

export const accountSymbolSettings = pgTable(
  "account_symbol_settings",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    leverage: integer("leverage").notNull().default(20),
    marginMode: marginModeEnum("margin_mode").notNull().default("CROSS"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.symbol] })],
);

export type AccountSymbolSetting = typeof accountSymbolSettings.$inferSelect;
export type NewAccountSymbolSetting = typeof accountSymbolSettings.$inferInsert;
```

在 `schema/index.ts` 追加：

```ts
export * from "./account-symbol-settings";
export * from "./accounts";
export * from "./auth-nonces";
```

- [ ] **Step 4: 验证**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/accounts.ts packages/db/src/schema/auth-nonces.ts \
  packages/db/src/schema/account-symbol-settings.ts packages/db/src/schema/index.ts
git commit -m "feat(db): accounts + auth_nonces + account_symbol_settings 表（账户组）"
```

---

## Task 9: `positions` + `orders` + `fills` 表

**Files:**
- Create: `packages/db/src/schema/positions.ts`
- Create: `packages/db/src/schema/orders.ts`
- Create: `packages/db/src/schema/fills.ts`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `accounts`（Task 8）、`symbols`（Task 7）、`positionSideEnum`/`marginModeEnum`/`orderSideEnum`/`orderTypeEnum`/`timeInForceEnum`/`workingTypeEnum`/`orderStatusEnum`/`fillRoleEnum`（Task 6）。
- Produces: `positions`、`orders`、`fills`（各带类型）——Task 10 的 ledger 组、以及未来 `persistTradeBatch` 事务写入都要用到。

- [ ] **Step 1: 实现 `positions.ts`**

`packages/db/src/schema/positions.ts`：

```ts
import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum, positionSideEnum } from "./enums";
import { symbols } from "./symbols";

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    positionSide: positionSideEnum("position_side").notNull(),
    marginMode: marginModeEnum("margin_mode").notNull(),
    leverage: integer("leverage").notNull(),
    /** 恒为非负，方向由 positionSide 决定。 */
    qty: bigint("qty", { mode: "bigint" }).notNull().default(0n),
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull().default(0n),
    isolatedMargin: bigint("isolated_margin", { mode: "bigint" }).notNull().default(0n),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_acc_sym_side_uq").on(t.accountId, t.symbol, t.positionSide),
    // 部分索引：只索引活跃仓位，资金费结算和强平扫描按币对高频捞取。
    index("pos_symbol_open_idx").on(t.symbol).where(sql`qty > 0`),
  ],
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
```

- [ ] **Step 2: 实现 `orders.ts`**

`packages/db/src/schema/orders.ts`：

```ts
import { sql } from "drizzle-orm";
import { bigint, boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import {
  orderSideEnum,
  orderStatusEnum,
  orderTypeEnum,
  positionSideEnum,
  timeInForceEnum,
  workingTypeEnum,
} from "./enums";
import { symbols } from "./symbols";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrderId: text("client_order_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    side: orderSideEnum("side").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    type: orderTypeEnum("type").notNull(),
    timeInForce: timeInForceEnum("time_in_force").notNull().default("GTC"),
    /** 市价单为 null。 */
    price: bigint("price", { mode: "bigint" }),
    stopPrice: bigint("stop_price", { mode: "bigint" }),
    workingType: workingTypeEnum("working_type").notNull().default("MARK_PRICE"),
    qty: bigint("qty", { mode: "bigint" }).notNull(),
    executedQty: bigint("executed_qty", { mode: "bigint" }).notNull().default(0n),
    avgPrice: bigint("avg_price", { mode: "bigint" }).notNull().default(0n),
    reduceOnly: boolean("reduce_only").notNull().default(false),
    closePosition: boolean("close_position").notNull().default(false),
    status: orderStatusEnum("status").notNull().default("NEW"),
    triggered: boolean("triggered").notNull().default(false),
    /** 拟真排队状态，跟订单一起持久化；重启不直接复用旧值（见 02-architecture.md 第七节）。 */
    queueAhead: bigint("queue_ahead", { mode: "bigint" }).notNull().default(0n),
    queueEstimated: boolean("queue_estimated").notNull().default(false),
    frozenMargin: bigint("frozen_margin", { mode: "bigint" }).notNull().default(0n),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 下单幂等：同一账户重复提交同一个 clientOrderId 不会重复下单。
    uniqueIndex("orders_acc_client_uq").on(t.accountId, t.clientOrderId),
    index("orders_open_idx")
      .on(t.symbol, t.status)
      .where(sql`status IN ('NEW','PARTIALLY_FILLED')`),
    index("orders_acc_created_idx").on(t.accountId, t.createdAt.desc()),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
```

- [ ] **Step 3: 实现 `fills.ts`**

`packages/db/src/schema/fills.ts`：

```ts
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { fillRoleEnum, orderSideEnum, positionSideEnum } from "./enums";
import { orders } from "./orders";

export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    side: orderSideEnum("side").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    price: bigint("price", { mode: "bigint" }).notNull(),
    qty: bigint("qty", { mode: "bigint" }).notNull(),
    role: fillRoleEnum("role").notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull(),
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull().default(0n),
    isLiquidation: boolean("is_liquidation").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fills_acc_created_idx").on(t.accountId, t.createdAt.desc()),
    index("fills_order_idx").on(t.orderId),
  ],
);

export type Fill = typeof fills.$inferSelect;
export type NewFill = typeof fills.$inferInsert;
```

在 `schema/index.ts` 追加：

```ts
export * from "./fills";
export * from "./orders";
export * from "./positions";
```

- [ ] **Step 4: 验证**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/positions.ts packages/db/src/schema/orders.ts \
  packages/db/src/schema/fills.ts packages/db/src/schema/index.ts
git commit -m "feat(db): positions + orders + fills 表（交易组）"
```

---

## Task 10: `ledger_entries` + `funding_payments` + `liquidations` + `equity_snapshots` 表 + 首次 `db:generate`

**Files:**
- Create: `packages/db/src/schema/ledger-entries.ts`
- Create: `packages/db/src/schema/funding-payments.ts`
- Create: `packages/db/src/schema/liquidations.ts`
- Create: `packages/db/src/schema/equity-snapshots.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generate: `packages/db/src/migrations/0001_*.sql`（`drizzle-kit generate` 产物，文件名由工具决定）

**Interfaces:**
- Consumes: `accounts`（Task 8）、`ledgerTypeEnum`/`positionSideEnum`/`marginModeEnum`（Task 6）。
- Produces: `ledgerEntries`、`fundingPayments`、`liquidations`、`equitySnapshots`——**`ledgerEntries` 是全系统资金的唯一真相**，Task 13（`reconcile:ledger`）直接查这张表。这个任务做完，12 张表全部到位，第一次生成迁移文件验收 M0 的"数据库"部分。

- [ ] **Step 1: 实现 `ledger-entries.ts`**

`packages/db/src/schema/ledger-entries.ts`：

```ts
import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { ledgerTypeEnum } from "./enums";

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: ledgerTypeEnum("type").notNull(),
    /** 与币对无关的流水（比如 INITIAL/RESET）为 null。 */
    symbol: text("symbol"),
    /** 有符号：收入为正，支出为负。 */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_acc_created_idx").on(t.accountId, t.createdAt.desc()),
    index("ledger_acc_type_idx").on(t.accountId, t.type),
  ],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
```

- [ ] **Step 2: 实现 `funding-payments.ts`**

`packages/db/src/schema/funding-payments.ts`：

```ts
import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { positionSideEnum } from "./enums";

export const fundingPayments = pgTable(
  "funding_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    fundingRate: bigint("funding_rate", { mode: "bigint" }).notNull(),
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(),
    notional: bigint("notional", { mode: "bigint" }).notNull(),
    /** 有符号：付出为负。 */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("funding_acc_settled_idx").on(t.accountId, t.settledAt.desc()),
    // 防重复结算：定时器因重启重复触发时，唯一约束挡住第二次写入。
    uniqueIndex("funding_uq").on(t.accountId, t.symbol, t.positionSide, t.settledAt),
  ],
);

export type FundingPayment = typeof fundingPayments.$inferSelect;
export type NewFundingPayment = typeof fundingPayments.$inferInsert;
```

- [ ] **Step 3: 实现 `liquidations.ts`**

`packages/db/src/schema/liquidations.ts`：

```ts
import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { marginModeEnum, positionSideEnum } from "./enums";

export const liquidations = pgTable(
  "liquidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    positionSide: positionSideEnum("position_side").notNull(),
    marginMode: marginModeEnum("margin_mode").notNull(),
    qty: bigint("qty", { mode: "bigint" }).notNull(),
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull(),
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(),
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(),
    liquidationFee: bigint("liquidation_fee", { mode: "bigint" }).notNull(),
    /** 取证字段：用户质疑强平时，把这两个数摆出来就能说清楚。 */
    marginBalanceBefore: bigint("margin_balance_before", { mode: "bigint" }).notNull(),
    maintMarginAt: bigint("maint_margin_at", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("liq_acc_created_idx").on(t.accountId, t.createdAt.desc())],
);

export type Liquidation = typeof liquidations.$inferSelect;
export type NewLiquidation = typeof liquidations.$inferInsert;
```

- [ ] **Step 4: 实现 `equity-snapshots.ts`**

`packages/db/src/schema/equity-snapshots.ts`：

```ts
import { bigint, date, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** UTC 日期。 */
    snapDate: date("snap_date").notNull(),
    /** 钱包余额 + 未实现盈亏。 */
    equity: bigint("equity", { mode: "bigint" }).notNull(),
    walletBalance: bigint("wallet_balance", { mode: "bigint" }).notNull(),
    /** 自上次重置以来的累计盈亏。 */
    cumulativePnl: bigint("cumulative_pnl", { mode: "bigint" }).notNull(),
    /** 定标 1e8 的收益率。 */
    roi: bigint("roi", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("equity_acc_date_uq").on(t.accountId, t.snapDate),
    index("equity_date_roi_idx").on(t.snapDate, t.roi.desc()),
  ],
);

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type NewEquitySnapshot = typeof equitySnapshots.$inferInsert;
```

在 `schema/index.ts` 追加：

```ts
export * from "./equity-snapshots";
export * from "./funding-payments";
export * from "./ledger-entries";
export * from "./liquidations";
```

- [ ] **Step 5: 生成迁移，验证 12 张业务表 + `books` 都出现在 SQL 里**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
pnpm run db:generate
```

预期：`drizzle-kit generate` 在 `packages/db/src/migrations/` 下新增一个 `NNNN_xxx.sql`。打开它确认包含 `CREATE TABLE "symbols"`、`"leverage_brackets"`、`"accounts"`、`"auth_nonces"`、`"account_symbol_settings"`、`"positions"`、`"orders"`、`"fills"`、`"ledger_entries"`、`"funding_payments"`、`"liquidations"`、`"equity_snapshots"` 共 12 张，加上已有的 `"books"`。**这一步不需要真实的 Supabase 连接**——`generate` 只读 schema 文件，不连库。`db:push`/`db:migrate` 需要 `DATABASE_URL`，留到 Supabase 项目选定后再跑（见 `HANDOFF.md` 第七节）。

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/ledger-entries.ts packages/db/src/schema/funding-payments.ts \
  packages/db/src/schema/liquidations.ts packages/db/src/schema/equity-snapshots.ts \
  packages/db/src/schema/index.ts packages/db/src/migrations/
git commit -m "feat(db): ledger_entries + funding_payments + liquidations + equity_snapshots 表（账目组），首次生成迁移"
```

---

## Task 11: `seed:symbols` 脚本

**Files:**
- Create: `packages/db/src/scripts/seed-symbols.ts`
- Create: `packages/db/src/scripts/seed-symbols.test.ts`
- Create: `packages/db/vitest.config.ts`
- Modify: `packages/db/package.json`（加 `tsx`/`vitest` 依赖 + `test`/`seed:symbols` script——`packages/db` 在此之前没有任何单测，这是它第一次接入 Vitest）

**Interfaces:**
- Consumes: `symbols`（Task 7）、`createDb`（`packages/db/src/index.ts` 已有）。
- Produces: `mapExchangeInfoSymbol(raw: BinanceExchangeInfoSymbol): NewSymbol`（纯函数，可单测，不碰网络）+ `main()`（真正发请求 + upsert，留给人工在配好 `DATABASE_URL` 之后手动跑，本计划不在无库环境下执行它）。

- [ ] **Step 1: 接入 Vitest + 加依赖**

`packages/db/vitest.config.ts`（同 Task 1 的 `packages/shared/vitest.config.ts`）：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

在 `packages/db/package.json` 的 `"devDependencies"` 加：

```json
    "tsx": "^4.23.13",
    "vitest": "catalog:",
```

在 `"scripts"` 加：

```json
    "test": "vitest run",
    "seed:symbols": "tsx src/scripts/seed-symbols.ts",
```

```bash
pnpm install
```

- [ ] **Step 2: 写失败的测试（只测纯函数部分，不碰网络/数据库）**

`packages/db/src/scripts/seed-symbols.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mapExchangeInfoSymbol } from "./seed-symbols";

describe("mapExchangeInfoSymbol", () => {
  it("把币安 exchangeInfo 的一条 symbol 记录映射成 NewSymbol", () => {
    const raw = {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "556.80", maxPrice: "4529764" },
        { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "1000" },
        { filterType: "MIN_NOTIONAL", notional: "5" },
      ],
    };

    const mapped = mapExchangeInfoSymbol(raw);

    expect(mapped.symbol).toBe("BTCUSDT");
    expect(mapped.baseAsset).toBe("BTC");
    expect(mapped.quoteAsset).toBe("USDT");
    expect(mapped.status).toBe("TRADING");
    expect(mapped.pricePrecision).toBe(2);
    expect(mapped.quantityPrecision).toBe(3);
    expect(mapped.tickSize).toBe(10000000n); // 0.10 * 1e8
    expect(mapped.stepSize).toBe(100000n); // 0.001 * 1e8
    expect(mapped.minQty).toBe(100000n);
    expect(mapped.minNotional).toBe(500000000n); // 5 * 1e8
  });

  it("缺少某个 filter 时抛出明确错误，而不是悄悄给默认值", () => {
    const raw = {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      status: "TRADING",
      pricePrecision: 2,
      quantityPrecision: 3,
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "0", maxPrice: "0" }],
    };

    expect(() => mapExchangeInfoSymbol(raw)).toThrow(/LOT_SIZE/);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run test
```

预期：`mapExchangeInfoSymbol` 未定义。

- [ ] **Step 4: 实现**

`packages/db/src/scripts/seed-symbols.ts`：

```ts
import "varlock/auto-load";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";
import { symbols, type NewSymbol } from "../schema/symbols";

const EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

interface BinanceFilter {
  filterType: string;
  [key: string]: string | number;
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
    tickSize: parse(String(priceFilter.tickSize)),
    stepSize: parse(String(lotSizeFilter.stepSize)),
    minQty: parse(String(lotSizeFilter.minQty)),
    minNotional: parse(String(minNotionalFilter.notional)),
    // enabled/sortOrder 不动：symbols 表已有的行保留人工设置的开放状态，
    // 新出现的币对默认 enabled=false，需要人工决定要不要开放。
  };
}

async function main() {
  const res = await fetch(EXCHANGE_INFO_URL);
  if (!res.ok) {
    throw new Error(`拉取 exchangeInfo 失败: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { symbols: BinanceExchangeInfoSymbol[] };

  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  let created = 0;
  let updated = 0;

  for (const raw of body.symbols) {
    const row = mapExchangeInfoSymbol(raw);
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
          updatedAt: new Date(),
        })
        .where(eq(symbols.symbol, row.symbol));
      updated += 1;
    }
  }

  console.log(`seed:symbols 完成：新建 ${created} 个，更新 ${updated} 个。`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run test
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

> `main()` 本身不在这一步执行——没有配置 `DATABASE_URL`（Supabase 项目还没选定，见 `HANDOFF.md` 第七节）。等库配好后手动跑 `pnpm --filter @binance-contract-trading-full-stack/db run seed:symbols` 做一次真实联调。

- [ ] **Step 6: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/src/scripts/seed-symbols.ts packages/db/src/scripts/seed-symbols.test.ts
git commit -m "feat(db): seed:symbols 脚本（纯映射函数已测，真实联调待 Supabase 就绪）"
```

---

## Task 12: `leverage-brackets.json` 模板 + `verify:brackets` 脚本

> ⚠️ **这一步不生成任何真实的分层数字。** `03-database-design.md` 第九节明确写了："分层表的数字必须从币安页面人工核对，不要让 AI 凭记忆生成。生成错了会导致所有强平价系统性偏差，而且 `verify:brackets` 只能查出内部不连续，查不出整体抄错一档。" 本任务只交付：数据结构、校验逻辑、和一份**空的**待填模板 + 说明文档。真实数值由人工对照币安页面逐个币对填入。

**Files:**
- Create: `packages/db/src/seed/leverage-brackets.schema.ts`
- Create: `packages/db/src/seed/leverage-brackets.json`
- Create: `packages/db/src/seed/README.md`
- Create: `packages/db/src/scripts/verify-brackets.ts`
- Create: `packages/db/src/scripts/verify-brackets.test.ts`
- Modify: `packages/db/package.json`（加 `verify:brackets` script + `zod` 已有，不用新加依赖）

**Interfaces:**
- Produces: `LeverageBracketFileSchema`（zod）、`type LeverageBracketFile = Record<symbol, BracketRow[]>`、`checkContinuity(brackets: BracketRow[]): ContinuityResult`（纯函数，Task 13 `seed:brackets` 复用同一个 schema 做导入前校验）。

- [ ] **Step 1: 写失败的测试（只测纯函数 `checkContinuity`，不依赖真实数据）**

`packages/db/src/scripts/verify-brackets.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { checkContinuity } from "./verify-brackets";
import type { BracketRow } from "../seed/leverage-brackets.schema";

function bracket(partial: Partial<BracketRow>): BracketRow {
  return {
    bracket: 1,
    notionalFloor: "0",
    notionalCap: "50000",
    maxLeverage: 125,
    mmr: "0.004",
    cum: "0",
    ...partial,
  };
}

describe("checkContinuity", () => {
  it("相邻两层在边界名义价值上维持保证金相等时通过", () => {
    // N=50000, 低层 mmr=0.004 cum=0 → mm=200；高层要在同一个 N 上算出同样的 200
    // 低层 mm = N*mmr - cum = 50000*0.005 - 50 = 200 → cum=50 时 mmr=0.005
    const rows: BracketRow[] = [
      bracket({ bracket: 1, notionalCap: "50000", mmr: "0.004", cum: "0" }),
      bracket({ bracket: 2, notionalFloor: "50000", notionalCap: "250000", mmr: "0.005", cum: "50" }),
    ];
    const result = checkContinuity(rows);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("cum 抄错时报出具体是第几层边界", () => {
    const rows: BracketRow[] = [
      bracket({ bracket: 1, notionalCap: "50000", mmr: "0.004", cum: "0" }),
      bracket({ bracket: 2, notionalFloor: "50000", notionalCap: "250000", mmr: "0.005", cum: "999" }),
    ];
    const result = checkContinuity(rows);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ atBracket: 1 }]);
  });

  it("只有一层时视为通过（没有边界要比）", () => {
    const result = checkContinuity([bracket({})]);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run test
```

- [ ] **Step 3: 实现 schema + 校验逻辑**

`packages/db/src/seed/leverage-brackets.schema.ts`：

```ts
import { z } from "zod";

/** 数值一律十进制字符串，导入脚本用 shared 的 parse() 转成 Fixed。 */
export const BracketRowSchema = z.object({
  bracket: z.number().int().min(1),
  notionalFloor: z.string(),
  notionalCap: z.string(),
  maxLeverage: z.number().int().min(1),
  mmr: z.string(),
  cum: z.string(),
});

export type BracketRow = z.infer<typeof BracketRowSchema>;

/** 文件整体：symbol → 按 bracket 升序排列的分层数组。 */
export const LeverageBracketFileSchema = z.record(z.string(), z.array(BracketRowSchema));

export type LeverageBracketFile = z.infer<typeof LeverageBracketFileSchema>;
```

`packages/db/src/scripts/verify-brackets.ts`：

```ts
import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { div, mul, parse } from "@binance-contract-trading-full-stack/shared";
import { LeverageBracketFileSchema, type BracketRow } from "../seed/leverage-brackets.schema";

const DATA_PATH = fileURLToPath(new URL("../seed/leverage-brackets.json", import.meta.url));

export interface ContinuityResult {
  ok: boolean;
  mismatches: { atBracket: number }[];
}

/**
 * 对每对相邻层，在低层的边界名义价值 N（= 低层 notionalCap）上，
 * 两层算出的维持保证金必须相等：N*mmr_低 - cum_低 === N*mmr_高 - cum_高。
 * 纯函数，不碰文件系统——供 verify:brackets 脚本和单测共用。
 */
export function checkContinuity(brackets: BracketRow[]): ContinuityResult {
  const mismatches: { atBracket: number }[] = [];

  for (let i = 0; i < brackets.length - 1; i++) {
    const lower = brackets[i];
    const upper = brackets[i + 1];
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

function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const file = LeverageBracketFileSchema.parse(raw);
  const symbolNames = Object.keys(file);

  if (symbolNames.length === 0) {
    console.log("leverage-brackets.json 目前是空的——按 packages/db/src/seed/README.md 的说明人工填入后再跑这个脚本。");
    return;
  }

  let failCount = 0;
  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    const result = checkContinuity(brackets);
    if (result.ok) {
      console.log(`✓ ${symbol}：${brackets.length} 层，连续性通过`);
    } else {
      failCount += 1;
      console.error(`✗ ${symbol}：边界不连续 → ${JSON.stringify(result.mismatches)}`);
    }
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
```

`packages/db/src/seed/leverage-brackets.json`（先留空对象，人工逐个币对填入）：

```json
{}
```

`packages/db/src/seed/README.md`：

```markdown
# leverage-brackets.json 填写说明

**这个文件的数字必须从币安 App / 官网的"杠杆分层标准"页面人工核对，不允许由 AI 凭训练数据生成。**
生成错了会导致所有强平价系统性偏差，而 `verify:brackets` 只能查出*内部*不连续（相邻层边界对不上），
查不出*整体*抄错了一档——所以人工核对是唯一的防线。

## 格式

```json
{
  "BTCUSDT": [
    { "bracket": 1, "notionalFloor": "0", "notionalCap": "50000", "maxLeverage": 125, "mmr": "0.004", "cum": "0" },
    { "bracket": 2, "notionalFloor": "50000", "notionalCap": "250000", "maxLeverage": 100, "mmr": "0.005", "cum": "50" }
  ]
}
```

- 所有数值字段用十进制**字符串**（导入脚本会用 `packages/shared` 的 `parse()` 转成定标 1e8 的 `bigint`）。
- `mmr` 是维持保证金率的小数形式：币安页面写"0.4%"就填 `"0.004"`。
- `cum` 是速算额，币安页面直接给。
- 每个币对的层按 `bracket` 从 1 开始升序排列，跟币安页面顺序一致。

## 核对步骤（每个币对）

1. 打开币安 App/官网的杠杆分层表页面，找到对应合约。
2. 逐层抄 Notional Cap（上限名义价值）、Max Leverage、Maintenance Margin Rate、Maintenance Amount（= cum）。
3. 填完一个币对，跑一次 `pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets`，确认这个币对显示 `✓`。
4. 全部 20 个开放币对填完、全部 `✓` 之后，才能跑 `seed:brackets` 导入数据库。

## 覆盖范围

`CLAUDE.md` 说的 20 个开放币对——具体名单以 `symbols` 表里 `enabled = true` 的行为准（`seed:symbols` 跑完之后查）。
```

在 `packages/db/package.json` 的 `"scripts"` 加：

```json
    "verify:brackets": "tsx src/scripts/verify-brackets.ts",
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run test
pnpm --filter @binance-contract-trading-full-stack/db run check-types
pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets
```

预期最后一条命令打印"目前是空的"提示，退出码为 0（空文件不算失败，只是还没做）。

- [ ] **Step 5: Commit**

```bash
git add packages/db/package.json packages/db/src/seed/leverage-brackets.schema.ts \
  packages/db/src/seed/leverage-brackets.json packages/db/src/seed/README.md \
  packages/db/src/scripts/verify-brackets.ts packages/db/src/scripts/verify-brackets.test.ts
git commit -m "feat(db): 杠杆分层表模板 + verify:brackets 连续性校验（数值留空待人工核对）"
```

---

## Task 13: `seed:brackets` 脚本 + `reconcile:ledger` 脚本

**Files:**
- Create: `packages/db/src/scripts/seed-brackets.ts`
- Create: `packages/db/src/scripts/reconcile-ledger.ts`
- Modify: `packages/db/package.json`（加两条 script）

**Interfaces:**
- Consumes: `leverageBrackets`（Task 7）、`LeverageBracketFileSchema`/`checkContinuity`（Task 12）、`ledgerEntries`/`accounts`（Task 10/8）。
- Produces: `seed:brackets`、`reconcile:ledger` 两个可执行脚本——`reconcile:ledger` 是 `02-architecture.md` 第六节"账目唯一真相"不变式的自动化检查，后续要接到每小时定时任务。

- [ ] **Step 1: 实现 `seed-brackets.ts`**

导入前复用 Task 12 的 `checkContinuity`：任何币对连续性校验不过，整个导入中止，不写半张表。

`packages/db/src/scripts/seed-brackets.ts`：

```ts
import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";
import { leverageBrackets } from "../schema/leverage-brackets";
import { LeverageBracketFileSchema } from "../seed/leverage-brackets.schema";
import { checkContinuity } from "./verify-brackets";

const DATA_PATH = fileURLToPath(new URL("../seed/leverage-brackets.json", import.meta.url));

async function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const file = LeverageBracketFileSchema.parse(raw);
  const symbolNames = Object.keys(file);

  if (symbolNames.length === 0) {
    console.log("leverage-brackets.json 是空的，没有可导入的数据。先按 seed/README.md 填好。");
    return;
  }

  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    const result = checkContinuity(brackets);
    if (!result.ok) {
      throw new Error(
        `${symbol} 的分层表连续性校验不通过（${JSON.stringify(result.mismatches)}），导入中止，请先修正 leverage-brackets.json`,
      );
    }
  }

  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    await db.delete(leverageBrackets).where(eq(leverageBrackets.symbol, symbol));
    await db.insert(leverageBrackets).values(
      brackets.map((b) => ({
        symbol,
        bracket: b.bracket,
        notionalFloor: parse(b.notionalFloor),
        notionalCap: parse(b.notionalCap),
        maxLeverage: b.maxLeverage,
        mmr: parse(b.mmr),
        cum: parse(b.cum),
      })),
    );
  }

  console.log(`seed:brackets 完成：导入 ${symbolNames.length} 个币对的分层表。`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: 实现 `reconcile-ledger.ts`**

`packages/db/src/scripts/reconcile-ledger.ts`：

```ts
import "varlock/auto-load";
import { sql } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";

interface MismatchRow {
  id: string;
  wallet_balance: string;
  ledger_sum: string;
}

async function main() {
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

  // 02-architecture.md 第六节的不变式：accounts.wallet_balance === SUM(ledger_entries.amount)
  const result = await db.execute<MismatchRow>(sql`
    SELECT a.id, a.wallet_balance, l.s AS ledger_sum
    FROM accounts a
    JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l
      ON l.account_id = a.id
    WHERE a.wallet_balance <> l.s
  `);

  const mismatches = result.rows;

  if (mismatches.length > 0) {
    console.error(`发现 ${mismatches.length} 个账户余额与流水不一致：`);
    for (const row of mismatches) {
      console.error(`  account=${row.id} wallet_balance=${row.wallet_balance} ledger_sum=${row.ledger_sum}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("对账通过：所有账户 wallet_balance === SUM(ledger_entries.amount)。");
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

在 `packages/db/package.json` 的 `"scripts"` 加：

```json
    "seed:brackets": "tsx src/scripts/seed-brackets.ts",
    "reconcile:ledger": "tsx src/scripts/reconcile-ledger.ts",
```

- [ ] **Step 3: 验证类型**

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

> 两个脚本都需要真实 `DATABASE_URL` 才能端到端跑，留给 Supabase 项目就绪后手动执行一次联调（`seed:brackets` 依赖 Task 12 人工填好的分层数据；`reconcile:ledger` 在空库上跑也应该输出"对账通过"，因为没有账户就没有不一致）。

- [ ] **Step 4: Commit**

```bash
git add packages/db/package.json packages/db/src/scripts/seed-brackets.ts packages/db/src/scripts/reconcile-ledger.ts
git commit -m "feat(db): seed:brackets + reconcile:ledger 脚本"
```

---

## M0 验收清单（对照 HANDOFF.md 第五节）

- [ ] `pnpm run check-types` 全绿（web/server/native/shared/engine/db 全部通过）
- [ ] `pnpm run test` 全绿（shared 的 fixed/errors 测试、engine 的 create-engine/purity 测试、db 的 seed-symbols/verify-brackets 测试）
- [ ] `pnpm run db:generate` 产出的迁移 SQL 里能看到 12 张业务表 + `books`
- [ ] `packages/engine` 目录下没有 `Date.now`/`Math.random`/`console.*`/`setTimeout`/db-network 相关 import（`purity.test.ts` 兜底）
- [ ] `leverage-brackets.json` **仍然是待办**——这是留给人工的手工核对工作，不在这份计划的自动化验收范围内
- [ ] `db:push`/`seed:symbols`/`seed:brackets`/`reconcile:ledger` 的端到端联调，等 Supabase 项目选定、`DATABASE_URL` 配好后再补一轮

完成以上（除了标注"留给人工"的两项），M0 就绪，可以进入 `HANDOFF.md` 里"数据库 → 后端 → 前端"顺序中的下一段：把真正的撮合/风控/清算公式（`04-backend-design.md` 第 4-9 节）填进 `packages/engine`。
