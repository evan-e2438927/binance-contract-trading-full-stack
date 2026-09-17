import { putAccount } from "./journal";
import { requireSymbol, type EngineState } from "./state";
import { executeOrder } from "./execute-order";
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

    // 下面这些在后续模块里逐个实现。没实现就明确地炸，而不是悄悄返回 []——
    // 悄悄什么都不做，比报错更难发现。
    case "cancelOrder":
    case "settleFunding":
    case "setLeverage":
    case "setMarginMode":
    case "setPositionMode":
    case "adjustIsolatedMargin":
    case "resetAccount":
      throw new Error(`引擎还没有实现输入 "${input.t}"，按 docs/tutorial/README.md 的模块顺序补齐`);

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
  // 模块 06：盘口更新后要夹逼所有挂单的 queueAhead
  return [];
}

function applyMarkPrice(state: EngineState, input: InputOf<"markPrice">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.marks.set(input.symbol, {
    markPrice: input.markPrice,
    fundingRate: input.fundingRate,
    nextFundingTs: input.nextFundingTs,
    ts: input.ts,
  });
  // 模块 07/09：标记价更新后要检查触发单、跑风控扫描
  return [];
}

function applyTrade(state: EngineState, input: InputOf<"trade">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  state.lastPrices.set(input.symbol, input.price);
  // 模块 06：用成交流消耗挂单的排队位置
  return [];
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

  // 第 05 讲：市价单逐档成交、限价单穿透部分成交；第 06 讲：不穿透的挂单排队；第 09 讲：触发单入簿
  return executeOrder(state, input, result.order);
}

function assertNever(value: never): never {
  throw new Error(`未知的引擎输入类型：${String((value as { t?: unknown }).t)}`);
}
