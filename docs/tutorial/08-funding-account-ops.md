# 08 · 搭建教程：资金费与账户操作

> 引擎能开仓、平仓、挂单、强平了，还差两类"不下单也会动钱或动仓位"的事：
> **每 8 小时的资金费**，和**用户自己调的设置**（杠杆、全仓 / 逐仓、单向 / 双向、逐仓保证金、账户重置）。
>
> 这一讲结束时，`01-domain-knowledge.md` 第十二节那张资金流水表可以用真实输入一步不差地重放出来——这是引擎内核的毕业考试。

**这一讲结束时你会有什么**：

- `packages/engine/src/funding.ts`：`settleFunding()`，资金费结算 + 结算后风控扫描
- `packages/engine/src/account-ops.ts`：`setLeverage()` / `setMarginMode()` / `setPositionMode()` / `adjustIsolatedMargin()` / `resetAccount()`
- `apply.ts`：12 种输入全部接上，除了触发单（第 09 讲）已经没有"还没实现"的分支
- `ledger-replay.test.ts`：第十二节整张表重放，钱包 11,959.5
- `01-domain-knowledge.md` 六处过时内容加了注（第 07 讲后你让我"跑一遍看看"时发现的）
- 23 条新测试，引擎共 266 条全绿

**先读**：`docs/design/04-backend-design.md` 第 9 节（资金费）、第 11 节"账户重置"（**注意两处末尾的"已定"**）；`01-domain-knowledge.md` 第八节（资金费）、第十二节；`docs/design/07-binance-reference.md` 第 9 节（这一讲核对的币安规则）。

> **代码已经在仓库里了**：AI 写代码和讲义，你对照着读。代码块用脚本从源文件截取，和仓库逐字一致（只去掉公共缩进）。

---

## 第 1 节：这一讲定下来的事

全部按币安核对过，出处写在 `07-binance-reference.md` 第 9 节。

| # | 决定 | 依据 |
| --- | --- | --- |
| 1 | 资金费 = **标记价** × 数量 × 费率，结算时刻的费率和标记价由宿主带进来 | 币安 FAQ "Introduction to Binance Futures Funding Rates"：`Nominal Value of Positions = Mark Price * Size of a Contract` |
| 2 | **逐仓仓位的资金费从逐仓保证金里付**：钱包余额和 `isolatedMargin` 一起变；全仓只动钱包 | 币安用户数据流文档：资金费发生在逐仓仓位上时，`ACCOUNT_UPDATE` 带上那个仓位的 isolated wallet |
| 3 | 结算后立刻对付了钱的账户跑 `riskScan` | 设计文档第 9 节；06-testing-design"结算后触发强平" |
| 4 | 间隔不写死，由宿主按推送里的下次结算时间排期 | 币安按币对设置，默认 8 小时，会调整 |
| 5 | 调杠杆：范围 1 ～ 第 1 层最大杠杆；逐仓有仓位不能调低；持仓 + 开仓挂单不能超过新杠杆的最大名义价值；调低时余额要够 | 币安 -4028 / -4161 / -2027 / -4050 |
| 6 | 调杠杆通过后，**设置、仓位、挂单冻结保证金一起改** | 第 05 讲 `applyFill` 要求仓位和设置一致，否则抛错 |
| 7 | 切保证金模式看**这个币对**有没有挂单 / 持仓；切持仓模式看**所有币对** | 币安 -4047 / -4048 / -4067 / -4068 |
| 8 | 设置和当前一样：拒单 | 币安 -4046 / -4059 |
| 9 | 调逐仓保证金按币安"最多可加 / 可减"公式限额 | 币安 FAQ "How to Adjust Margin Balance in Cross/Isolated Margin Mode?" |
| 10 | **调逐仓保证金不写流水** | 缺口 #6：逐仓保证金本来就在钱包余额里，加减只是在"全仓可用"和"锁给仓位"之间挪，钱包不变 |
| 11 | 账户重置：撤单 → 按标记价平仓（不收手续费）→ `RESET` 流水补到目标金额；冷却由宿主管 | 设计文档第 11 节；引擎不看钟 |
| 12 | 缺口 #19 的不变式 ③：检查范围从"下单"扩到"调杠杆、调逐仓保证金" | 这两个操作也会占用保证金 |

