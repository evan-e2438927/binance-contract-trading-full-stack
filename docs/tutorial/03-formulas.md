# 03 · 搭建教程：计算公式

> 这一讲只算数，不碰订单、不碰撮合、不碰引擎状态。
> `04-backend-design.md` 第 4 节的每一条公式，在这一讲变成一个能单独测试的纯函数。第 05～09 讲会拿着这些函数去处理真实的下单和成交——这一讲的任务是保证公式本身**先算对**。

**这一讲结束时你会有什么**：

- `packages/engine/src/formulas.ts`——名义价值、起始保证金、未实现盈亏、保证金余额、可用余额、挂单冻结保证金、资金费、手续费
- `packages/engine/src/position.ts`——加仓均价、减仓已实现盈亏、逐仓保证金按比例释放、反手拆分
- `packages/engine/src/liquidation.ts`——杠杆分层查找、维持保证金、保证金率、强平价
- `packages/shared` 里补了一个 `mulRound`，修了一个 `format()` 的显示 bug（第 8 节细说）
- 第 02 讲留空的不变式 ③（可用余额非负）⑥（只减仓/全部平仓单不冻结保证金）接进了测试脚手架
- 76 条新测试，全部带着 `01-domain-knowledge.md` 的算例和反向验算

**先读**：`docs/design/04-backend-design.md` 第 4 节、`docs/design/01-domain-knowledge.md` 第二、四、五、六、八、九节（每条公式的算例都在这里）、`docs/design/02-architecture.md` 第五节（舍入规则）。

> **代码已经在仓库里了**：这一讲开始改成 AI 写代码、写讲义，你对照着读（见 `HANDOFF.md`）。讲义里的代码块和仓库文件逐字一致。

---

## 第 1 节：舍入规则先落地——4 个函数管住全部公式

`02-architecture.md` 第五节那张表，翻译成 `packages/shared/src/fixed.ts` 里已有的（第 01 讲）和这一讲新加的函数：

| 场景 | 函数 | 状态 |
| --- | --- | --- |
| 默认（乘法截断 / 除法截断） | `mul` / `div` | 第 01 讲已有 |
| 手续费：向上取整 | `mulCeil` | 第 01 讲已有 |
| 未实现盈亏 / 保证金 / 强平价：四舍五入 | `divRound`（除法）、**`mulRound`（乘法，这一讲新加）** | |
| 已实现盈亏：向下截断 | 就是 `mul`，不需要新函数 | |

`mulRound` 是这一讲唯一往 `packages/shared` 加的函数：

```ts
/** 乘法，四舍五入（round half up），用于未实现盈亏/保证金等展示类数值。 */
export function mulRound(a: Fixed, b: Fixed): Fixed {
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const rounded = (absA * absB * 2n + SCALE) / (SCALE * 2n);
  return negative ? -rounded : rounded;
}
```

写法和已有的 `divRound` 是同一个套路（`(2×被除数 + 除数) ÷ (2×除数)` 是整数除法里"四舍五入"的标准写法，`divRound` 已经在用）——`mulRound` 只是把它套到"乘法之后要除以 `SCALE` 变回定标值"这一步上。

**为什么公式里没有点名的中间步骤一律用 `mul`/`div`（截断）**：04-backend-design.md 开头就说"下文伪代码里的 `×` `÷` 指 `mul()` `div()`"。只在公式**最终产出的那个值**上，按 02-architecture 的表换成 `mulCeil`/`mulRound`——中间步骤每一步都四舍五入不会更准，只会让误差在几次乘除之间累积，最后反而离真实值更远。

---

## 第 2 节：4.1 基础——名义价值、起始保证金、未实现盈亏、保证金余额

`packages/engine/src/formulas.ts`：

```ts
export function notional(qty: Fixed, price: Fixed): Fixed {
  return mul(qty, price);
}

export function initialMargin(qty: Fixed, price: Fixed, leverageNum: number): Fixed {
  if (leverageNum <= 0) throw new Error(`leverageNum 必须是正整数，收到 ${leverageNum}`);
  return divRound(notional(qty, price), BigInt(leverageNum) * SCALE);
}

export function unrealizedPnl(
  position: Pick<Position, "positionSide" | "qty" | "entryPrice">,
  markPrice: Fixed,
): Fixed {
  const diff =
    position.positionSide === "SHORT"
      ? position.entryPrice - markPrice
      : markPrice - position.entryPrice;
  return mulRound(diff, position.qty);
}

export function marginBalance(walletBalance: Fixed, unrealizedPnlSum: Fixed): Fixed {
  return walletBalance + unrealizedPnlSum;
}
```

