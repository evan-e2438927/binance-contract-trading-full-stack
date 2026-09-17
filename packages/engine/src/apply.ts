import { putAccount } from "./journal";
import { requireSymbol, type EngineState } from "./state";
import { executeOrder } from "./execute-order";
import { cancelOrder, matchTrade, reconcileBook } from "./resting-orders";
import { accountsHolding, riskScan } from "./risk";
import { adjustIsolatedMargin, resetAccount, setLeverage, setMarginMode, setPositionMode } from "./account-ops";
import { settleFunding } from "./funding";
import { checkTriggers, placeTriggerOrder } from "./triggers";
import { validateOrder } from "./validate-order";
import type { EngineEvent, EngineInput } from "./types";

type InputOf<T extends EngineInput["t"]> = Extract<EngineInput, { t: T }>;

/**
 * 引擎的总入口：按输入类型分派。
 *
 * 两类错误要分清：
 * - 业务拒绝（余额不够、价格不对齐……）→ 返回 { t: "rejected" } 事件，不抛异常
 * - 程序错误（宿主传了未知币对、重复注册账户……）→ 直接抛 Error，说明接线有 bug
 */
export function applyInput(state: EngineState, input: EngineInput): EngineEvent[] {
  switch (input.t) {
    case "book":
      return applyBook(state, input);
    case "markPrice":
      return applyMarkPrice(state, input);
    case "trade":
      return applyTrade(state, input);
    case "registerAccount":
      return registerAccount(state, input);
    case "placeOrder":
      return placeOrder(state, input);
    case "cancelOrder":
      return cancelOrder(state, input);
    case "settleFunding":
      return settleFunding(state, input);
    case "setLeverage":
      return setLeverage(state, input);
    case "setMarginMode":
      return setMarginMode(state, input);
    case "setPositionMode":
      return setPositionMode(state, input);
    case "adjustIsolatedMargin":
      return adjustIsolatedMargin(state, input);
    case "resetAccount":
      return resetAccount(state, input);
    case "setBrackets":
      return setBrackets(state, input);

    default:
      return assertNever(input);
  }
}

function applyBook(state: EngineState, input: InputOf<"book">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.books.set(input.symbol, {
    bids: input.bids.map((l) => ({ ...l })),
    asks: input.asks.map((l) => ({ ...l })),
    ts: input.ts,
  });
  // 5.2 节：① 覆盖盘口快照 ② 夹逼这个币对所有挂单的排队位置（估算过的顺带校准）
  return reconcileBook(state, input);
}

function applyMarkPrice(state: EngineState, input: InputOf<"markPrice">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.marks.set(input.symbol, {
    markPrice: input.markPrice,
    fundingRate: input.fundingRate,
    nextFundingTs: input.nextFundingTs,
    ts: input.ts,
  });
  // 5.2 节：① 更新标记价 ② 未实现盈亏是现算的，不用存 ③ 按标记价触发的触发单 ④ 风控扫描：这个币对上有仓位的账户
  //   触发必须在风控之前：止损单触发平掉仓位，本来就是为了不被强平
  const events = checkTriggers(state, input.symbol, "MARK_PRICE", input.markPrice, input.ts);
  return [...events, ...riskScan(state, [...accountsHolding(state, input.symbol), ...filledAccounts(events)], input.ts)];
}

function applyTrade(state: EngineState, input: InputOf<"trade">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  // 5.2 节：① 更新最新价 ② 消耗挂单队列、轮到的按挂单价成交并落账 ④ 有成交的账户跑风控扫描
  state.lastPrices.set(input.symbol, input.price);
  // ③ 按最新成交价触发的触发单（放在挂单撮合之后：触发出来的单是在这笔行情成交之后才进盘口的）
  const events = [...matchTrade(state, input), ...checkTriggers(state, input.symbol, "CONTRACT_PRICE", input.price, input.ts)];
  return [...events, ...riskScan(state, filledAccounts(events), input.ts)];
}

/**
 * 分层表热加载（第 11 讲）：宿主的每日同步发现币安调表后，把新表喂进来，立刻对这个币对上有仓位的账户跑风控。
 * 维持保证金率变了，原来安全的仓位可能已经过线——等下一次标记价推送也会扫到，但没理由多等那一秒。
 *
 * 分层表和行情一样属于"配置类状态"，不进 undo 日志：宿主落库失败回滚时不会退回旧表。
 * 这没有问题——币安的表已经变了，回滚掉的只是这次扫描产生的强平，下一次扫描会按新表重新判。
 */
function setBrackets(state: EngineState, input: InputOf<"setBrackets">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  if (input.brackets.length === 0) {
    throw new Error(`币对 ${input.symbol} 的新分层表为空，宿主不应该喂进来`);
  }
  state.brackets.set(
    input.symbol,
    [...input.brackets].sort((a, b) => (a.notionalCap < b.notionalCap ? -1 : a.notionalCap > b.notionalCap ? 1 : 0)),
  );
  return riskScan(state, accountsHolding(state, input.symbol), input.ts);
}

function registerAccount(state: EngineState, input: InputOf<"registerAccount">): EngineEvent[] {
  if (state.accounts.has(input.accountId)) {
    throw new Error(`账户 ${input.accountId} 已经在引擎里了，重复注册说明宿主有 bug`);
  }
  if (input.walletBalance < 0n) {
    throw new Error(`初始余额不能为负：${input.walletBalance}`);
  }

  putAccount(state, {
    id: input.accountId,
    walletBalance: input.walletBalance,
    positionMode: input.positionMode,
  });

  // 开户发钱也走 balanceUpdate：全系统只有这一条路能改余额，所以流水永远不会漏
  return [
    {
      t: "balanceUpdate",
      accountId: input.accountId,
      walletBalance: input.walletBalance,
      delta: input.walletBalance,
      reason: "INITIAL",
      symbol: null,
      ref: null,
      ts: input.ts,
    },
  ];
}

function placeOrder(state: EngineState, input: InputOf<"placeOrder">): EngineEvent[] {
  // 订单 id 由宿主生成（设计缺口 #2），重复说明宿主的 id 生成器有 bug
  if (state.orders.has(input.orderId)) {
    throw new Error(`订单 id ${input.orderId} 已经存在，宿主生成了重复的 id`);
  }

  const result = validateOrder(state, input.accountId, input.req);
  if (!result.ok) {
    // 被拒的单不进内存、不进挂单簿，只产出一条 rejected 事件（04-backend-design.md 第 3 节状态机）
    return [
      {
        t: "rejected",
        accountId: input.accountId,
        input: "placeOrder",
        clientOrderId: input.req.clientOrderId,
        orderId: input.orderId,
        code: result.code,
        message: result.message,
        ts: input.ts,
      },
    ];
  }

  // 第 05 讲：市价单逐档成交、限价单穿透部分成交；第 06 讲：不穿透的挂单估算排队位置后入簿；第 09 讲：触发单入簿
  // 触发单入簿等触发（第 09 讲），其它订单当场成交或挂单
  const events = ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(input.req.type)
    ? placeTriggerOrder(state, input, result.order)
    : executeOrder(state, input, result.order);
  // 成交之后跑风控扫描（04-backend-design.md 第 8 节"检测时机"）
  return [...events, ...riskScan(state, filledAccounts(events), input.ts)];
}

/** 这批事件里有成交的账户。 */
function filledAccounts(events: readonly EngineEvent[]): string[] {
  return events.flatMap((e) => (e.t === "fill" ? [e.fill.accountId] : []));
}

function assertNever(value: never): never {
  throw new Error(`未知的引擎输入类型：${String((value as { t?: unknown }).t)}`);
}