新记（给第 13 讲）：#26 `MARGIN_TRANSFER` 流水类型暂时没人用；#27 错误码和币安不是一一对应。

---

## 第 2 节：资金费

```ts
export function settleFunding(state: EngineState, input: InputOf<"settleFunding">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  const events: EngineEvent[] = [];
  const paid: string[] = [];

  for (const position of sortedPositions(state, (p) => p.symbol === input.symbol && p.qty > 0n)) {
    const amount = fundingFee(position, input.rate, input.markPrice);
    if (amount === 0n) continue; // 费率为 0，或者名义价值小到舍入后为 0：没有资金往来，不记流水
    const account = state.accounts.get(position.accountId);
    if (!account) throw new Error(`仓位 ${position.accountId}/${position.symbol} 属于不存在的账户`);

    const id = `funding:${position.accountId}:${position.symbol}:${position.positionSide}:${input.ts}`;
    const payment: FundingPayment = {
      id,
      accountId: position.accountId,
      symbol: position.symbol,
      positionSide: position.positionSide,
      fundingRate: input.rate,
      markPrice: input.markPrice,
      notional: notional(position.qty, input.markPrice),
      amount,
      ts: input.ts,
    };
    const walletBalance = account.walletBalance + amount;
    putAccount(state, { ...account, walletBalance });
    events.push({ t: "fundingPaid", payment });

    if (position.marginMode === "ISOLATED") {
      const updated: Position = { ...position, isolatedMargin: position.isolatedMargin + amount, updatedAt: input.ts };
      putPosition(state, updated);
      events.push({ t: "positionUpdate", position: updated });
    }

    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance,
      delta: amount,
      reason: "FUNDING",
      symbol: position.symbol,
      ref: { type: "funding", id },
      ts: input.ts,
    });
    paid.push(account.id);
  }

  return [...events, ...riskScan(state, paid, input.ts)];
}
```

### 为什么逐仓仓位要改两个数

第 03 讲定过（缺口 #6）：**逐仓保证金留在钱包余额里**，只是把一部分标成"锁定给这个仓位"。

```
钱包余额 9,975 = 全仓可用部分 4,975 + 锁给逐仓多头的 5,000
```

逐仓仓位付 5.1 资金费，钱是从"锁给这个仓位"的那 5,000 里出的：

```
钱包余额 9,969.9 = 全仓可用部分 4,975（不变）+ 锁给逐仓多头的 4,994.9
```

只改钱包不改 `isolatedMargin`，就等于从全仓那 4,975 里付了——全仓仓位被逐仓仓位的资金费"传染"，逐仓"只影响这个仓位"的承诺就破了。只改 `isolatedMargin` 不改钱包，钱包和流水就对不上（不变式 ①）。

币安那边的证据是用户数据流：资金费发生在全仓仓位上时，推送只带余额；发生在逐仓仓位上时，额外带上那个仓位——因为那个仓位的 isolated wallet 变了。

### 结算后强平

`riskScan(state, paid, ts)`：只扫付了（或收了）资金费的账户。一笔资金费足以把高杠杆仓位推过线：

```
10x 逐仓多 1 @ 50,000，标记价 45,180.8
  权益 5,000 − 4,819.2 = 180.8 > 维持保证金 180.7232    ← 不强平
结算 +0.01%：资金费 45,180.8 × 0.0001 = 4.51808
  逐仓保证金 4,995.48192，权益 176.28192 ≤ 180.7232    ← 同一次 apply 里立刻强平
```

---

## 第 3 节：调杠杆