两个小地方值得说：

1. `initialMargin` 的除数是 `leverageNum`（普通整数，不是定标值）。不能直接拿去喂 `divRound`——`divRound` 认为两个操作数都是定标值。解法是把整数先转成"看起来像定标值"的形式：`BigInt(leverageNum) * SCALE`（10 倍杠杆 → `10n * 100_000_000n`，代表"10.00000000"）。这样一转，`divRound` 就能正常工作，不需要为"除以一个普通整数"专门再写一个函数。
2. `unrealizedPnl` 不管 `positionSide` 是 `LONG` 还是 `BOTH`（单向模式），都按多头公式算。`BOTH` 代表"单向模式下唯一的仓位槽"，它的方向已经隐含在调用方怎么维护这个仓位里，不是这个纯函数该操心的事——这个决定和 `position.ts` 里"反手拆分"函数的边界是一致的：公式只管算数，不管业务语义怎么分类。

---

## 第 3 节：4.2 可用余额——顺带定下设计缺口 #6

`docs/tutorial/README.md` 的设计缺口清单第 6 条：**逐仓保证金算不算在钱包余额里**？`01-domain-knowledge.md` 第十二节的资金流水表给出了答案——

> 步骤 1：市价开多 1 BTC @ 50,000，10x，逐仓。划 5,000 做逐仓保证金；付 Taker 费 25。钱包余额 **9,975**。

10,000 起始资金，只扣了 25 的手续费，5,000 的逐仓保证金**没有**从 `walletBalance` 里再扣一次。结论：

> **开仓（不管全仓还是逐仓）不产生 `walletBalance` 的变动，只有手续费和已实现盈亏才动 `walletBalance`。** 逐仓保证金是把这笔钱从"可用"标成"锁定"，钱本身还在 `walletBalance` 里，只是 `availableBalance` 的计算要把它减掉。`ledgerTypeEnum` 里的 `MARGIN_TRANSFER`（见 `02-database-design.md`）对应的是第 08 讲"手动划入/划出逐仓保证金"这个显式操作，不是开仓这一步。

这条结论直接决定了 `availableBalance` 的实现——它是纯粹的读取型计算，不对应任何一条流水：

```ts
export interface AvailableBalanceInput {
  walletBalance: Fixed;
  crossUnrealizedPnlSum: Fixed;
  crossInitialMarginSum: Fixed; // 全仓仓位的起始保证金，按当前 qty/entryPrice/leverageNum 现算，不是存出来的字段
  isolatedMarginSum: Fixed;
  frozenMarginSum: Fixed;
}

export function availableBalance(input: AvailableBalanceInput): Fixed {
  return (
    input.walletBalance +
    input.crossUnrealizedPnlSum -
    input.crossInitialMarginSum -
    input.isolatedMarginSum -
    input.frozenMarginSum
  );
}
```

对应的测试直接把 01-domain-knowledge.md 的算例抄成断言：

```ts
it("01-domain-knowledge.md 第十二节算例：逐仓开仓后可用余额只扣手续费，不扣逐仓保证金本身", () => {
  const walletBalance = parse("9975"); // 10000 − 25 Taker 手续费
  const available = availableBalance({
    walletBalance,
    crossUnrealizedPnlSum: 0n,
    crossInitialMarginSum: 0n,
    isolatedMarginSum: parse("5000"),
    frozenMarginSum: 0n,
  });
  expect(available).toBe(parse("4975"));
});
```

**这一讲不需要处理**：`adjustIsolatedMargin`（手动调整逐仓保证金）真正改不改 `walletBalance`，留给第 08 讲——那时候要决定的是"用户主动划钱"这个动作算不算一条流水，和这一讲"开仓本身不算"是两个问题。

---

## 第 4 节：4.3 挂单冻结保证金

```ts
export function frozenMargin(order: FrozenMarginInput, takerFeeRate: Fixed): Fixed {
  if (order.reduceOnly || order.closePosition) return 0n;
  const n = notional(order.qty, order.price);
  return initialMargin(order.qty, order.price, order.leverageNum) + mulCeil(n, takerFeeRate);
}
```

手续费按 **Taker** 费率预留，即使这张单最后是 Maker 成交——限价单如果一挂上去就穿透盘口，会立刻按 Taker 处理，按 Maker 费率预留会导致真正成交时余额不够。这是"方向保守，宁可多冻结也不要少冻结"的又一个例子。

