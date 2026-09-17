import { putAccount } from "./journal";
import { requireSymbol, type EngineState } from "./state";
import { executeOrder } from "./execute-order";
import { cancelOrder, matchTrade, reconcileBook } from "./resting-orders";
import { accountsHolding, riskScan } from "./risk";
import { adjustIsolatedMargin, resetAccount, setLeverage, setMarginMode, setPositionMode } from "./account-ops";
import { settleFunding } from "./funding";
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
  // 5.2 节：① 更新标记价 ② 未实现盈亏是现算的，不用存 ③ 触发单（第 09 讲）④ 风控扫描：这个币对上有仓位的账户
  return riskScan(state, accountsHolding(state, input.symbol), input.ts);
}

function applyTrade(state: EngineState, input: InputOf<"trade">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  // 5.2 节：① 更新最新价 ② 消耗挂单队列、轮到的按挂单价成交并落账 ④ 有成交的账户跑风控扫描
  state.lastPrices.set(input.symbol, input.price);
  const events = matchTrade(state, input);
  return [...events, ...riskScan(state, filledAccounts(events), input.ts)];
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
  const events = executeOrder(state, input, result.order);
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