```ts
export function setLeverage(state: EngineState, input: InputOf<"setLeverage">): EngineEvent[] {
  const account = requireAccount(state, input.accountId);
  requireSymbol(state, input.symbol);
  const brackets = state.brackets.get(input.symbol)!;
  const current = settingOf(state, account.id, input.symbol);
  const leverageNum = input.leverageNum;

  const maxLeverageNum = brackets[0]!.maxLeverageNum;
  if (!Number.isInteger(leverageNum) || leverageNum < 1 || leverageNum > maxLeverageNum) {
    return reject(input, "INVALID_PARAMS", `杠杆必须是 1 ～ ${maxLeverageNum} 的整数，收到 ${leverageNum}`);
  }
  if (leverageNum === current.leverageNum) {
    return reject(input, "INVALID_PARAMS", `${input.symbol} 当前杠杆已经是 ${leverageNum}x`);
  }

  const positions = sortedPositions(state, (p) => p.accountId === account.id && p.symbol === input.symbol && p.qty > 0n);
  const orders = sortedOrders(state, (o) => o.accountId === account.id && o.symbol === input.symbol);
  const lowering = leverageNum < current.leverageNum;

  if (lowering && current.marginMode === "ISOLATED" && positions.length > 0) {
    return reject(input, "INVALID_PARAMS", "逐仓模式下有持仓时不能调低杠杆，可以先追加逐仓保证金，或平仓后再调");
  }

  const mark = state.marks.get(input.symbol)?.markPrice;
  if (positions.length > 0 && mark === undefined) {
    return reject(input, "MARKET_NOT_READY", `${input.symbol} 还没有标记价，暂时无法校验持仓`);
  }

  // 规则 3：每个方向分别算（和下单第 9 步一样：持仓按标记价 + 开仓挂单按委托价）
  const cap = maxNotionalFor(brackets, leverageNum);
  for (const direction of ["LONG", "SHORT"] as Direction[]) {
    const held = positions.find((p) => p.positionSide === direction);
    const total = (held ? notional(held.qty, mark!) : 0n) + pendingOpenNotional(state, account, input.symbol, direction);
    if (total > cap) {
      return reject(
        input,
        "LEVERAGE_TOO_HIGH",
        `${leverageNum}x 下 ${input.symbol} 最大可持有名义价值 ${cap} ，当前${direction === "LONG" ? "多头" : "空头"}持仓加挂单已有 ${total}，请降低仓位或选更低的杠杆`,
      );
    }
  }

  // 规则 4：试算调完之后的可用余额
  const nextFrozen = new Map<string, Fixed>();
  let marginDelta = 0n;
  for (const order of orders) {
    if (order.price === null || (order.type !== "LIMIT" && !order.triggered)) continue;
    const next = restingFrozenMargin(state, order, order.qty - order.executedQty, leverageNum);
    nextFrozen.set(order.id, next);
    marginDelta += next - order.frozenMargin;
  }
  if (current.marginMode === "CROSS") {
    for (const p of positions) {
      marginDelta += initialMargin(p.qty, p.entryPrice, leverageNum) - initialMargin(p.qty, p.entryPrice, p.leverageNum);
    }
  }
  if (marginDelta > 0n) {
    const available = accountAvailable(state, account);
    if (typeof available === "string") {
      return reject(input, "MARKET_NOT_READY", `缺少 ${available} 的标记价，暂时无法计算可用余额`);
    }
    if (available - marginDelta < 0n) {
      return reject(
        input,
        "INSUFFICIENT_MARGIN",
        `调到 ${leverageNum}x 需要多占用保证金 ${marginDelta} USDT，可用余额只有 ${available} USDT`,
      );
    }
  }

  // ── 生效 ──
  const setting = { ...current, leverageNum };
  putSetting(state, setting);
  const events: EngineEvent[] = [{ t: "settingUpdate", setting }];
  for (const p of positions) {
    const updated: Position = { ...p, leverageNum, updatedAt: input.ts };
    putPosition(state, updated);
    events.push({ t: "positionUpdate", position: updated });
  }
  for (const order of orders) {
    const next = nextFrozen.get(order.id);
    if (next === undefined || next === order.frozenMargin) continue;
    const updated: Order = { ...order, frozenMargin: next, updatedAt: input.ts };
    putOrder(state, updated);
    events.push({ t: "orderUpdate", order: updated });
  }
  return events;
}
```

四条规则的顺序：先查便宜的（范围、是否没变、逐仓不能调低），再查要算的（名义价值上限、余额）。

**规则 3 为什么也算挂单**：和下单第 9 步同一个口径。不算的话，用户可以先挂 10 张开仓单、再把杠杆调高到这些单全成交后不允许的档位。

**规则 4 为什么要先试算**：`restingFrozenMargin` 这一讲加了一个可选参数，按指定的杠杆算：

