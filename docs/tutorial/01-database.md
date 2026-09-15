# 01 · 搭建教程：数据库层

> 这一讲你自己动手写代码，我负责讲清楚"为什么"和"写什么"，代码你自己敲、自己跑测试、自己 commit。
> 遇到红了别慌，先看报错信息，报错信息通常已经告诉你哪里不对；实在卡住再回来问我。

**这一讲结束时你会有什么**：`packages/shared`（定标数值库）+ `packages/db` 的 12 张表 + 杠杆分层表基础设施 + 4 个运维脚本。这是整个系统的地基——引擎和接口都要建在这上面。

**动手之前先读**（不用全背下来，遇到不确定的地方回来翻）：

- `docs/design/02-architecture.md` 第五节"数值精度"——这一讲一半的内容在解释这一节
- `docs/design/03-database-design.md`——12 张表的权威定义，本讲的表结构逐字段照抄这里
- 根 `CLAUDE.md`——五条硬约束，写代码前扫一眼

**环境检查**（先确认能跑起来）：

```bash
node -v    # 期望 v22.x
pnpm -v
pnpm install
```

---

## 第 1 讲：为什么不能用 `number`，以及 `packages/shared/fixed.ts`

### 概念：浮点数会说谎

JavaScript 的 `number` 是 IEEE 754 双精度浮点数。打开任意一个 JS 环境跑一下：

```js
0.1 + 0.2 === 0.30000000000000004  // true
```

在这个系统里，这个误差会变成什么样？用户开 20 倍杠杆，强平价算出来差 0.0001，他截图说"我明明没到强平价就爆了"——你没法解释，只能认账。**这是没法接受的**，所以整个系统不许 `number` 参与任何金额/价格/数量运算。

### 方案：`bigint` 整数定标

全程用 `bigint` 存"定标后的整数"，`SCALE = 10⁸`（1e8）。价格 `50000.25` 存成整数 `5000025000000`。为什么是 8 位：币安的价格、数量精度最深就是 8 位小数，够用且不浪费。

为什么不用现成的 `decimal.js` 之类的库：语言原生 `bigint`，无依赖、无对象分配开销——引擎一秒要跑上千次运算，这个差别是实的。代价是不能直接写 `a + b`，每一步都要过一遍定标函数，但这个代价在"算错就前功尽弃"的模块里是该付的：**它逼你每一步都想清楚自己在做什么运算**。

这一讲你要写的，就是这套定标运算的基础库：`packages/shared/src/fixed.ts`。之后 `packages/db`（表里的 bigint 列）、之后的 `packages/engine`（撮合公式）全都靠它。

### 动手：建包骨架

创建 `packages/shared/package.json`：

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

创建 `packages/shared/tsconfig.json`（跟其他包一样，继承共享配置）：

```json
{
  "extends": "@binance-contract-trading-full-stack/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  }
}
```

创建 `packages/shared/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

打开根目录 `pnpm-workspace.yaml`，在 `catalog:` 下加一行，让所有包共用同一个 Vitest 版本：

```yaml
  vitest: ^5.0.1
```

打开根 `package.json`，在 `scripts` 里加一行：

```json
    "test": "turbo run test",
```

打开根 `turbo.json`，在 `tasks` 里加一个 task：

```json
    "test": {
      "dependsOn": ["^test"]
    },
```

跑一次安装，把新包接进 workspace：

```bash
pnpm install
```

### 动手：核心四个函数——`parse` / `format` / `mul` / `div`

先想清楚要什么行为，再看代码：

- `parse("50000.25")` 要把十进制字符串变成定标整数。超过 8 位小数的部分**直接截断**，不四舍五入——这是有意的，截断行为必须可预测。
- `format(value)` 是反过来，定标整数变回字符串，补齐 8 位小数。
- `mul`/`div` 是乘除法：`mul(a, b) = a * b / SCALE`，`div(a, b) = a * SCALE / b`。记住这两个用的是 `bigint` 除法，会**截断**（不是四舍五入）。

创建 `packages/shared/src/fixed.ts`：

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

/** 乘法，截断。 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return (a * b) / SCALE;
}

/** 除法，截断。除数为零抛错。 */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("division by zero");
  return (a * SCALE) / b;
}
```

### 动手：写测试，自己验证

创建 `packages/shared/src/fixed.test.ts`。这几个用例不是随便挑的——`92233720368` 那条在试 Postgres `bigint` 的上限附近（922 亿，模拟账户够用），`0.000000001` 那条在试"超 8 位截断"：

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

自己跑一遍：

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

**检查点 1**：全绿。如果 `div(parse("2"), parse("3"))` 那条测试没通过，回头看看是不是把截断写成了四舍五入——这个区别下一讲会变得很重要。

跑通了自己 commit 一下：

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/vitest.config.ts \
  packages/shared/src/fixed.ts packages/shared/src/fixed.test.ts \
  pnpm-workspace.yaml turbo.json package.json
git commit -m "feat(shared): 定标数值核心 fixed.ts（parse/format/mul/div）"
```

---

## 第 2 讲：五种舍入规则

### 概念：同一个"舍入"，五种不同答案

`02-architecture.md` 第五节有张表，这是全系统统一舍入的唯一依据，**不许在业务代码里临时写舍入逻辑**：

| 场景 | 规则 | 理由 |
| --- | --- | --- |
| 价格对齐 tickSize | 买单向下、卖单向上 | 保守，不凭空给用户更好的价 |
| 数量对齐 stepSize | 向下 | 不能超出用户想下的量 |
| 手续费 | 向上到 8 位 | 和币安一致，摩擦成本不被低估 |
| 已实现盈亏 | 向下（截断） | 保守 |
| 未实现盈亏/保证金/强平价 | 四舍五入到 8 位 | 展示类数值，居中处理 |

后两行里"已实现盈亏向下"其实不用额外写函数——第 1 讲写的 `mul`/`div` 本身就是截断（`bigint` 除法的默认行为）。真正要新写的是另外四个：**价格对齐、数量对齐、手续费向上、展示类数值四舍五入**。

### 动手：写测试

在 `fixed.test.ts` 顶部把 import 换成加了新函数的版本，然后在文件末尾追加这几组测试：

```ts
import { alignPrice, alignQty, divRound, mulCeil } from "./fixed";

