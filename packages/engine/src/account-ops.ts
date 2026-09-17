import type { ErrorCode, Fixed } from "@binance-contract-trading-full-stack/shared";
import { restingFrozenMargin } from "./execute-order";
import { initialMargin, notional, unrealizedPnl } from "./formulas";
import { putAccount, putOrder, putPosition, putSetting, removeOrder, removePosition } from "./journal";
import { reducePosition } from "./position";
import { crossWalletBalance, positionMaintMargin } from "./risk";
import { positionKey, requireSymbol, settingOf, sortedOrders, sortedPositions, type EngineState } from "./state";
import type { Account, EngineEvent, EngineInput, EngineInputType, Order, Position } from "./types";
import { accountAvailable, maxNotionalFor, pendingOpenNotional, type Direction } from "./validate-order";

/**
 * 04-backend-design.md 第 11 节"账户 / 交易"里不下单的那几个操作：调杠杆、切保证金模式、切持仓模式、
 * 调逐仓保证金、账户重置。规则按币安核对（`docs/design/07-binance-reference.md` 第 9 节），
 * 被拒时和下单一样返回 rejected 事件，不改任何状态。
 */

type InputOf<T extends EngineInput["t"]> = Extract<EngineInput, { t: T }>;

function requireAccount(state: EngineState, accountId: string): Readonly<Account> {
  const account = state.accounts.get(accountId);
  if (!account) throw new Error(`账户 ${accountId} 不在引擎里，宿主必须先 registerAccount`);
  return account;
}

function reject(
  input: { t: EngineInputType; accountId: string; ts: number },
  code: ErrorCode,
  message: string,
): EngineEvent[] {
  return [
    { t: "rejected", accountId: input.accountId, input: input.t, clientOrderId: null, orderId: null, code, message, ts: input.ts },
  ];
}

// ─────────────────────────────────────────────────────────────
// 调杠杆（币安 POST /fapi/v1/leverage）
// ─────────────────────────────────────────────────────────────

/**
 * 规则：
 * 1. 范围 1 ～ 这个币对第 1 层的最大杠杆（币安 -4028 INVALID_LEVERAGE）
 * 2. 逐仓有仓位时不能调低（币安 -4161 "Leverage reduction is not supported in Isolated Margin Mode with open positions"）
 * 3. 现有仓位 + 开仓挂单的名义价值，在新杠杆下不能超过允许的最大名义价值（币安 -2027 MAX_LEVERAGE_RATIO，和下单第 9 步同一个口径）
 * 4. 全仓调低杠杆时，起始保证金和挂单冻结保证金变多，调完之后可用余额不能为负（币安 -4050 CROSS_BALANCE_INSUFFICIENT）
 *
 * 通过后：设置、这个币对上的仓位（杠杆跟着设置走，第 05 讲 applyFill 会检查两者一致）、挂单冻结保证金一起更新。
 * 逐仓仓位调高杠杆时逐仓保证金不变——多出来的保证金留在仓位里，想拿出来走调逐仓保证金。
 */
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

// ─────────────────────────────────────────────────────────────
// 切保证金模式（币安 POST /fapi/v1/marginType）
// ─────────────────────────────────────────────────────────────

/** 这个币对上有挂单（-4047）或持仓（-4048）都不能切；和当前一样也拒（-4046）。 */
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

// ─────────────────────────────────────────────────────────────
// 切持仓模式（币安 POST /fapi/v1/positionSide/dual）
// ─────────────────────────────────────────────────────────────

/** 账户级设置，对**所有币对**生效：任何币对有挂单（-4067）或持仓（-4068）都不能切；和当前一样也拒（-4059）。 */
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

// ─────────────────────────────────────────────────────────────
// 调逐仓保证金（币安 POST /fapi/v1/positionMargin）
// ─────────────────────────────────────────────────────────────

/**
 * 只能调逐仓仓位（币安 "Only for isolated symbol"）。上限按币安 FAQ
 * "How to Adjust Margin Balance in Cross/Isolated Margin Mode?"（2026-01-02 更新）：
 *
 *   最多可加 = max(0, min(全仓钱包余额 − Σ 逐仓挂单起始保证金 − Σ 全仓仓位维持保证金, 可用余额))
 *   最多可减 = max(0, min(逐仓保证金 − 这个仓位的维持保证金,
 *                        逐仓保证金 + 未实现盈亏 − 标记价 × 数量 ÷ 杠杆))
 *
 * **不写流水**（设计缺口 #6，第 08 讲定）：逐仓保证金本来就在钱包余额里，只是标成"锁定"，
 * 加减只是在"全仓可用"和"锁给这个仓位"之间挪，钱包余额不变。`MARGIN_TRANSFER` 流水类型暂不使用。
 */
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

function maxRemovable(state: EngineState, position: Readonly<Position>, mark: Fixed): Fixed {
  const aboveMaintenance = position.isolatedMargin - positionMaintMargin(state, position, mark);
  const aboveInitial =
    position.isolatedMargin + unrealizedPnl(position, mark) - initialMargin(position.qty, mark, position.leverageNum);
  const limit = aboveMaintenance < aboveInitial ? aboveMaintenance : aboveInitial;
  return limit > 0n ? limit : 0n;
}

// ─────────────────────────────────────────────────────────────
// 账户重置（我们自己的功能，币安没有）
// ─────────────────────────────────────────────────────────────

/**
 * 04-backend-design.md 第 11 节"账户重置"：撤掉所有挂单 → 按标记价平掉所有仓位（记已实现盈亏）→
 * 写一条 RESET 流水把钱包设回初始金额。24 小时冷却由宿主查 accounts.last_reset_at，引擎不看钟。
 *
 * 为什么不直接把余额改成 10,000：每一分钱的变化都要有流水，钱包余额 == 流水之和这条不变式不能破。
 * 平仓价用标记价、不收手续费：这不是一笔交易，只是把盈亏落袋、让流水自洽，用哪个价格只影响
 * REALIZED_PNL 和 RESET 两条流水怎么分，不影响重置之后的余额。持仓模式和各币对的杠杆设置保留。
 */
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