```ts
export function restingFrozenMargin(
  state: EngineState,
  order: Readonly<Order>,
  remaining: Fixed,
  /** 第 08 讲调杠杆前试算用：按这个杠杆算，不传就按当前设置。 */
  leverageNum = settingOf(state, order.accountId, order.symbol).leverageNum,
```

试算出"调完之后要多占多少保证金"，余额不够就拒，**一个状态都不改**。引擎没有"改到一半发现不行再改回去"的能力——undo 日志是给宿主落库失败用的，不是给业务校验用的。

**逐仓调高杠杆时逐仓保证金不动**：10x 逐仓 5,000 调到 20x，仓位还是锁着 5,000，只是起始保证金要求变成 2,500。多出来的 2,500 想拿出来，走"调逐仓保证金"。

---

## 第 4 节：切保证金模式、切持仓模式

```ts
export function setMarginMode(state: EngineState, input: InputOf<"setMarginMode">): EngineEvent[] {
  const account = requireAccount(state, input.accountId);
  requireSymbol(state, input.symbol);
  const current = settingOf(state, account.id, input.symbol);

  if (input.mode === current.marginMode) {
    return reject(input, "INVALID_PARAMS", `${input.symbol} 当前已经是${input.mode === "CROSS" ? "全仓" : "逐仓"}模式`);
  }
  if (sortedOrders(state, (o) => o.accountId === account.id && o.symbol === input.symbol).length > 0) {
    return reject(input, "MARGIN_MODE_LOCKED", `${input.symbol} 上还有挂单，撤掉之后才能切换保证金模式`);
  }
  if (sortedPositions(state, (p) => p.accountId === account.id && p.symbol === input.symbol && p.qty > 0n).length > 0) {
    return reject(input, "MARGIN_MODE_LOCKED", `${input.symbol} 上还有持仓，平仓之后才能切换保证金模式`);
  }

  const setting = { ...current, marginMode: input.mode };
  putSetting(state, setting);
  return [{ t: "settingUpdate", setting }];
}
```

```ts
export function setPositionMode(state: EngineState, input: InputOf<"setPositionMode">): EngineEvent[] {
  const account = requireAccount(state, input.accountId);
  if (input.mode === account.positionMode) {
    return reject(input, "INVALID_PARAMS", `当前已经是${input.mode === "HEDGE" ? "双向" : "单向"}持仓模式`);
  }
  if (sortedOrders(state, (o) => o.accountId === account.id).length > 0) {
    return reject(input, "POSITION_MODE_LOCKED", "还有挂单，全部撤掉之后才能切换持仓模式");
  }
  if (sortedPositions(state, (p) => p.accountId === account.id && p.qty > 0n).length > 0) {
    return reject(input, "POSITION_MODE_LOCKED", "还有持仓，全部平仓之后才能切换持仓模式");
  }

  putAccount(state, { ...account, positionMode: input.mode });
  return [{ t: "positionModeUpdate", accountId: account.id, positionMode: input.mode, ts: input.ts }];
}
```

有挂单或持仓为什么不能切：挂单的冻结保证金、仓位的强平判定全都依赖这两个设置。有仓位时从全仓切逐仓，锁多少保证金？从单向切双向，现有的 `LONG` 仓位算哪边？币安的答案是"不让切"，我们一样。

---

## 第 5 节：调逐仓保证金