describe("mulCeil（手续费向上取整）", () => {
  it("有余数时向上进一", () => {
    // 乘积远小于最小单位，也要收够 1 个最小单位的手续费——摩擦成本不被低估
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

  it("2/3 → 0.66666667（第 9 位是 6，进），和 div 的截断结果不一样", () => {
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

跑一次确认是红的（函数还没写）：

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
```

### 动手：实现

在 `fixed.ts` 的 `div` 函数后面追加：

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

`divRound` 的写法值得多看一眼：先把符号拆出来单独处理（正负分开算，最后再拼回符号），再用"分子乘 2 加分母，除以分母乘 2"这个技巧做四舍五入——这是整数运算里做 round-half-up 的标准写法，不用浮点、不会有精度损失。

**检查点 2**：

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

```bash
git add packages/shared/src/fixed.ts packages/shared/src/fixed.test.ts
git commit -m "feat(shared): fixed.ts 补齐五种舍入（mulCeil/divRound/alignPrice/alignQty）"
```

---

## 第 3 讲：枚举和错误码——为什么放在 `shared` 而不是各自定义

### 概念：一处定义，处处引用

`03-database-design.md` 里数据库要用的枚举（订单状态、保证金模式……）和后面 `packages/engine` 要用的类型，本质上是同一套概念。如果 `db` 和 `engine` 各自定义一遍字符串字面量数组，两边迟早会漂移——改了一个忘了改另一个，等到某天订单状态对不上才发现。

架构图里 `server ──► db ──► shared` 和 `server ──► engine ──► shared` 都指向 `shared`，所以**枚举的唯一权威定义放在 `packages/shared`**，`db` 和 `engine` 都从这里导入。

错误码也是同理：`04-backend-design.md` 第 13 节列了 27 个错误码，明确写了"`packages/shared/src/errors.ts` 的枚举必须和这张表一一对应"。

### 动手：`enums.ts`

创建 `packages/shared/src/enums.ts`，11 个枚举，直接对应 `03-database-design.md` 第二节：

```ts
/**
 * 账户登录用的链。'evm' 对应 MetaMask 等 EVM 钱包，'solana' 对应 Phantom 等。
 * 和地址一起构成 accounts 表的唯一键——同一个人用两条链登录会得到两个独立账户（有意的）。
 */
export const CHAIN = ["evm", "solana"] as const;
export type Chain = (typeof CHAIN)[number];

/**
 * 持仓模式（账户级设置，第 6 讲的 accounts 表里能看到）。
 * - ONE_WAY 单向持仓：同一币对同一时间只能持多或持空一个方向，两个方向共用一个仓位槽。
 * - HEDGE   双向持仓：同一币对可以同时开多、开空两个独立仓位（对冲用）。
 */
export const POSITION_MODE = ["ONE_WAY", "HEDGE"] as const;
export type PositionMode = (typeof POSITION_MODE)[number];

/**
 * 仓位/订单归属的方向槽位，和 ORDER_SIDE（买/卖）是两个不同维度，别混。
 * - BOTH  单向模式下用——不区分多空，只有一个仓位槽。
 * - LONG  双向模式下的多头仓位。
 * - SHORT 双向模式下的空头仓位。
 */
export const POSITION_SIDE = ["BOTH", "LONG", "SHORT"] as const;
export type PositionSide = (typeof POSITION_SIDE)[number];

/**
 * 保证金模式（可以每个币对单独设置，见第 6 讲的 account_symbol_settings 表）。
 * - CROSS    全仓：这个币对的仓位用整个钱包余额做保证金，仓位之间互相"输血"。
 * - ISOLATED 逐仓：只用分配给这个仓位的保证金，独立算强平价，亏光了也不影响钱包其他部分。
 */
export const MARGIN_MODE = ["CROSS", "ISOLATED"] as const;
export type MarginMode = (typeof MARGIN_MODE)[number];

/**
 * 订单的买卖方向。注意这是"交易动作"，不等于"开多/开空"——
 * 开空仓也是先 SELL，只是 positionSide 传 SHORT；reduceOnly 平多仓同样要 SELL。
 */
export const ORDER_SIDE = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDE)[number];

/**
 * 订单类型。触发单（STOP 系列）平时不占盘口、不冻结保证金，
 * 标记价触及 stopPrice 才会"激活"——具体触发规则见 04-backend-design.md 第 7 节。
 * - LIMIT               限价单：按指定价格排队等成交。
 * - MARKET              市价单：立刻按当前盘口逐档吃单成交。
 * - STOP                止损限价单：触发后以 price 挂一张限价单。
 * - STOP_MARKET         止损市价单：触发后立即按市价成交。
 * - TAKE_PROFIT         止盈限价单：触发后以 price 挂一张限价单。
 * - TAKE_PROFIT_MARKET  止盈市价单：触发后立即按市价成交。
 */
export const ORDER_TYPE = [
  "LIMIT",
  "MARKET",
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
] as const;
export type OrderType = (typeof ORDER_TYPE)[number];

/**
 * 订单有效方式（Time In Force），只对限价单有意义。
 * - GTC 一直有效，直到成交或被撤单（默认）。
 * - IOC 立即成交能成的部分，没成交的部分立刻取消，不留在盘口上。
 * - FOK 必须一次性全部成交，否则整单立刻取消，不接受部分成交。
 * - GTX 只做 Maker（Post Only）：如果这单下去会立即和对手盘成交，直接拒单，不允许吃单。
 */
export const TIME_IN_FORCE = ["GTC", "IOC", "FOK", "GTX"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

/**
 * 订单状态机的六个状态，状态流转图见 04-backend-design.md 第 3 节。
 * NEW/PARTIALLY_FILLED 是"活跃"状态（对应第 7 讲 orders 表那个部分索引）；
 * 其余四个都是终态，进去了就不会再变。
 * - NEW               已挂单，尚未成交。
 * - PARTIALLY_FILLED  部分成交，剩余部分还在排队。
 * - FILLED            完全成交（终态）。
 * - CANCELED          用户主动撤单（终态）。
 * - EXPIRED           IOC 未成交部分 / FOK 未全部成交 / GTX 会吃单 / 触发时保证金不足等原因失效（终态）。
 * - REJECTED          下单校验链（04-backend-design.md 第 6 节）没通过，直接拒绝，不会进入挂单簿（终态）。
 */
export const ORDER_STATUS = [
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "REJECTED",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/**
 * 成交时这笔单扮演的角色，决定手续费费率（Maker 更低，鼓励挂单提供流动性）。
 * - MAKER 挂单方：这笔成交是靠"别人的单吃到了我挂在盘口上的单"促成的。
 * - TAKER 吃单方：这笔成交是靠"我主动吃掉了盘口上已有的挂单"促成的。
 */
export const FILL_ROLE = ["MAKER", "TAKER"] as const;
export type FillRole = (typeof FILL_ROLE)[number];

/**
 * 触发单用哪种价格判断"到没到触发点"。
 * - MARK_PRICE     标记价（默认，和币安一致）：能防止有人用小单插针把别人的止损打出来。
 * - CONTRACT_PRICE 合约最新成交价：更贴近"眼见为实"，但更容易被插针。
 */
export const WORKING_TYPE = ["MARK_PRICE", "CONTRACT_PRICE"] as const;
export type WorkingType = (typeof WORKING_TYPE)[number];

/**
 * 资金流水的类型——ledger_entries 表（第 8 讲）里每一行都必须归到这 8 类之一，
 * 这是"钱从哪来、到哪去"的唯一分类依据，账目对不上时靠这个字段定位是哪类操作出的问题。
 * - INITIAL          开户时发放的初始模拟资金。
 * - RESET            账户重置（走正常平仓流程后把余额设回初始值，见 CLAUDE.md 已知失真点 #10）。
 * - REALIZED_PNL     平仓（部分或全部）产生的已实现盈亏。
 * - FEE              交易手续费（Maker/Taker）。
 * - FUNDING          资金费结算（每 8 小时，多空双方互相支付）。
 * - LIQUIDATION      强平时该仓位的盈亏结算。
 * - LIQUIDATION_FEE  强平清算费。
 * - MARGIN_TRANSFER  逐仓模式下手动划入/划出保证金。
 */
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

### 动手：`errors.ts`

先写测试（`packages/shared/src/errors.test.ts`），这个测试本身就是"文档同步检查"——如果哪天错误码表改了但代码没跟上，这条测试会红：

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

创建 `packages/shared/src/errors.ts`。27 个码抄自 `04-backend-design.md` 第 13 节，HTTP 状态码也是那张表里给的：

```ts
export const ERROR_CODES = [
  // 认证
  "UNAUTHORIZED", // 缺 token 或 token 无效
  "TOKEN_EXPIRED", // token 过期，需要重新签名登录
  "NONCE_INVALID", // 登录用的 nonce 不存在、已过期或已用过一次
  "SIGNATURE_INVALID", // 钱包签名验证失败

  // 下单校验链（严格按顺序执行，见 04-backend-design.md 第 6 节，前一步没过不会走到后一步）
  "SYMBOL_NOT_TRADING", // 第 1 步：币对不存在，或未开放交易
  "MARKET_NOT_READY", // 第 2 步：行情还没就绪（没有盘口/标记价），暂不接受下单
  "INVALID_PARAMS", // 第 3 步：订单类型/TIF/价格/触发价的参数组合不合法
  "POSITION_SIDE_MISMATCH", // 第 4 步：positionSide 和当前持仓模式（单向/双向）对不上
  "PRICE_FILTER", // 第 5 步：委托价不是 tickSize 的整数倍
  "LOT_SIZE", // 第 5 步：委托数量不是 stepSize 的整数倍
  "MIN_NOTIONAL", // 第 6 步：数量或名义价值低于该币对的最小下单门槛
  "PERCENT_PRICE", // 第 7 步：委托价偏离标记价超过 ±5%（防止用天价/地板价试探系统）
  "REDUCE_ONLY_REJECTED", // 第 8 步：只减仓单没有对应仓位，或数量超过了仓位剩余
  "LEVERAGE_TOO_HIGH", // 第 9 步：成交后名义价值所在的杠杆分层，不允许当前设置的杠杆倍数
  "INSUFFICIENT_MARGIN", // 第 10 步：可用余额不够支付起始保证金 + 预留的吃单手续费
  "MARKET_ORDER_TOO_LARGE", // 第 11 步：市价单数量超过了对手盘可见深度的一半
  "POST_ONLY_REJECTED", // 第 12 步：GTX（只做 Maker）单如果下去会立刻吃单成交，直接拒
  "TOO_MANY_ORDERS", // 第 13 步：该账户当前挂单数已经到了 200 张的上限

  // 仓位与账户
  "ORDER_NOT_FOUND", // 撤单时订单不存在，或已经是终态
  "POSITION_NOT_FOUND", // 平仓/加减保证金时找不到对应仓位
  "MARGIN_MODE_LOCKED", // 该币对还有持仓或挂单，不能切换全仓/逐仓
  "POSITION_MODE_LOCKED", // 账户还有任何持仓或挂单，不能切换单向/双向持仓模式
  "RESET_COOLING_DOWN", // 账户重置有冷却时间，冷却期内不能再次重置
  "MARGIN_WOULD_LIQUIDATE", // 逐仓减保证金后会让保证金率立刻 ≥ 100%（相当于自己把自己强平），不允许

  // 系统
  "RATE_LIMITED", // 触发限流
  "INTERNAL_ERROR", // 服务端内部错误，兜底用
  "SERVICE_UNAVAILABLE", // 引擎还没就绪（启动中，或行情断连导致暂停撮合）
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

最后建 `packages/shared` 的出口文件 `packages/shared/src/index.ts`：

```ts
export * from "./enums";
export * from "./errors";
export * from "./fixed";
```

**检查点 3**：

```bash
pnpm --filter @binance-contract-trading-full-stack/shared run test
pnpm --filter @binance-contract-trading-full-stack/shared run check-types
```

```bash
git add packages/shared/src/enums.ts packages/shared/src/errors.ts packages/shared/src/errors.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): 枚举与错误码（对齐 03/04 设计文档），补 shared 出口"
```

`packages/shared` 到这里就完工了。接下来开始建数据库表，这些表里的 `bigint` 列、`pgEnum` 都会用到刚写完的东西。

---

## 第 4 讲：12 张表——先看全局，再动手

### 概念：四组表，各管各的

打开 `docs/design/03-database-design.md` 通读一遍第一节"表清单"和实体关系图。简单复述一下：

```
市场规格   symbols, leverage_brackets          ← 币安同步 / 人工维护，低频写
账户       accounts, auth_nonces, account_symbol_settings
交易       positions, orders, fills            ← 高频写
账目       ledger_entries, funding_payments, liquidations, equity_snapshots
```

`ledger_entries` 是**整个系统账目的唯一真相**：任何资金变动必须在这张表留一条流水，`balanceAfter` 必填，要守住 `accounts.wallet_balance === SUM(ledger_entries.amount)` 这条不变式（第 8 讲会写自动对账脚本验证这条）。

`positions` 和 `orders` 各有一个**部分索引**（只索引"活跃"的行），这是故意的：这两张表大部分行是历史死数据，全表索引会随时间线性膨胀，部分索引的大小只跟"当前活跃数量"成正比。建表时如果漏了 `.where(...)` 这部分，索引会退化成普通索引，后面数据量大了查询会变慢——这是本讲比较容易漏掉的一个细节，建好之后记得对一下。

### 动手：`db` 里的枚举——接入 `shared`

先在 `packages/db/package.json` 的 `"dependencies"` 里加一行：

```json
    "@binance-contract-trading-full-stack/shared": "workspace:*",
```

跑 `pnpm install` 让依赖生效。

创建 `packages/db/src/schema/enums.ts`——注意这里**不是**重新拍脑袋写字符串数组，而是从 `shared` 导入第 3 讲写的那 11 个元组：

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

打开 `packages/db/src/schema/index.ts`，在已有的 `export * from "./books";` 后面加一行：

```ts
export * from "./enums";
```

跑一下类型检查（这一步没有业务逻辑好测，靠 `check-types` 当验证手段）：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/src/schema/enums.ts packages/db/src/schema/index.ts
git commit -m "feat(db): 11 个 pgEnum，接入 packages/shared 的枚举元组"
```

---

## 第 5 讲：市场规格组——`symbols` + `leverage_brackets`

创建 `packages/db/src/schema/symbols.ts`。`enabled`/`sortOrder` 是我们自己加的字段，不是币安数据的一部分——同步脚本会把币安全部币对写进来，但只有 `enabled = true` 的才对外开放，**加币对只改一行数据，不用发版**：

```ts
import { bigint, boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(), // 'BTCUSDT' 这种币安原生的交易对代码，直接当主键
  baseAsset: text("base_asset").notNull(), // 'BTC'——标的资产
  quoteAsset: text("quote_asset").notNull(), // 'USDT'——计价资产，本项目目前只对接 U 本位
  status: text("status").notNull(), // 币安那边的状态，如 'TRADING'/'SETTLING'，原样存
  pricePrecision: integer("price_precision").notNull(), // 价格小数位数，前端展示用
  quantityPrecision: integer("quantity_precision").notNull(), // 数量小数位数，前端展示用
  tickSize: bigint("tick_size", { mode: "bigint" }).notNull(), // 价格最小变动单位，下单校验链第 5 步要用
  stepSize: bigint("step_size", { mode: "bigint" }).notNull(), // 数量最小变动单位，同上
  minQty: bigint("min_qty", { mode: "bigint" }).notNull(), // 最小下单数量
  minNotional: bigint("min_notional", { mode: "bigint" }).notNull(), // 最小下单名义价值（价格 × 数量）
  enabled: boolean("enabled").notNull().default(false), // 我们自己的字段：是否对用户开放，不是币安数据的一部分
  sortOrder: integer("sort_order").notNull().default(0), // 我们自己的字段：币对列表的展示顺序
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
```

创建 `packages/db/src/schema/leverage-brackets.ts`。注意 `mmr`（维持保证金率）也走定标 1e8——`0.4%` 存成 `400000n`，**不要用 float 存比例**，精度问题会从这里溜进强平价计算：

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

在 `schema/index.ts` 追加两行：

```ts
export * from "./leverage-brackets";
export * from "./symbols";
```

**检查点 5**：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

```bash
git add packages/db/src/schema/symbols.ts packages/db/src/schema/leverage-brackets.ts packages/db/src/schema/index.ts
git commit -m "feat(db): symbols + leverage_brackets 表（市场规格组）"
```

---

## 第 6 讲：账户组——`accounts` + `auth_nonces` + `account_symbol_settings`

创建 `packages/db/src/schema/accounts.ts`。`(chain, address)` 联合唯一是故意的：同一个人用 MetaMask 和 Phantom 登录会得到两个独立账户：

```ts
import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chainEnum, positionModeEnum } from "./enums";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // EVM 统一小写；Solana 保持 base58 原样。
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    // 已结算的钱包余额，是 accounts.wallet_balance === SUM(ledger_entries.amount) 这条
    // 不变式里的左边——任何资金变动都必须同步改这个字段并写一条 ledger_entries。
    walletBalance: bigint("wallet_balance", { mode: "bigint" }).notNull().default(0n),
    positionMode: positionModeEnum("position_mode").notNull().default("ONE_WAY"),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }), // 上次账户重置的时间，null 表示没重置过
    // 排行榜显示名，默认脱敏地址。
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(), // 最近一次活跃时间
  },
  (t) => [uniqueIndex("accounts_chain_address_uq").on(t.chain, t.address)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
```

创建 `packages/db/src/schema/auth-nonces.ts`。`message` 字段存**完整待签名原文**是安全要点：验签必须用服务端存的这份原文，不能用客户端回传的文本，否则攻击者能让你去验一段他自己构造的内容：

```ts
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chainEnum } from "./enums";

export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull(),
    nonce: text("nonce").notNull(), // 随机挑战值，拼进 message 里让用户签名，防重放攻击
    message: text("message").notNull(), // 完整待签名原文，验签必须用这份服务端存的原文
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 有效期 5 分钟
    usedAt: timestamp("used_at", { withTimezone: true }), // 非空说明已经验签成功用过一次，防止重放
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

创建 `packages/db/src/schema/account-symbol-settings.ts`。没有记录时用默认值（20x、全仓）——**不需要开户时预创建 20 条**，用户碰哪个币对才会有哪条记录：

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
    leverage: integer("leverage").notNull().default(20), // 这个账户在这个币对上的杠杆倍数
    marginMode: marginModeEnum("margin_mode").notNull().default("CROSS"), // 全仓/逐仓，默认全仓
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // 联合主键 (accountId, symbol)：每个账户每个币对最多一条设置，天然去重
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

**检查点 6**：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

```bash
git add packages/db/src/schema/accounts.ts packages/db/src/schema/auth-nonces.ts \
  packages/db/src/schema/account-symbol-settings.ts packages/db/src/schema/index.ts
git commit -m "feat(db): accounts + auth_nonces + account_symbol_settings 表（账户组）"
```

---

## 第 7 讲：交易组——`positions` + `orders` + `fills`

这三张是高频写入表，也是第 4 讲提到的"部分索引"要落地的地方。

创建 `packages/db/src/schema/positions.ts`。两个设计点：**平仓后行不删除**（`qty = 0` 保留，删了之后切换持仓模式、查历史都要处理"不存在"分支，留着更简单）；**`qty` 恒为非负**，方向完全由 `positionSide` 决定：

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
    leverage: integer("leverage").notNull(), // 开仓时锁定的杠杆倍数，后续调杠杆不影响已开的仓位
    qty: bigint("qty", { mode: "bigint" }).notNull().default(0n), // 恒为非负，方向看 positionSide
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull().default(0n), // 加权平均开仓价
    isolatedMargin: bigint("isolated_margin", { mode: "bigint" }).notNull().default(0n), // 仅逐仓模式下有意义
    openedAt: timestamp("opened_at", { withTimezone: true }), // 首次开仓时间，qty 归零后不清空，留作历史记录
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 一个账户在一个币对的同一个方向上只能有一条仓位记录（不管单向/双向模式）
    uniqueIndex("pos_acc_sym_side_uq").on(t.accountId, t.symbol, t.positionSide),
    // 部分索引：只索引活跃仓位（qty > 0）。资金费结算、强平扫描按币对高频捞取活跃仓位，靠它。
    index("pos_symbol_open_idx").on(t.symbol).where(sql`qty > 0`),
  ],
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
```

创建 `packages/db/src/schema/orders.ts`。`orders_acc_client_uq` 保证下单接口**幂等**：前端重试同一个 `clientOrderId` 不会重复下单：

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
    clientOrderId: text("client_order_id").notNull(), // 前端生成的幂等键，重试同一个值不会重复下单
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol),
    side: orderSideEnum("side").notNull(), // BUY/SELL，交易动作方向
    positionSide: positionSideEnum("position_side").notNull(), // 这笔单影响哪个仓位槽（BOTH/LONG/SHORT）
    type: orderTypeEnum("type").notNull(),
    timeInForce: timeInForceEnum("time_in_force").notNull().default("GTC"), // 只对限价单有意义
    price: bigint("price", { mode: "bigint" }), // 委托价，市价单为 null
    stopPrice: bigint("stop_price", { mode: "bigint" }), // 触发单的触发价，非触发单为 null
    workingType: workingTypeEnum("working_type").notNull().default("MARK_PRICE"), // 触发单用什么价格判断触发
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 委托数量
    executedQty: bigint("executed_qty", { mode: "bigint" }).notNull().default(0n), // 已成交数量
    avgPrice: bigint("avg_price", { mode: "bigint" }).notNull().default(0n), // 已成交部分的加权平均价
    reduceOnly: boolean("reduce_only").notNull().default(false), // 只减仓：不能开新仓，只能减少现有仓位
    closePosition: boolean("close_position").notNull().default(false), // 一键平仓：不指定数量，直接清空整个仓位
    status: orderStatusEnum("status").notNull().default("NEW"),
    triggered: boolean("triggered").notNull().default(false), // 触发单是否已经被标记价/最新价触发过
    queueAhead: bigint("queue_ahead", { mode: "bigint" }).notNull().default(0n), // 拟真排队：前方还剩多少量没成交
    queueEstimated: boolean("queue_estimated").notNull().default(false), // 排队位置是不是估算出来的（重启后会是）
    frozenMargin: bigint("frozen_margin", { mode: "bigint" }).notNull().default(0n), // 这张挂单占用/冻结的保证金
    rejectReason: text("reject_reason"), // 状态是 REJECTED/EXPIRED 时，记录具体是哪条错误码/原因
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 下单幂等：同一账户同一个 clientOrderId 只会真正下单一次
    uniqueIndex("orders_acc_client_uq").on(t.accountId, t.clientOrderId),
    // 部分索引：只索引"活跃"挂单（NEW/PARTIALLY_FILLED）。引擎恢复、撮合时按币对高频捞取，靠它。
    index("orders_open_idx")
      .on(t.symbol, t.status)
      .where(sql`status IN ('NEW','PARTIALLY_FILLED')`),
    // 查一个账户的历史挂单列表（按时间倒序分页）
    index("orders_acc_created_idx").on(t.accountId, t.createdAt.desc()),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
```

创建 `packages/db/src/schema/fills.ts`——**只追加，永不更新**：

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
    price: bigint("price", { mode: "bigint" }).notNull(), // 这一笔的实际成交价（不是订单的委托价）
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 这一笔的成交数量（订单可能分好几笔成交）
    role: fillRoleEnum("role").notNull(), // MAKER/TAKER，决定手续费费率
    fee: bigint("fee", { mode: "bigint" }).notNull(), // 这一笔的手续费，向上取整（mulCeil）
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull().default(0n), // 这一笔带来的已实现盈亏，开仓/加仓为 0
    isLiquidation: boolean("is_liquidation").notNull().default(false), // 这一笔是不是强平引起的
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

**检查点 7**：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

```bash
git add packages/db/src/schema/positions.ts packages/db/src/schema/orders.ts \
  packages/db/src/schema/fills.ts packages/db/src/schema/index.ts
git commit -m "feat(db): positions + orders + fills 表（交易组）"
```

---

## 第 8 讲：账目组——`ledger_entries` 等 4 张表 + 第一次生成迁移

### 概念：`ledger_entries` 是唯一真相

这张表决定了整个系统"钱有没有算对"能不能被自动发现。`02-architecture.md` 反复强调的不变式就是它：

```sql
SELECT a.id, a.wallet_balance, l.s AS ledger_sum
FROM accounts a
JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l
  ON l.account_id = a.id
WHERE a.wallet_balance <> l.s;
```

这条查询任何时候都该返回 0 行。第 10 讲会把它包成一个脚本，跑起来后你可以定时执行它。

### 动手：四张表

创建 `packages/db/src/schema/ledger-entries.ts`：

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
    type: ledgerTypeEnum("type").notNull(), // 这笔钱属于 LEDGER_TYPE 8 类中的哪一类
    symbol: text("symbol"), // 和某个币对相关的流水（如手续费/资金费）才填，INITIAL/RESET 这类为 null
    amount: bigint("amount", { mode: "bigint" }).notNull(), // 有符号：收入为正，支出为负
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(), // 这笔发生后的余额快照，查流水页不用累加
    refType: text("ref_type"), // 关联的业务对象类型，如 'fill'/'funding'/'liquidation'
    refId: uuid("ref_id"), // 关联的业务对象 id，配合 refType 能查到这笔钱具体是哪次成交/结算引起的
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_acc_created_idx").on(t.accountId, t.createdAt.desc()), // 流水分页查询
    index("ledger_acc_type_idx").on(t.accountId, t.type), // 按类型筛选流水（比如只看手续费）
  ],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
```

创建 `packages/db/src/schema/funding-payments.ts`。`funding_uq` 是防重复结算的保险：定时器因重启重复触发时，唯一约束挡住第二次写入：

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
    fundingRate: bigint("funding_rate", { mode: "bigint" }).notNull(), // 结算时使用的资金费率
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(), // 结算时使用的标记价
    notional: bigint("notional", { mode: "bigint" }).notNull(), // 结算时仓位的名义价值（= markPrice × qty）
    amount: bigint("amount", { mode: "bigint" }).notNull(), // 有符号：多头付给空头（或反之）时，付出方为负
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(), // 结算时间，每 8 小时一次
  },
  (t) => [
    index("funding_acc_settled_idx").on(t.accountId, t.settledAt.desc()),
    // 防重复结算：定时器因重启而重复触发时，唯一约束挡住第二次写入
    uniqueIndex("funding_uq").on(t.accountId, t.symbol, t.positionSide, t.settledAt),
  ],
);

export type FundingPayment = typeof fundingPayments.$inferSelect;
export type NewFundingPayment = typeof fundingPayments.$inferInsert;
```

创建 `packages/db/src/schema/liquidations.ts`。`marginBalanceBefore`/`maintMarginAt` 是取证字段——用户质疑"我不该被强平"时，把这两个数摆出来就能说清楚，别省：

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
    marginMode: marginModeEnum("margin_mode").notNull(), // 被强平时这个仓位是全仓还是逐仓
    qty: bigint("qty", { mode: "bigint" }).notNull(), // 被强平的数量
    entryPrice: bigint("entry_price", { mode: "bigint" }).notNull(), // 被强平仓位的开仓均价
    markPrice: bigint("mark_price", { mode: "bigint" }).notNull(), // 触发强平那一刻的标记价，强平按这个价格平仓
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(), // 强平这笔带来的已实现盈亏（通常是负的）
    liquidationFee: bigint("liquidation_fee", { mode: "bigint" }).notNull(), // 强平清算费，比普通手续费高
    // 下面两个是取证字段：用户质疑"我不该被强平"时，把这两个数摆出来就能说清楚，别省。
    marginBalanceBefore: bigint("margin_balance_before", { mode: "bigint" }).notNull(), // 强平前一刻的保证金余额
    maintMarginAt: bigint("maint_margin_at", { mode: "bigint" }).notNull(), // 强平前一刻算出的维持保证金要求
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("liq_acc_created_idx").on(t.accountId, t.createdAt.desc())],
);

export type Liquidation = typeof liquidations.$inferSelect;
export type NewLiquidation = typeof liquidations.$inferInsert;
```

创建 `packages/db/src/schema/equity-snapshots.ts`。排行榜就是 `WHERE snap_date = today ORDER BY roi DESC LIMIT 100`，走 `equity_date_roi_idx` 一个索引搞定：

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
    snapDate: date("snap_date").notNull(), // UTC 日期，每天一条
    equity: bigint("equity", { mode: "bigint" }).notNull(), // 权益 = 钱包余额 + 所有仓位未实现盈亏
    walletBalance: bigint("wallet_balance", { mode: "bigint" }).notNull(), // 当天快照时刻的钱包余额
    cumulativePnl: bigint("cumulative_pnl", { mode: "bigint" }).notNull(), // 自上次账户重置以来的累计盈亏
    roi: bigint("roi", { mode: "bigint" }).notNull(), // 收益率，定标 1e8，排行榜按这个字段排序
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("equity_acc_date_uq").on(t.accountId, t.snapDate), // 每个账户每天最多一条快照
    index("equity_date_roi_idx").on(t.snapDate, t.roi.desc()), // 排行榜：WHERE snap_date=today ORDER BY roi DESC
  ],
);

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type NewEquitySnapshot = typeof equitySnapshots.$inferInsert;
```

在 `schema/index.ts` 追加最后四行：

```ts
export * from "./equity-snapshots";
export * from "./funding-payments";
export * from "./ledger-entries";
export * from "./liquidations";
```

### 动手：第一次生成迁移

到这里 12 张业务表全部到位了。跑一次类型检查，再生成迁移文件：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
pnpm run db:generate
```

`drizzle-kit generate` 只读本地 schema 文件，**不需要真实的 Supabase 连接**就能跑（`db:push`/`db:migrate` 才需要 `DATABASE_URL`，这个留到 Supabase 项目选好之后）。跑完打开 `packages/db/src/migrations/` 下新生成的 `.sql` 文件，确认里面有 `CREATE TABLE` 语句，数一下应该有 13 张表（12 张业务表 + 已有的 `books`）。

**检查点 8**（这一步是数据库层的一个大里程碑）：

```bash
git add packages/db/src/schema/ledger-entries.ts packages/db/src/schema/funding-payments.ts \
  packages/db/src/schema/liquidations.ts packages/db/src/schema/equity-snapshots.ts \
  packages/db/src/schema/index.ts packages/db/src/migrations/
git commit -m "feat(db): ledger_entries + funding_payments + liquidations + equity_snapshots 表（账目组），首次生成迁移"
```

---

## 第 9 讲：杠杆分层表——为什么不能让 AI 帮你生成

### 概念：这是唯一一处我拒绝帮你写数据的地方

`03-database-design.md` 第九节写得很直白：

> ⚠️ 分层表的数字必须从币安页面人工核对，**不要让 AI 凭记忆生成**。生成错了会导致所有强平价系统性偏差，而且很难被发现——校验脚本只能查出内部不连续，查不出整体抄错一档。

意思是：如果我凭训练数据里记得的币安分层表"背"出一份 JSON 给你，这份数据可能全体系统性地偏了一档，而所有后续的校验（相邻层边界连续性）都测不出这种整体偏移——只有你拿真实页面逐层核对，才能发现。这是"宁可说做不到，不要编数字"这条原则在数据层面最直接的体现。

所以这一讲我只带你搭基础设施：数据格式（zod schema）、连续性校验逻辑、空模板。真正的 20 个币对的数字，要你自己去币安页面核对着填。

### 动手：schema + 校验脚本

创建 `packages/db/src/seed/leverage-brackets.schema.ts`：

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

创建 `packages/db/src/scripts/verify-brackets.ts`。核心是 `checkContinuity`：对每对相邻层，在低层的边界名义价值 `N` 上，两层算出的维持保证金必须相等：

```ts
import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mul, parse } from "@binance-contract-trading-full-stack/shared";
import { LeverageBracketFileSchema, type BracketRow } from "../seed/leverage-brackets.schema";

const DATA_PATH = fileURLToPath(new URL("../seed/leverage-brackets.json", import.meta.url));

export interface ContinuityResult {
  ok: boolean;
  mismatches: { atBracket: number }[];
}

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

创建一个空模板 `packages/db/src/seed/leverage-brackets.json`：

```json
{}
```

创建 `packages/db/src/seed/README.md`，把填表步骤写清楚，这样等你真去核对的时候有据可依：

```markdown
# leverage-brackets.json 填写说明

**这个文件的数字必须从币安 App / 官网的"杠杆分层标准"页面人工核对，不允许由 AI 凭训练数据生成。**

## 格式

\`\`\`json
{
  "BTCUSDT": [
    { "bracket": 1, "notionalFloor": "0", "notionalCap": "50000", "maxLeverage": 125, "mmr": "0.004", "cum": "0" },
    { "bracket": 2, "notionalFloor": "50000", "notionalCap": "250000", "maxLeverage": 100, "mmr": "0.005", "cum": "50" }
  ]
}
\`\`\`

- 所有数值字段用十进制**字符串**（导入脚本会用 packages/shared 的 parse() 转成定标 1e8 的 bigint）。
- mmr 是维持保证金率的小数形式：币安页面写"0.4%"就填 "0.004"。
- cum 是速算额，币安页面直接给。
- 每个币对的层按 bracket 从 1 开始升序排列，跟币安页面顺序一致。

## 核对步骤（每个币对）

1. 打开币安 App/官网的杠杆分层表页面，找到对应合约。
2. 逐层抄 Notional Cap、Max Leverage、Maintenance Margin Rate、Maintenance Amount（= cum）。
3. 填完一个币对，跑一次 `pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets`，确认这个币对显示 ✓。
4. 全部 20 个开放币对填完、全部 ✓ 之后，才能跑 seed:brackets 导入数据库。
```

在 `packages/db/package.json` 的 `"scripts"` 加一行：

```json
    "verify:brackets": "tsx src/scripts/verify-brackets.ts",
```

如果这是 `packages/db` 第一次用 `tsx`，先加依赖：

```json
    "tsx": "^4.23.13",
```

再装一次：

```bash
pnpm install
```

跑一下（空文件应该提示"目前是空的"，退出码 0，不算失败）：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets
```

**检查点 9**：

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/src/seed/leverage-brackets.schema.ts \
  packages/db/src/seed/leverage-brackets.json packages/db/src/seed/README.md \
  packages/db/src/scripts/verify-brackets.ts
git commit -m "feat(db): 杠杆分层表模板 + verify:brackets 连续性校验（数值留空待人工核对）"
```

**接下来是你自己的功课**：照着 `packages/db/src/seed/README.md`，去币安页面把 20 个开放币对的分层表核对填进 `leverage-brackets.json`。这一步不着急，可以留到后面再补，不影响继续往下学。

---

## 第 10 讲：种子脚本——`seed:symbols` / `seed:brackets` / `reconcile:ledger`

### 动手：`seed:symbols`——从币安拉规格

先写一个纯函数，把币安 `exchangeInfo` 接口返回的一条 symbol 记录映射成待写入 `symbols` 表的行——这样不用真的发网络请求就能测。创建 `packages/db/src/scripts/seed-symbols.ts`：

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

给这个纯函数写个测试，`packages/db/src/scripts/seed-symbols.test.ts`（这是 `packages/db` 第一次接入 Vitest，需要先补 `vitest.config.ts` 和 `package.json` 的 `test` script，照第 1 讲 `packages/shared` 的样子抄一份）：

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

    expect(mapped.tickSize).toBe(10000000n); // 0.10 * 1e8
    expect(mapped.stepSize).toBe(100000n); // 0.001 * 1e8
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

在 `package.json` 加脚本入口：

```json
    "seed:symbols": "tsx src/scripts/seed-symbols.ts",
```

跑一下（`main()` 本身先不执行——`DATABASE_URL` 还没配，Supabase 项目还没选定，见 `HANDOFF.md` 第七节；等库配好之后手动跑一次真实联调）：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run test
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

### 动手：`seed:brackets`——导入你人工核对好的分层表

创建 `packages/db/src/scripts/seed-brackets.ts`。导入前复用第 9 讲写的 `checkContinuity`：任何币对连续性校验不过，整个导入中止，不写半张表：

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

### 动手：`reconcile:ledger`——把第 8 讲那条 SQL 包成脚本

创建 `packages/db/src/scripts/reconcile-ledger.ts`：

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

在 `package.json` 补上最后两条脚本入口：

```json
    "seed:brackets": "tsx src/scripts/seed-brackets.ts",
    "reconcile:ledger": "tsx src/scripts/reconcile-ledger.ts",
```

**检查点 10**：

```bash
pnpm --filter @binance-contract-trading-full-stack/db run check-types
```

这两个脚本要跑通完整流程都需要真实 `DATABASE_URL`，留给 Supabase 项目选好之后再联调一次（`seed:brackets` 还依赖你第 9 讲填好的分层数据）。

```bash
git add packages/db/package.json pnpm-lock.yaml packages/db/vitest.config.ts \
  packages/db/src/scripts/seed-symbols.ts packages/db/src/scripts/seed-symbols.test.ts \
  packages/db/src/scripts/seed-brackets.ts packages/db/src/scripts/reconcile-ledger.ts
git commit -m "feat(db): seed:symbols + seed:brackets + reconcile:ledger 脚本"
```

---

## 数据库层验收清单

- [ ] `pnpm run check-types` 全绿
- [ ] `pnpm --filter @binance-contract-trading-full-stack/shared run test` 全绿（fixed.ts、errors.ts）
- [ ] `pnpm --filter @binance-contract-trading-full-stack/db run test` 全绿（seed-symbols 的纯函数测试）
- [ ] `pnpm run db:generate` 产出的迁移 SQL 里能看到 12 张业务表 + `books`
- [ ] `packages/db/src/seed/leverage-brackets.json` 目前应该还是空的或者正在填——这是你自己的功课，不着急
- [ ] `DATABASE_URL` 配好（Supabase 项目选定）之后，找时间手动跑一遍 `seed:symbols` → `verify:brackets` → `seed:brackets` → `reconcile:ledger`，做一次端到端联调

数据库层到这里就搭完了。下一讲 `02-backend.md`（还没写）会带你进 `packages/engine`——先是骨架（`EngineInput`/`EngineEvent`/`Engine` 接口），再往里填真正的撮合、风控、清算公式（`04-backend-design.md` 第 4-9 节）。