只减仓单和全部平仓单永远返回 `0n`：它们只会释放保证金，不会占用新的。这条规则在第 6 节会变成不变式 ⑥。

---

## 第 5 节：4.4 仓位变更——加仓、减仓、反手拆分

`packages/engine/src/position.ts` 三个函数，边界故意划得很窄：**只算数，不判断"这笔成交到底属于哪种场景"**。判断属于加仓、减仓还是反手，是第 05 讲撮合逻辑的事，要看订单方向和当前仓位方向的关系。

**加仓**（加权平均开仓价，算例：1 BTC@50,000 再买 1 BTC@52,000 → 2 BTC@51,000）：

```ts
export function addToPosition(
  currentQty: Fixed, currentEntryPrice: Fixed, fillQty: Fixed, fillPrice: Fixed,
): AddResult {
  const newQty = currentQty + fillQty;
  const costSum = mul(currentEntryPrice, currentQty) + mul(fillPrice, fillQty);
  return { qty: newQty, entryPrice: divRound(costSum, newQty) };
}
```

**减仓**（均价不变，算例：2 BTC@51,000 卖 1 BTC@53,000 → 已实现 +2,000，剩 1 BTC 均价仍 51,000）：

```ts
export function reducePosition(
  positionSide, currentQty, entryPrice, currentIsolatedMargin, closeQty, fillPrice,
): ReduceResult {
  const diff = positionSide === "SHORT" ? entryPrice - fillPrice : fillPrice - entryPrice;
  const realizedPnl = mul(diff, closeQty); // 截断，02-architecture 第五节点名的规则
  const releasedMargin =
    closeQty === currentQty
      ? currentIsolatedMargin // 全平：直接给回全部，不走除法，不会因为截断漏掉几分钱
      : divRound(mul(currentIsolatedMargin, closeQty), currentQty);
  return { qty: currentQty - closeQty, realizedPnl, releasedMargin };
}
```

`closeQty === currentQty` 单独判断是有意为之：全平是最常见的场景，`released = isolatedMargin × (closeQty÷currentQty)` 这个比例在 `closeQty === currentQty` 时数学上就该恰好等于 100%，但走一遍除法再乘回来，截断误差可能让结果比 `isolatedMargin` 少那么几个 `1e-8`——干脆特判掉，全平永远拿回全部。

**反手拆分**（单向模式，成交量超过现有仓位）：

```ts
export function splitReverseFill(currentQty: Fixed, fillQty: Fixed): ReverseSplit {
  if (fillQty <= currentQty) throw new Error(/* ... */);
  return { closeQty: currentQty, openQty: fillQty - currentQty };
}
```

拆出来的 `closeQty` 喂给 `reducePosition`、`openQty` 喂给 `addToPosition`（`currentQty` 传 `0n`）——第 05 讲会把这两步接起来。双向模式不存在反手，超出部分按 `reduceOnly` 语义直接拒单（第 04 讲的下单校验链）。

---

## 第 6 节：4.5/4.6 杠杆分层、维持保证金、强平价——顺带定下设计缺口 #5

`packages/engine/src/liquidation.ts`。分层查找和维持保证金是热路径（每次标记价更新都要为持仓中的每个仓位跑一遍），所以 `findBracket` 假设传进来的 `brackets` 已经按 `notionalCap` 升序排好（`state.ts` 装载配置时排过一次），不在这里重复排序：

```ts
export function findBracket(brackets: readonly LeverageBracket[], notionalValue: Fixed): LeverageBracket {
  for (const bracket of brackets) {
    if (notionalValue <= bracket.notionalCap) return bracket;
  }
  return brackets[brackets.length - 1]!; // 超出最后一层兜底，不抛错——下单校验链应该已经挡住了
}

export function maintMargin(notionalValue: Fixed, bracket): Fixed {
  return mulRound(notionalValue, bracket.mmr) - bracket.cum;
}
```

### 强平价：不对齐 tickSize

设计缺口清单第 5 条：4.6 节的伪代码里强平价调了 `alignPrice(...)`，但算例 A 的答案 **45,180.72** 本身就不是任何常见 `tickSize`（比如 0.1）的整数倍。这一讲的结论是**强平价不对齐 tickSize**——它是一个纯粹的风控阈值，不是要挂到盘口上的委托价，不需要对齐任何交易所的价格粒度。委托价才需要 `alignPrice`（第 04 讲的下单校验链会用到）。