```ts
export function adjustIsolatedMargin(state: EngineState, input: InputOf<"adjustIsolatedMargin">): EngineEvent[] {
  const account = requireAccount(state, input.accountId);
  requireSymbol(state, input.symbol);

  if (account.positionMode === "HEDGE" && input.positionSide === "BOTH") {
    return reject(input, "POSITION_SIDE_MISMATCH", "当前是双向持仓模式，positionSide 必须是 LONG 或 SHORT");
  }
  if (account.positionMode === "ONE_WAY" && input.positionSide !== "BOTH") {
    return reject(input, "POSITION_SIDE_MISMATCH", `当前是单向持仓模式，positionSide 必须是 BOTH，收到 ${input.positionSide}`);
  }
  if (input.delta === 0n) return reject(input, "INVALID_PARAMS", "调整金额不能为 0");

  // 单向模式的 BOTH 在引擎里存成 LONG 或 SHORT（缺口 #12），同一币对最多一个
  const position = (input.positionSide === "BOTH" ? (["LONG", "SHORT"] as const) : [input.positionSide])
    .map((side) => state.positions.get(positionKey(account.id, input.symbol, side)))
    .find((p) => p !== undefined && p.qty > 0n);
  if (!position) return reject(input, "POSITION_NOT_FOUND", `${input.symbol} 上没有可以调整保证金的仓位`);
  if (position.marginMode !== "ISOLATED") {
    return reject(input, "INVALID_PARAMS", "只有逐仓仓位才能调整保证金，全仓仓位用的是整个账户的余额");
  }
  const mark = state.marks.get(input.symbol)?.markPrice;
  if (mark === undefined) return reject(input, "MARKET_NOT_READY", `${input.symbol} 还没有标记价，暂时无法计算可调整额度`);

  if (input.delta > 0n) {
    const addable = maxAddable(state, account);
    if (typeof addable === "string") {
      return reject(input, "MARKET_NOT_READY", `缺少 ${addable} 的标记价，暂时无法计算可追加额度`);
    }
    if (input.delta > addable) {
      return reject(input, "INSUFFICIENT_MARGIN", `最多可追加 ${addable} USDT，本次 ${input.delta} USDT`);
    }
  } else {
    const removable = maxRemovable(state, position, mark);
    if (-input.delta > removable) {
      return reject(input, "MARGIN_WOULD_LIQUIDATE", `最多可减少 ${removable} USDT，本次 ${-input.delta} USDT`);
    }
  }

  const updated: Position = { ...position, isolatedMargin: position.isolatedMargin + input.delta, updatedAt: input.ts };
  putPosition(state, updated);
  return [{ t: "positionUpdate", position: updated }];
}
```

两个上限（币安 FAQ 原文公式）：

```ts
function maxAddable(state: EngineState, account: Readonly<Account>): Fixed | string {
  let isolatedOrderMargin = 0n;
  for (const order of state.orders.values()) {
    if (order.accountId !== account.id) continue;
    if (settingOf(state, account.id, order.symbol).marginMode === "ISOLATED") isolatedOrderMargin += order.frozenMargin;
  }
  let crossMaintMargin = 0n;
  for (const p of sortedPositions(state, (x) => x.accountId === account.id && x.marginMode === "CROSS" && x.qty > 0n)) {
    const mark = state.marks.get(p.symbol)?.markPrice;
    if (mark === undefined) return p.symbol;
    crossMaintMargin += positionMaintMargin(state, p, mark);
  }
  const available = accountAvailable(state, account);
  if (typeof available === "string") return available;
  const fromWallet = crossWalletBalance(state, account.id) - isolatedOrderMargin - crossMaintMargin;
  const limit = fromWallet < available ? fromWallet : available;
  return limit > 0n ? limit : 0n;
}
```

```ts
function maxRemovable(state: EngineState, position: Readonly<Position>, mark: Fixed): Fixed {
  const aboveMaintenance = position.isolatedMargin - positionMaintMargin(state, position, mark);
  const aboveInitial =
    position.isolatedMargin + unrealizedPnl(position, mark) - initialMargin(position.qty, mark, position.leverageNum);
  const limit = aboveMaintenance < aboveInitial ? aboveMaintenance : aboveInitial;
  return limit > 0n ? limit : 0n;
}
```

**最多可减**取两项的较小值：

- `逐仓保证金 − 维持保证金`：减完不能立刻被强平
- `逐仓保证金 + 浮盈亏 − 标记价 × 数量 ÷ 杠杆`：减完仓位权益不能低于**按标记价算的起始保证金**——浮盈可以拿出来，但得留够开这个仓位需要的钱

第二项通常更严。10x 逐仓多 1 @ 50,000：

```
标记价 50,000：min(5,000 − 200, 5,000 + 0 − 5,000) = 0         ← 一分都不能减
标记价 52,000：min(5,000 − 210, 5,000 + 2,000 − 5,200) = 1,800  ← 浮盈 2,000 里能拿走 1,800
```

标记价 52,000 时维持保证金是 210 不是 208：52,000 的名义价值已经在第 2 层（0.5% − 50）。

