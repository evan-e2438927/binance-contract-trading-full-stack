import { divRound, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { initialMargin, notional, unrealizedPnl } from "./formulas";
import { liquidationPriceDetailed, marginRatio, type LiquidationUnavailableReason } from "./liquidation";
import { crossWalletBalance, positionMaintMargin } from "./risk";
import { sortedOrders, sortedPositions, type EngineState } from "./state";
import type { AccountView, MarketView, Order, Position, PositionView } from "./types";
import { accountAvailable } from "./validate-order";

/**
 * 只读视图（第 13 讲）：把引擎状态算成 REST / WS 要展示的数。
 *
 * 为什么放在引擎里而不是服务端：强平价、可用余额、维持保证金必须和风控用同一套公式、同一份分层表，
 * 两处各算一遍迟早漂移——设计文档说的"强平价由服务端算好返回，前端不自己算"再往前推一步，服务端也不另算。
 *
 * 缺标记价（比如已下架币对上的旧仓位）就返回 null，并在 missingMarkPrices 里点名，不拿 0 顶替。
 */

function requireSettled(state: EngineState): void {
  if (state.journal) throw new Error("有未结算的 apply（没调 commit() 或 rollback()），不能读视图：读到的可能是还没落库的状态");
}

export function accountView(state: EngineState, accountId: string): AccountView | null {
  requireSettled(state);
  const account = state.accounts.get(accountId);
  if (!account) return null;

  const positions = sortedPositions(state, (p) => p.accountId === accountId && p.qty > 0n);
  const missing = new Set<string>();
  let unrealized = 0n;
  let crossUnrealized = 0n;
  let positionIm = 0n;
  let maint = 0n;
  let crossMaint = 0n;
  for (const position of positions) {
    const mark = state.marks.get(position.symbol)?.markPrice;
    if (mark === undefined) {
      missing.add(position.symbol);
      continue;
    }
    const pnl = unrealizedPnl(position, mark);
    const mm = positionMaintMargin(state, position, mark);
    unrealized += pnl;
    positionIm += initialMargin(position.qty, mark, position.leverageNum);
    maint += mm;
    if (position.marginMode === "CROSS") {
      crossUnrealized += pnl;
      crossMaint += mm;
    }
  }

  let openOrderMargin = 0n;
  for (const order of state.orders.values()) {
    if (order.accountId === accountId) openOrderMargin += order.frozenMargin;
  }

  const crossWallet = crossWalletBalance(state, accountId);
  const known = missing.size === 0;
  const available = accountAvailable(state, account);
  return {
    accountId,
    positionMode: account.positionMode,
    walletBalance: account.walletBalance,
    crossWalletBalance: crossWallet,
    unrealizedPnl: known ? unrealized : null,
    crossUnrealizedPnl: known ? crossUnrealized : null,
    marginBalance: known ? account.walletBalance + unrealized : null,
    positionInitialMargin: known ? positionIm : null,
    openOrderMargin,
    maintMargin: known ? maint : null,
    availableBalance: typeof available === "string" ? null : available,
    marginRatio: known ? (crossMaint === 0n ? 0n : marginRatio(crossMaint, crossWallet + crossUnrealized)) : null,
    missingMarkPrices: [...missing].sort(),
  };
}

export function positionViews(state: EngineState, accountId: string): PositionView[] {
  requireSettled(state);
  if (!state.accounts.has(accountId)) return [];
  const positions = sortedPositions(state, (p) => p.accountId === accountId && p.qty > 0n);
  return positions.map((position) => {
    const mark = state.marks.get(position.symbol)?.markPrice ?? null;
    const value = mark === null ? null : notional(position.qty, mark);
    const pnl = mark === null ? null : unrealizedPnl(position, mark);
    const im = mark === null ? null : initialMargin(position.qty, mark, position.leverageNum);
    const liq = liquidationPriceOf(state, position, positions);
    return {
      symbol: position.symbol,
      positionSide: position.positionSide as "LONG" | "SHORT",
      marginMode: position.marginMode,
      leverageNum: position.leverageNum,
      qty: position.qty,
      entryPrice: position.entryPrice,
      markPrice: mark,
      notional: value,
      unrealizedPnl: pnl,
      initialMargin: im,
      maintMargin: mark === null ? null : positionMaintMargin(state, position, mark),
      isolatedMargin: position.marginMode === "ISOLATED" ? position.isolatedMargin : 0n,
      liquidationPrice: liq.price,
      liquidationUnavailableReason: liq.reason,
      breakEvenPrice: breakEvenPriceOf(position),
      marginRatio: positionMarginRatio(state, position, mark),
      roe: pnl === null || im === null || im === 0n ? null : divRound(pnl, im),
      openedAt: position.openedAt,
      updatedAt: position.updatedAt,
    };
  });
}

/**
 * 仓位的保证金比率 = 维持保证金 ÷ 保证金余额。
 * 逐仓：分母是这个仓位自己的保证金 + 它的未实现盈亏——爆的只是它。
 * 全仓：这个仓位单独算没有意义（全账户一起扛），给账户级的全仓保证金率，和 T-08 的那个是同一个数。
 * 缺标记价时为 null。
 */
function positionMarginRatio(state: EngineState, position: Readonly<Position>, mark: Fixed | null): Fixed | null {
  if (mark === null) return null;
  const maint = positionMaintMargin(state, position, mark);
  if (position.marginMode === "ISOLATED") {
    const balance = position.isolatedMargin + unrealizedPnl(position, mark);
    return balance <= 0n ? null : marginRatio(maint, balance);
  }
  const view = accountView(state, position.accountId);
  return view?.marginRatio ?? null;
}

/**
 * 损益两平价（币安 breakEvenPrice）= 累计成本 ÷ 有符号数量。含手续费、不含资金费（和币安一致）。
 * 数量为 0 的仓位不会出现在视图里；真出现了返回 null，不做除零。
 */
function breakEvenPriceOf(position: Readonly<Position>): Fixed | null {
  if (position.qty === 0n) return null;
  const signedQty = position.positionSide === "SHORT" ? -position.qty : position.qty;
  return divRound(position.costBasis, signedQty);
}

/**
 * 逐仓：这个仓位单独算，WB = 它的逐仓保证金。
 * 全仓：WB = 全仓钱包余额；TMM₁ / UPNL₁ = 其它币对的全仓仓位；本币对的全仓仓位（双向模式多空两条）一起进公式。
 * 其它币对缺标记价时算不出 TMM₁ / UPNL₁，返回 reason = "MARK_PRICE_MISSING"（第 25 讲，之前直接 return null，
 * 现在和"保证金充足 / 双向对冲 / 没有腿"三种引擎内部原因一起透传给外层视图，持仓表能显示具体原因而不是一句合并文案）。
 */
function liquidationPriceOf(
  state: EngineState,
  position: Readonly<Position>,
  accountPositions: readonly Readonly<Position>[],
): { price: Fixed | null; reason: LiquidationUnavailableReason | null } {
  const brackets = state.brackets.get(position.symbol)!;
  const leg = (p: Readonly<Position>) => ({ side: p.positionSide as "LONG" | "SHORT", qty: p.qty, entryPrice: p.entryPrice });
  if (position.marginMode === "ISOLATED") {
    return liquidationPriceDetailed({ walletBalance: position.isolatedMargin, otherMaintMarginSum: 0n, otherUnrealizedPnlSum: 0n, legs: [leg(position)], brackets });
  }

  let otherMaint = 0n;
  let otherPnl = 0n;
  const legs = [];
  for (const p of accountPositions) {
    if (p.marginMode !== "CROSS") continue;
    if (p.symbol === position.symbol) {
      legs.push(leg(p));
      continue;
    }
    const mark = state.marks.get(p.symbol)?.markPrice;
    if (mark === undefined) return { price: null, reason: "MARK_PRICE_MISSING" };
    otherMaint += positionMaintMargin(state, p, mark);
    otherPnl += unrealizedPnl(p, mark);
  }
  return liquidationPriceDetailed({
    walletBalance: crossWalletBalance(state, position.accountId),
    otherMaintMarginSum: otherMaint,
    otherUnrealizedPnlSum: otherPnl,
    legs,
    brackets,
  });
}

export function openOrders(state: EngineState, accountId: string): Order[] {
  requireSettled(state);
  return structuredClone(sortedOrders(state, (o) => o.accountId === accountId));
}

export function allAccountViews(state: EngineState): AccountView[] {
  requireSettled(state);
  return [...state.accounts.keys()].sort().map((id) => accountView(state, id)!);
}

export function marketView(state: EngineState, symbol: string): MarketView | null {
  requireSettled(state);
  if (!state.symbols.has(symbol)) return null;
  const book = state.books.get(symbol);
  const mark = state.marks.get(symbol);
  return structuredClone({
    symbol,
    bids: book?.bids ?? [],
    asks: book?.asks ?? [],
    bookTs: book?.ts ?? null,
    markPrice: mark?.markPrice ?? null,
    fundingRate: mark?.fundingRate ?? null,
    nextFundingTs: mark?.nextFundingTs ?? null,
    markTs: mark?.ts ?? null,
    lastPrice: state.lastPrices.get(symbol) ?? null,
  });
}