```ts
export function liquidationPrice(input: LiquidationPriceInput): Fixed {
  const isShort = input.positionSide === "SHORT";
  const isIsolated = input.marginMode === "ISOLATED";

  const WB = isIsolated ? input.isolatedMargin : input.walletBalance;
  const TMM = isIsolated ? 0n : input.otherCrossMaintMarginSum;
  const UPNL = isIsolated ? 0n : input.otherCrossUnrealizedPnlSum;
  const cumB = isIsolated ? input.bracket.cum : 0n;
  const cumL = isIsolated ? 0n : input.bracket.cum;

  const sideTerm = mul(input.qty, input.entryPrice);
  const numerator = WB - TMM + UPNL + cumB - cumL - (isShort ? -sideTerm : sideTerm);

  const mmrTerm = mul(input.qty, input.bracket.mmr);
  const denominator = mmrTerm - (isShort ? -input.qty : input.qty);

  if (denominator === 0n) throw new Error(/* ... */);
  return divRound(numerator, denominator); // 只在最后一步四舍五入
}
```

三个算例（45,180.72 / 54,780.88 / 40,160.64）连反向验算一起写进了 `liquidation.test.ts`。**反向验算不能手写 `mul()` 重新算一遍**——踩了一次坑：强平价本身已经经过一次 `divRound` 四舍五入，如果反向验算里用截断的 `mul()` 重新算维持保证金，两条路径的舍入方式不一致，会在最后一位差 `1e-8`（`21912350598n` vs `21912350597n` 这种）。正确做法是反向验算也调用生产代码里真正在用的 `unrealizedPnl`/`maintMargin`，让两条路径用同一套舍入规则：

```ts
const pos = { positionSide: "LONG" as const, qty: parse("1"), entryPrice: parse("50000") };
const marginBalanceAtLiq = marginBalance(parse("5000"), unrealizedPnl(pos, liq));
const maintMarginAtLiq = maintMargin(notional(pos.qty, liq), bracket1);
expect(marginBalanceAtLiq).toBe(maintMarginAtLiq); // 现在两边严格相等，不差一分钱
```

### 保证金率的一个哨兵值

```ts
export function marginRatio(maintMarginSum: Fixed, marginBalanceValue: Fixed): Fixed {
  if (marginBalanceValue <= 0n) return SCALE; // 已经穿仓，直接判定 ≥100%，不真的去除
  return divRound(maintMarginSum, marginBalanceValue);
}
```

保证金余额已经跌到 0 或负数时，说明早就该强平了——不管这时候拿去除会不会报错（除以 0）或算出一个没有意义的负比例，都不如直接返回一个"确定 ≥100%"的值，让第 07 讲的风控扫描能统一按 `ratio >= SCALE` 判断，不用为这个边界单独写一条分支。

---

## 第 7 节：4.7/4.8 资金费、手续费

```ts
export function fundingFee(position, fundingRate: Fixed, markPrice: Fixed): Fixed {
  const amount = mul(notional(position.qty, markPrice), fundingRate);
  return position.positionSide === "SHORT" ? amount : -amount; // 费率为正：多头付出，空头收到
}

export function fee(fillQty: Fixed, fillPrice: Fixed, role, feeConfig): Fixed {
  const rate = role === "MAKER" ? feeConfig.makerFeeRate : feeConfig.takerFeeRate;
  return mulCeil(notional(fillQty, fillPrice), rate); // 向上取整，摩擦成本不被低估
}
```

`01-domain-knowledge.md` 的两个算例直接抄成测试：1 BTC 多单标记价 50,000、费率 +0.01% → 付出 5 USDT；市价开仓 1 BTC@50,000 的 Taker 费 25 USDT，限价平仓@52,000 的 Maker 费 10.4 USDT。

资金费的舍入方式 04-backend-design.md 没有点名，这一讲按"公式里没写明的步骤用默认截断"的通用约定处理，和手续费"按最坏情况预留""已实现盈亏截断"是同一个保守方向。

---

## 第 8 节：一个意外发现的显示 bug——`format()` 该四舍五入，不该截断

写算例 B（强平价 54,780.88）的测试时发现：`liquidationPrice` 算出来的内部值是 `54780.87649402…`（8 位精度），如果按文档原来的写法 `format(liq, 2)` 来验证，结果是 **"54780.87"**，不是文档里写的 "54780.88"。