---

## 第 6 节：账户重置

```ts
export function resetAccount(state: EngineState, input: InputOf<"resetAccount">): EngineEvent[] {
  const account = requireAccount(state, input.accountId);
  if (input.walletBalance < 0n) throw new Error(`重置金额不能为负：${input.walletBalance}`);

  const positions = sortedPositions(state, (p) => p.accountId === account.id && p.qty > 0n);
  const missing = positions.find((p) => !state.marks.has(p.symbol));
  if (missing) return reject(input, "MARKET_NOT_READY", `${missing.symbol} 还没有标记价，暂时无法平仓重置`);

  const events: EngineEvent[] = [];
  for (const order of sortedOrders(state, (o) => o.accountId === account.id)) {
    removeOrder(state, order.id);
    events.push({ t: "orderUpdate", order: { ...order, status: "CANCELED", frozenMargin: 0n, rejectReason: "账户重置", updatedAt: input.ts } });
  }

  let walletBalance = account.walletBalance;
  for (const p of positions) {
    const mark = state.marks.get(p.symbol)!.markPrice;
    const { realizedPnl } = reducePosition(p.positionSide, p.qty, p.entryPrice, p.isolatedMargin, p.qty, mark);
    removePosition(state, positionKey(p.accountId, p.symbol, p.positionSide));
    events.push({ t: "positionUpdate", position: { ...p, qty: 0n, isolatedMargin: 0n, updatedAt: input.ts } });
    if (realizedPnl !== 0n) {
      walletBalance += realizedPnl;
      events.push({
        t: "balanceUpdate",
        accountId: account.id,
        walletBalance,
        delta: realizedPnl,
        reason: "REALIZED_PNL",
        symbol: p.symbol,
        ref: null,
        ts: input.ts,
      });
    }
  }

  // RESET 流水总是写，哪怕差额是 0：它同时是"这里重置过一次"的标记
  events.push({
    t: "balanceUpdate",
    accountId: account.id,
    walletBalance: input.walletBalance,
    delta: input.walletBalance - walletBalance,
    reason: "RESET",
    symbol: null,
    ref: null,
    ts: input.ts,
  });
  putAccount(state, { ...account, walletBalance: input.walletBalance });
  return events;
}
```

**平仓用标记价、不收手续费**：重置不是交易，只是把盈亏落袋。无论平仓价是多少，最后钱包都是 10,000——价格只影响 `REALIZED_PNL` 和 `RESET` 两条流水怎么分账。用标记价是因为它是现成的、不依赖盘口深度，不会因为深度不够而重置失败。

**RESET 流水总是写**：哪怕差额是 0，它也是"这个账户在这里重置过"的记录。

**冷却不在引擎里**：24 小时冷却要看 `accounts.last_reset_at` 和当前时间，引擎没有时钟（CLAUDE.md 硬约束 2），由宿主在调用之前查。

---

## 第 7 节：毕业考试——第十二节整张表

