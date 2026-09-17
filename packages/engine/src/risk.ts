import { divRound, mulCeil, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { fee as tradingFeeOf, notional, unrealizedPnl } from "./formulas";
import { putAccount, putPosition, removeOrder, removePosition } from "./journal";
import { findBracket, maintMargin } from "./liquidation";
import { reducePosition } from "./position";
import { positionKey, requireSymbol, sortedOrders, sortedPositions, type EngineState } from "./state";
import type { EngineEvent, Fill, LiquidationRecord, Order, Position } from "./types";

/**
 * 04-backend-design.md 第 8 节：风控扫描与强平。
 *
 * 触发条件（币安 FAQ "Liquidation Protocols"：保证金余额 < 维持保证金、保证金率达到 100%、标记价触及强平价时强平）：
 * - 逐仓：每个仓位单独判，仓位权益 = 逐仓保证金 + 未实现盈亏 ≤ 这个仓位的维持保证金
 * - 全仓：整个账户一起判，全仓权益 = 全仓钱包余额 + 全仓未实现盈亏 ≤ 全仓仓位维持保证金之和
 *   全仓钱包余额 = 钱包余额 − 逐仓保证金（缺口 #6：逐仓保证金没有从钱包里扣出去，要在这里减掉）
 * 恰好相等也强平：价格"触及"强平价就强平（06-testing-design.md "价格触及强平价 → 强平"）。
 *
 * 强平怎么成交（用户 2026-09-17 定，按币安 FAQ "Liquidation Protocols" + "ADL"）：
 * 1. 撤单：全仓撤这个账户**所有**挂单，逐仓撤这个账户在**这个币对**上的所有挂单，状态 EXPIRED（币安到期原因 5）
 * 2. 系统代用户下一张强平单（type LIQUIDATION），限价 = 破产价、IOC：逐档吃可见盘口，价格比破产价差的档位不吃
 * 3. 吃不完的剩余按破产价平掉——币安这部分由保险基金按破产价接管，对用户来说结果一样：这个仓位的保证金亏光
 * 4. 扣费（用户 2026-09-17 定，币安 FAQ "What Fees are Generated in Binance Futures Trading?" 核对）：
 *    吃盘口的每笔成交按 Taker 收交易手续费（币安：Commission Fee "Incurred every time an order is executed"）；
 *    再收清算费 = 成交数量 × 成交价 × 币对清算费率（币安：Insurance Clearance Fee = Notional Value × Fee Rate，
 *    Notional Value = Number of Contracts × Trade Price）。
 *    顺序 已实现盈亏 → 交易手续费 → 清算费，**每一项最多扣到这个仓位剩下的资产为 0**，不倒扣；
 *    按破产价接管的那部分不收交易手续费（不是市场成交），有接管（破产仓位）就不收清算费
 * 5. 不做"保证金够了就停"的部分强平，整个仓位一次平掉（用户定：币安那张 IOC 单多大文档没说，不编）
 *
 * 模拟盘做不到、刻意不同的：没有保险基金和 ADL（失真点 #5）、穿仓不追偿（失真点 #6）、
 * 强平单不消耗盘口（失真点 #2）。
 */

// ─────────────────────────────────────────────────────────────
// 扫描
// ─────────────────────────────────────────────────────────────

/** 对若干账户跑风控扫描。账户按 id 排序，保证事件顺序确定。 */
export function riskScan(state: EngineState, accountIds: Iterable<string>, ts: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const accountId of [...new Set(accountIds)].sort()) {
    events.push(...scanAccount(state, accountId, ts));
  }
  return events;
}

/** 在某个币对上持有仓位的账户——标记价更新后要扫描的就是它们。 */
export function accountsHolding(state: EngineState, symbol: string): string[] {
  return sortedPositions(state, (p) => p.symbol === symbol).map((p) => p.accountId);
}