原因在 `format()` 本身——它对精度之外的部分是**截断**（`.slice(0, precision)`），不是四舍五入。这在旧测试里从来没暴露过，因为唯一写出来的例子（算例 A，45,180.72）恰好截断和四舍五入结果一样（第 3 位小数是 2，无论截断还是四舍五入都是 "72"）。算例 B 的第 3 位小数是 6，两种做法第一次分道扬镳。

这不是哪条业务规则的问题，是纯粹的显示 bug：把一个 8 位精度的内部数值截到 2 位给用户看，理应是正常的四舍五入（不然用户会觉得界面上的强平价"卡在"一个比实际偏低的数字上）。修法：

```ts
export function format(value: Fixed, precision = 8): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(8 - precision);
  const rounded = ((abs + divisor / 2n) / divisor) * divisor; // 先四舍五入到目标精度，再拆开
  const intPart = rounded / SCALE;
  const fracPart = (rounded % SCALE).toString().padStart(8, "0").slice(0, precision);
  const sign = negative && rounded !== 0n ? "-" : "";
  return precision > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}
```

对整个 `abs` 值四舍五入到目标精度再拆分成整数/小数部分，进位能正确传到整数位（比如 `1.999999996` 截到 2 位要变成 `"2.00"`，不是 `"1.99"`），这个 case 也写进了测试。全仓库唯一一处非默认精度调用 `format()` 的地方是设计文档里的测试算例，其余生产代码（`packages/db/src/brackets/sync.ts`）都用默认的 8 位精度——8 位本身不会被截断也不需要四舍五入，这个改动不影响任何已有行为，只是让"截到更少位数"这条此前没人用过的路径变得正确。

---

## 第 9 节：把第 02 讲留空的不变式 ③⑥ 接进去

`06-testing-design.md` 第 4 节的七条引擎不变式，②④⑤⑦⑧ 第 02 讲已经实现。这一讲补上：

- **③ 可用余额非负**：调用第 2-4 节写的 `availableBalance`，按账户分组遍历 `snapshot.positions`/`snapshot.orders`。全仓仓位需要标记价才能算未实现盈亏，而 `EngineSnapshot` 本身不含行情状态（"行情不进快照"，`02-architecture.md` 第七节）——解法是测试脚手架（`testing/harness.ts`）旁路记一份"每个币对最后一次见到的标记价"，只在 `apply(markPrice 输入)` 时更新，传给 `checkInvariants` 当第四个参数。某个币对还没见过标记价时，跳过那个账户的检查而不是报错——"不知道"和"算出来是负的"是两回事。
- **⑥ 只减仓 / 全部平仓单不冻结保证金**：直接检查 `(order.reduceOnly || order.closePosition) ⟹ order.frozenMargin === 0n`，对应第 4 节 `frozenMargin()` 的行为。

第 03 讲还没有任何 `apply()` 路径会真的创建仓位或挂单（`placeOrder` 依然在 `apply.ts` 里直接抛"还没实现"），所以这两条不变式目前对现有测试恒为"平凡成立"。`testing/invariants.test.ts` 直接手工构造 `EngineSnapshot` 单独测这两条——不用等第 04/05 讲把下单校验链和撮合接好，两条规则已经就位，一旦后面几讲开始真的产出仓位和订单，它们会自动开始起作用。

---

## 验收清单

- [ ] `pnpm --filter @binance-contract-trading-full-stack/shared test` 全绿（31 条，含 `mulRound` 和 `format` 四舍五入的新测试）
- [ ] `pnpm --filter @binance-contract-trading-full-stack/engine test` 全绿（84 条）
- [ ] 强平价三个算例（45,180.72 / 54,780.88 / 40,160.64）**带反向验算**且用的是生产函数，不是手写重算
- [ ] `format(divRound(parse("55000"), parse("1.004")), 2)` 等于 `"54780.88"`，不是 `"54780.87"`
- [ ] 分层表连续性：名义价值恰好在两层边界上，两层算出的维持保证金相等
- [ ] `availableBalance` 的算例对应 01-domain-knowledge.md 第十二节，锁定"开仓不扣逐仓保证金本身"这条结论
- [ ] `checkInvariants` 签名多了 `marks` 参数，`testing/harness.ts` 相应更新，所有调用点（就这一处）跟着改
- [ ] `pnpm --filter @binance-contract-trading-full-stack/shared --filter @binance-contract-trading-full-stack/engine --filter @binance-contract-trading-full-stack/db --filter server run check-types` 全过（`web`/`native` 的已知失败不用管）

全部打勾，进第 04 讲：下单校验链（13 步）。