```ts
it("01-domain-knowledge.md 第十二节整张资金流水表：净收益 +1,959.5，ROE +39.19%", () => {
  const t = createTestEngine(testConfig());
  const wallet = () => t.engine.snapshot().accounts[0]!.walletBalance;
  const ledger = (events: EngineEvent[]) =>
    events.flatMap((e) => (e.t === "balanceUpdate" ? [[e.reason, e.delta, e.walletBalance]] : []));

  // 开户 10,000，设成 10x 逐仓
  expect(ledger(t.apply(registerAccountInput("acc-1", "10000")))).toEqual([["INITIAL", parse("10000"), parse("10000")]]);
  t.apply({ t: "setMarginMode", accountId: "acc-1", symbol: "BTCUSDT", mode: "ISOLATED", ts: T0 });
  t.apply({ t: "setLeverage", accountId: "acc-1", symbol: "BTCUSDT", leverageNum: 10, ts: T0 });
  t.apply({ t: "book", symbol: "BTCUSDT", bids: levels([["49999.9", "5"]]), asks: levels([["50000", "5"]]), ts: T0 });
  t.apply(markPriceInput("50000"));

  // ① 市价开多 1 BTC @ 50,000：Taker 费 25，逐仓保证金 5,000（不从钱包扣，缺口 #6）
  const step1 = t.apply(placeOrderInput(orderRequest({ type: "MARKET", price: undefined, timeInForce: undefined, qty: parse("1") })));
  expect(ledger(step1)).toEqual([["FEE", parse("-25"), parse("9975")]]);
  expect(t.engine.snapshot().positions[0]).toMatchObject({ marginMode: "ISOLATED", leverageNum: 10, isolatedMargin: parse("5000") });

  // ② 价格涨到 51,000：浮盈 +1,000 不进钱包，没有任何流水
  expect(t.apply(markPriceInput("51000", T0 + 1))).toEqual([]);
  expect(wallet()).toBe(parse("9975"));

  // ③ 资金费：51,000 × 0.01% = 5.1，从逐仓仓位付
  const step3 = t.apply({ t: "settleFunding", symbol: "BTCUSDT", rate: parse("0.0001"), markPrice: parse("51000"), ts: T0 + 2 });
  expect(ledger(step3)).toEqual([["FUNDING", parse("-5.1"), parse("9969.9")]]);

  // ④ 限价 52,000 平多：挂单排在这一档 2 BTC 后面，主动买单吃掉 3 BTC → Maker 成交
  t.apply({ t: "book", symbol: "BTCUSDT", bids: levels([["51000", "5"]]), asks: levels([["51000.5", "3"], ["52000", "2"]]), ts: T0 + 3 });
  t.apply(placeOrderInput(orderRequest({ clientOrderId: "c-2", side: "SELL", price: parse("52000") }), "acc-1", "o-2", T0 + 3));
  const step4 = t.apply({ t: "trade", symbol: "BTCUSDT", tradeId: 1, price: parse("52000"), qty: parse("3"), buyerIsMaker: false, ts: T0 + 4 });
  expect(ledger(step4)).toEqual([
    ["REALIZED_PNL", parse("2000"), parse("11969.9")],
    ["FEE", parse("-10.4"), parse("11959.5")],
  ]);

  // 结果：钱包 11,959.5，仓位平完，流水之和 = 钱包
  expect(wallet()).toBe(parse("11959.5"));
  expect(t.engine.snapshot().positions).toEqual([]);
  expect(t.ledgerSum("acc-1")).toBe(parse("11959.5"));

  // 净收益 +1,959.5；ROE = 1,959.5 ÷ 起始保证金 5,000 = 39.19%；摩擦成本 = 手续费 35.4 + 资金费 5.1 = 40.5
  expect(wallet() - parse("10000")).toBe(parse("1959.5"));
  expect(divRound(wallet() - parse("10000"), parse("5000"))).toBe(parse("0.3919"));
  const friction = [...ledger(step1), ...ledger(step3), ...ledger(step4)]
    .filter(([reason]) => reason === "FEE" || reason === "FUNDING")
    .reduce((sum, [, delta]) => sum - (delta as bigint), 0n);
  expect(friction).toBe(parse("40.5"));
});
```

和之前几讲的测试不同，这里**一次快照都没手改**：杠杆和保证金模式用 `setMarginMode` / `setLeverage` 输入设，资金费用 `settleFunding` 输入结算，平仓用挂单 + 行情成交。每一步都经过测试脚手架的 9 条不变式 + 回滚自检。

| 步骤 | 流水 | 钱包 |
| --- | --- | --- |
| 开户 | `INITIAL +10,000` | 10,000 |
| ① 市价开多 1 @ 50,000，10x 逐仓 | `FEE −25` | 9,975 |
| ② 标记价 51,000 | 无 | 9,975 |
| ③ 资金费 +0.01% | `FUNDING −5.1` | 9,969.9 |
| ④ 限价 52,000 平多（Maker） | `REALIZED_PNL +2,000`、`FEE −10.4` | **11,959.5** |

净收益 +1,959.5、ROE 39.19%、摩擦成本 40.5，和 `01-domain-knowledge.md` 逐项一致。

**第 ③ 步和文档的一个细节差异**：文档说"付资金费"，没说从哪付。引擎从逐仓保证金里付（第 2 节），逐仓保证金 5,000 → 4,994.9。第 ④ 步平仓时这 4,994.9 整体释放，钱包数字不受影响。文档已补注。