function scanAccount(state: EngineState, accountId: string, ts: number): EngineEvent[] {
  if (!state.accounts.has(accountId)) return [];
  const events: EngineEvent[] = [];

  // ① 逐仓：一个一个判。先做逐仓：逐仓强平只会让全仓钱包余额变多或不变（亏损上限就是那笔逐仓保证金，
  //    平完之后这笔保证金从"锁定"里释放），不会把全仓推下线
  for (const { symbol, positionSide } of sortedPositions(
    state,
    (p) => p.accountId === accountId && p.marginMode === "ISOLATED",
  )) {
    const position = state.positions.get(positionKey(accountId, symbol, positionSide));
    const mark = state.marks.get(symbol)?.markPrice;
    // 没有标记价就不知道仓位值多少——不知道就不强平，而不是拿 0 顶替
    if (!position || mark === undefined) continue;
    const equity = position.isolatedMargin + unrealizedPnl(position, mark);
    const mm = positionMaintMargin(state, position, mark);
    if (equity > mm) continue;

    events.push(...expireOrders(state, (o) => o.accountId === accountId && o.symbol === symbol, ts));
    events.push(...liquidatePosition(state, position, mark, { marginBalanceBefore: equity, maintMarginAt: mm }, ts));
  }

  // ② 全仓：整户判
  const cross = sortedPositions(state, (p) => p.accountId === accountId && p.marginMode === "CROSS");
  if (cross.length === 0) return events;
  let crossMaintMargin = 0n;
  let crossUnrealizedPnl = 0n;
  for (const position of cross) {
    const mark = state.marks.get(position.symbol)?.markPrice;
    if (mark === undefined) return events; // 有一个全仓仓位缺标记价，整户都算不出来
    crossMaintMargin += positionMaintMargin(state, position, mark);
    crossUnrealizedPnl += unrealizedPnl(position, mark);
  }
  const crossEquity = crossWalletBalance(state, accountId) + crossUnrealizedPnl;
  if (crossEquity > crossMaintMargin) return events;

  events.push(...expireOrders(state, (o) => o.accountId === accountId, ts));
  const forensic = { marginBalanceBefore: crossEquity, maintMarginAt: crossMaintMargin };
  for (const { symbol, positionSide } of cross) {
    // 按币对、方向的顺序一个一个平：前一个平掉之后钱包变了，后一个的破产价要用新的钱包余额算
    const position = state.positions.get(positionKey(accountId, symbol, positionSide))!;
    events.push(...liquidatePosition(state, position, state.marks.get(symbol)!.markPrice, forensic, ts));
  }
  return events;
}

/** 单个仓位的维持保证金：按标记价算名义价值，查这个名义价值所在的分层。 */
export function positionMaintMargin(state: EngineState, position: Readonly<Position>, markPrice: Fixed): Fixed {
  const value = notional(position.qty, markPrice);
  return maintMargin(value, findBracket(state.brackets.get(position.symbol)!, value));
}

/** 全仓钱包余额 = 钱包余额 − 逐仓仓位的保证金（币安 crossWalletBalance）。 */
export function crossWalletBalance(state: EngineState, accountId: string): Fixed {
  let isolated = 0n;
  for (const position of state.positions.values()) {
    if (position.accountId === accountId && position.marginMode === "ISOLATED") isolated += position.isolatedMargin;
  }
  return state.accounts.get(accountId)!.walletBalance - isolated;
}

/** 强平前先让挂单失效。币安到期原因 5："Order has expired when the account was liquidated"。 */
function expireOrders(state: EngineState, filter: (order: Readonly<Order>) => boolean, ts: number): EngineEvent[] {
  return sortedOrders(state, filter).map((order) => {
    removeOrder(state, order.id);
    return {
      t: "orderUpdate",
      order: { ...order, status: "EXPIRED", frozenMargin: 0n, rejectReason: "账户强平，挂单失效", updatedAt: ts },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 平掉一个仓位
// ─────────────────────────────────────────────────────────────

interface Forensic {
  marginBalanceBefore: Fixed;
  maintMarginAt: Fixed;
}

interface LiquidationFill {
  price: Fixed;
  qty: Fixed;
  realizedPnl: Fixed;
  fee: Fixed;
}

function liquidatePosition(
  state: EngineState,
  position: Readonly<Position>,
  markPrice: Fixed,
  forensic: Forensic,
  ts: number,
): EngineEvent[] {
  const account = state.accounts.get(position.accountId)!;
  const spec = requireSymbol(state, position.symbol);
  const isLong = position.positionSide === "LONG";
  const isolated = position.marginMode === "ISOLATED";

  // 这个仓位能动用的资产，不含它自己的未实现盈亏：
  // 逐仓 = 自己的逐仓保证金；全仓 = 全仓钱包余额 + 其它全仓仓位按标记价的未实现盈亏
  let assets = isolated ? position.isolatedMargin : crossWalletBalance(state, account.id);
  if (!isolated) {
    for (const other of state.positions.values()) {
      if (other === position || other.accountId !== account.id || other.marginMode !== "CROSS") continue;
      assets += unrealizedPnl(other, state.marks.get(other.symbol)!.markPrice);
    }
  }

  // 破产价：保证金余额正好归零的价格（币安 ADL FAQ："the price at which the margin balance of the liquidated user is equal to zero"）
  //   多：资产 + (破产价 − 开仓价) × 数量 = 0 → 破产价 = 开仓价 − 资产 ÷ 数量；空头方向相反
  const offset = divRound(assets, position.qty);
  const bankruptcyPrice = isLong ? position.entryPrice - offset : position.entryPrice + offset;

  // ② 强平单 = 限价破产价的 IOC：多头往买盘卖，空头从卖盘买，比破产价差的档位不吃
  const book = state.books.get(position.symbol);
  const levels = book ? (isLong ? book.bids : book.asks) : [];
  const fills: LiquidationFill[] = [];
  let remaining = position.qty;
  const close = (price: Fixed, qty: Fixed, fee: Fixed) => {
    const { realizedPnl } = reducePosition(position.positionSide, remaining, position.entryPrice, 0n, qty, price);
    fills.push({ price, qty, realizedPnl, fee });
    remaining -= qty;
  };
  for (const level of levels) {
    if (remaining === 0n) break;
    if (isLong ? level.price < bankruptcyPrice : level.price > bankruptcyPrice) break;
    const qty = remaining < level.qty ? remaining : level.qty;
    close(level.price, qty, tradingFeeOf(qty, level.price, "TAKER", state.config.fees));
  }

  // ③ 吃不完的剩余：按破产价平掉（币安由保险基金按破产价接管）
  let bankrupt = false;
  if (remaining > 0n && bankruptcyPrice > 0n) {
    close(bankruptcyPrice, remaining, 0n); // 接管不是市场成交，不收交易手续费
    bankrupt = true;
  }
  // 破产价 ≤ 0 只可能出现在全仓、而且其它仓位的维持保证金远大于这个仓位的时候：这个仓位本身离破产还远，
  // 按一个不存在的价格"接管"是编数字。吃不完的留在仓位里，下一次扫描接着平

  let realizedPnl = fills.reduce((sum, f) => sum + f.realizedPnl, 0n);
  // 舍入尾差：已实现盈亏逐笔向下取整，吃到正好等于破产价的档位时，资产可能被多扣几个 1e-8。
  // 这个仓位的亏损上限就是它能动用的资产（穿仓部分币安由保险基金承担，我们不追偿，失真点 #6），补回到正好归零
  if (fills.length > 0 && assets + realizedPnl < 0n) {
    const shortfall = -(assets + realizedPnl);
    fills[fills.length - 1]!.realizedPnl += shortfall;
    realizedPnl += shortfall;
    bankrupt = true;
  }

  const closedQty = position.qty - remaining;
  if (closedQty === 0n) return []; // 盘口一档都吃不到、破产价又 ≤ 0：这次什么都做不了

  // ④ 扣费：已实现盈亏之后剩下的资产，先交交易手续费、再交清算费，每一项最多扣到 0
  //    "剩下的资产"不算其它全仓仓位的浮盈——浮盈还没落袋，不能拿来交费
  let assetsLeft = (isolated ? position.isolatedMargin : crossWalletBalance(state, account.id)) + realizedPnl;
  if (assetsLeft < 0n) assetsLeft = 0n;
  // 交易手续费：逐笔应收；总额超过剩余资产时，从最后一笔往前少收，保证每笔成交记录上的手续费加起来等于实收
  let feeShortfall = fills.reduce((sum, f) => sum + f.fee, 0n) - assetsLeft;
  for (let i = fills.length - 1; i >= 0 && feeShortfall > 0n; i--) {
    const cut = fills[i]!.fee < feeShortfall ? fills[i]!.fee : feeShortfall;
    fills[i]!.fee -= cut;
    feeShortfall -= cut;
  }
  const tradingFee = fills.reduce((sum, f) => sum + f.fee, 0n);
  assetsLeft -= tradingFee;
  // 清算费：按成交的名义价值（数量 × 成交价）收；破产仓位不收。
  // 币安 FAQ："小仓位的维持保证金率可能低于清算费率，进入强平时就会变成破产仓位"——剩余资产不够交清算费时扣到 0 为止
  const feeDue = mulCeil(
    fills.reduce((sum, f) => sum + notional(f.qty, f.price), 0n),
    spec.liquidationFeeRate,
  );
  const liquidationFee = bankrupt ? 0n : feeDue < assetsLeft ? feeDue : assetsLeft;

  // ── 改状态 ──
  const id = `liq:${position.accountId}:${position.symbol}:${position.positionSide}:${ts}`;
  const released = isolated && remaining === 0n ? position.isolatedMargin : 0n;
  const updatedPosition: Position = {
    ...position,
    qty: remaining,
    isolatedMargin: position.isolatedMargin - released,
    updatedAt: ts,
  };
  if (remaining === 0n) {
    removePosition(state, positionKey(position.accountId, position.symbol, position.positionSide));
  } else {
    putPosition(state, updatedPosition);
  }
  const walletBalance = account.walletBalance + realizedPnl - tradingFee - liquidationFee;
  putAccount(state, { ...account, walletBalance });

  // ── 事件：订单 → 成交 → 仓位 → 强平记录 → 流水（LIQUIDATION → FEE… → LIQUIDATION_FEE） ──
  const hedge = account.positionMode === "HEDGE";
  const notionalSum = fills.reduce((sum, f) => sum + notional(f.qty, f.price), 0n);
  const order: Order = {
    id,
    // 币安强平单的 clientOrderId 以 "autoclose-" 开头。带上币对和方向：全仓强平同一时刻会平掉好几个仓位，
    // 数据库 orders 表 (account_id, client_order_id) 唯一（第 11 讲落库时发现）
    clientOrderId: `autoclose-${ts}-${position.symbol}-${position.positionSide}`,
    accountId: position.accountId,
    symbol: position.symbol,
    side: isLong ? "SELL" : "BUY",
    positionSide: hedge ? position.positionSide : "BOTH",
    type: "LIQUIDATION",
    timeInForce: "IOC",
    price: bankruptcyPrice,
    stopPrice: null,
    workingType: "MARK_PRICE",
    qty: position.qty,
    executedQty: closedQty,
    avgPrice: divRound(notionalSum, closedQty),
    reduceOnly: !hedge, // 双向模式不能带 reduceOnly（第 04 讲），平仓方向本身就是减仓
    closePosition: false,
    status: remaining === 0n ? "FILLED" : "EXPIRED",
    triggered: false,
    queueAhead: 0n,
    queueEstimated: false,
    frozenMargin: 0n,
    rejectReason: remaining === 0n ? null : `盘口可成交量不足，剩余 ${remaining} 留待下次强平`,
    createdAt: ts,
    updatedAt: ts,
  };
  const record: LiquidationRecord = {
    id,
    accountId: position.accountId,
    symbol: position.symbol,
    positionSide: position.positionSide,
    marginMode: position.marginMode,
    qty: closedQty,
    entryPrice: position.entryPrice,
    markPrice,
    realizedPnl,
    liquidationFee,
    marginBalanceBefore: forensic.marginBalanceBefore,
    maintMarginAt: forensic.maintMarginAt,
    ts,
  };
  const events: EngineEvent[] = [{ t: "orderUpdate", order }];
  fills.forEach((f, i) => {
    const fill: Fill = {
      id: `${id}:${i + 1}`,
      orderId: id,
      accountId: position.accountId,
      symbol: position.symbol,
      side: order.side,
      positionSide: order.positionSide,
      price: f.price,
      qty: f.qty,
      role: "TAKER",
      fee: f.fee, // Taker 手续费（剩余资产不够时少收）；按破产价接管的那笔为 0
      realizedPnl: f.realizedPnl,
      isLiquidation: true,
      ts,
    };
    events.push({ t: "fill", fill });
  });
  events.push({ t: "positionUpdate", position: updatedPosition });
  events.push({ t: "liquidation", record });

  const ref = { type: "liquidation" as const, id };
  let balance = account.walletBalance;
  if (realizedPnl !== 0n) {
    balance += realizedPnl;
    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance: balance,
      delta: realizedPnl,
      reason: "LIQUIDATION",
      symbol: position.symbol,
      ref,
      ts,
    });
  }
  fills.forEach((f, i) => {
    if (f.fee === 0n) return;
    balance -= f.fee;
    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance: balance,
      delta: -f.fee,
      reason: "FEE",
      symbol: position.symbol,
      ref: { type: "fill", id: `${id}:${i + 1}` },
      ts,
    });
  });
  if (liquidationFee > 0n) {
    balance -= liquidationFee;
    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance: balance,
      delta: -liquidationFee,
      reason: "LIQUIDATION_FEE",
      symbol: position.symbol,
      ref,
      ts,
    });
  }
  return events;
}