---

## 第 8 节：`01-domain-knowledge.md` 改了哪几处

上一讲结束时重放第十二节，发现表本身没过时，过时的是其它几节。这一讲顺手加注（原文保留，加"已更正 / 补充"块）：

| 位置 | 补了什么 |
| --- | --- |
| 第二节"四种余额" | 可用余额的准确公式：逐仓浮盈不算；逐仓保证金留在钱包里 |
| 第七节"全仓的强平判定" | 全仓权益减逐仓保证金；强平单吃盘口 + 破产价兜底 + 手续费 + 清算费（第 07 讲） |
| 第八节"资金费" | 标记价公式确认；间隔按币对；费率上下限；逐仓从逐仓保证金付 |
| 第九节"手续费" | 费率核对日期；强平清算费 |
| 第十节"切换模式的前提" | 持仓模式看所有币对，保证金模式看单个币对 |
| 第十一节"订单类型" | 触发价格默认最新成交价；`LIQUIDATION` 系统订单 |
| 第十二节 | 第 1、3 步措辞（锁定而不是"划走"、从逐仓保证金付）；"已验证"注 |

---

## 第 9 节：测试怎么组织

| 文件 | 条数 | 测什么 |
| --- | --- | --- |
| `funding.test.ts` | 7 | 06-testing-design 资金费 4 条（正费率多头付、负费率多头收、结算后强平、无仓位无流水）+ 逐仓两个数一起变、双向模式、费率 0 |
| `account-ops.test.ts` | 15 | 调杠杆 6、切保证金模式 2、切持仓模式 2、调逐仓保证金 4、账户重置 1 |
| `ledger-replay.test.ts` | 1 | 第十二节整张表 |

**故意改错跑一遍**，七处都要有测试变红：

| 改法 | 红几条 |
| --- | --- |
| 资金费不改逐仓保证金 | 2 |
| 资金费结算后不扫风控 | 1 |
| 调低杠杆不查余额 | 1 |
| 切保证金模式不查挂单 | 1 |
| 最多可减只看维持保证金 | 2 |
| 逐仓有仓位允许调低杠杆 | 1 |
| 调杠杆不同步仓位 | 2 |

---

## 验收清单

- [ ] `pnpm --filter @binance-contract-trading-full-stack/engine test` 全绿（266 条）
- [ ] `engine` / `shared` / `db` / `server` 四个包 `check-types` 通过
- [ ] 第十二节整张表：`INITIAL +10,000 → FEE −25 → FUNDING −5.1 → REALIZED_PNL +2,000 → FEE −10.4`，钱包 11,959.5
- [ ] 逐仓仓位付资金费：钱包 9,969.9、逐仓保证金 4,994.9
- [ ] 资金费把逐仓仓位推过线：同一次 apply 里强平
- [ ] 调杠杆 20x → 50x：仓位杠杆跟着改，挂单冻结 2,474.5 → 1,004.5
- [ ] 最多可减：标记价 50,000 时 0，52,000 时 1,800
- [ ] 账户重置：`REALIZED_PNL −1,000`、`RESET +1,025`，钱包 10,000，杠杆设置保留
- [ ] `purity.test.ts` 依然全绿

全部打勾，进第 09 讲：触发单与只减仓——引擎内核的最后一讲。

---

## 读完可以自测

1. 逐仓仓位付资金费，为什么钱包余额和逐仓保证金要一起减？只减其中一个分别会出什么问题？
2. 资金费结算为什么要带标记价进来，而不是引擎自己从 `state.marks` 里取？
3. 调杠杆被拒时，为什么必须在改任何状态之前就判断出来？
4. 逐仓 10x 调到 20x，逐仓保证金为什么不变？多出来的钱怎么拿出来？
5. 10x 逐仓多 1 @ 50,000，标记价 50,000 时为什么一分保证金都不能减？
6. 调逐仓保证金为什么不写流水？`MARGIN_TRANSFER` 这个流水类型以后可能用在哪？
7. 账户重置为什么要先平仓再写 `RESET`，不直接把余额改成 10,000？冷却为什么不放在引擎里？
8. 毕业考试为什么强调"一次快照都没手改"？
