import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import { availableBalance, initialMargin, notional, unrealizedPnl } from "../formulas";
import { findBracket, maintMargin } from "../liquidation";
import type { EngineEvent, EngineSnapshot, LeverageBracket } from "../types";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

function fail(rule: string, detail: string): never {
  throw new InvariantError(`不变式 ${rule} 被破坏：${detail}`);
}

export interface InvariantOptions {
  /**
   * ③ 只检查这些账户；不传 = 检查全部账户（单元测试直接构造快照时用）。
   * 设计缺口 #19（第 07 讲定）："可用余额非负"不是任何时刻都成立——全仓仓位浮亏、标记价不利变动，
   * 可用余额在强平之前就会变负，币安也一样（此时开不了新仓，但不会被强平）。它真正要守的是：
   * **一次成功的下单不会把可用余额从非负变成负数**。测试脚手架据此只在那种 apply 之后对下单账户检查。
   */
  availableScope?: ReadonlySet<string>;
  /** ⑨ 要用的分层表（symbol → 按 notionalCap 升序）。不传就不检查 ⑨。 */
  brackets?: Readonly<Record<string, readonly LeverageBracket[]>>;
}

/**
 * 06-testing-design.md 第 4 节的引擎层不变式，每次 apply 之后自动跑。
 *
 * ⑧ ⑨ 是我们自己加的：⑧ 内存里只能有未完成订单；⑨ 风控扫描之后不能留下该强平没强平的仓位（第 07 讲）。
 */
export function checkInvariants(
  snapshot: EngineSnapshot,
  events: readonly EngineEvent[],
  ledgerSums: ReadonlyMap<string, Fixed>,
  /**
   * 每个币对当前已知的标记价，用来算全仓仓位的未实现盈亏（③ 需要）。
   * 来自 harness.ts 里对 markPrice 输入的旁路记录，EngineSnapshot 本身不含行情状态
   * （02-architecture.md 第七节："行情不进快照"）。第 03 讲还没有任何代码会创建仓位/挂单，
   * 这两条不变式目前恒为"平凡成立"，是为第 04 讲之后打好的地基——一旦有仓位/挂单，
   * 它们会自动开始起作用，不需要再回来接线。
   */
  marks: ReadonlyMap<string, Fixed>,
  options: InvariantOptions = {},
): void {
  // ① 钱包余额 == 该账户所有 balanceUpdate 的 delta 之和
  //    引擎内存里不存流水（02-architecture.md 第七节），所以"流水之和"由测试脚手架从事件里累加
  for (const acc of snapshot.accounts) {
    const sum = ledgerSums.get(acc.id) ?? 0n;
    if (acc.walletBalance !== sum) {
      fail("①", `账户 ${acc.id} walletBalance=${acc.walletBalance}，但流水之和=${sum}`);
    }
  }

  // ② 仓位数量非负
  for (const p of snapshot.positions) {
    if (p.qty < 0n) {
      fail("②", `仓位 ${p.accountId}/${p.symbol}/${p.positionSide} qty=${p.qty}`);
    }
  }

  // 终态订单已经从内存移除，只能在本次事件里看到它们，所以两处合起来检查
  const updatedOrders = events.flatMap((e) => (e.t === "orderUpdate" ? [e.order] : []));
  for (const o of [...snapshot.orders, ...updatedOrders]) {
    // ⑤ 成交量不超过委托量
    if (o.executedQty > o.qty) {
      fail("⑤", `订单 ${o.id} executedQty=${o.executedQty} > qty=${o.qty}`);
    }
    // ④ FILLED 的订单必须全部成交
    if (o.status === "FILLED" && o.executedQty !== o.qty) {
      fail("④", `订单 ${o.id} 状态 FILLED 但 executedQty=${o.executedQty} ≠ qty=${o.qty}`);
    }
    // ⑦ 排队位置非负
    if (o.queueAhead < 0n) {
      fail("⑦", `订单 ${o.id} queueAhead=${o.queueAhead}`);
    }
  }

  // ⑧ 内存里只能有未完成订单
  for (const o of snapshot.orders) {
    if (o.status !== "NEW" && o.status !== "PARTIALLY_FILLED") {
      fail("⑧", `订单 ${o.id} 状态是 ${o.status}，终态订单不应该留在引擎内存里`);
    }
  }

  // ③ 可用余额非负
  const positionsByAccount = new Map<string, typeof snapshot.positions>();
  for (const p of snapshot.positions) {
    positionsByAccount.set(p.accountId, [...(positionsByAccount.get(p.accountId) ?? []), p]);
  }
  const ordersByAccount = new Map<string, typeof snapshot.orders>();
  for (const o of snapshot.orders) {
    ordersByAccount.set(o.accountId, [...(ordersByAccount.get(o.accountId) ?? []), o]);
  }

  for (const acc of snapshot.accounts) {
    if (options.availableScope && !options.availableScope.has(acc.id)) continue;
    let crossUnrealizedPnlSum = 0n;
    let crossInitialMarginSum = 0n;
    let isolatedMarginSum = 0n;
    let markPriceMissing = false;

    for (const p of positionsByAccount.get(acc.id) ?? []) {
      if (p.marginMode === "ISOLATED") {
        isolatedMarginSum += p.isolatedMargin;
        continue;
      }
      const mark = marks.get(p.symbol);
      if (mark === undefined) {
        // 全仓仓位的未实现盈亏离不开标记价：还没收到过这个币对的 markPrice 输入就没法算，
        // 跳过而不是报错——"不知道"和"算出来是负的"是两回事，不能把前者当成后者处理。
        markPriceMissing = true;
        continue;
      }
      crossUnrealizedPnlSum += unrealizedPnl(p, mark);
      crossInitialMarginSum += initialMargin(p.qty, p.entryPrice, p.leverageNum);
    }
    if (markPriceMissing) continue;

    const frozenMarginSum = (ordersByAccount.get(acc.id) ?? []).reduce(
      (sum, o) => sum + o.frozenMargin,
      0n,
    );
    const available = availableBalance({
      walletBalance: acc.walletBalance,
      crossUnrealizedPnlSum,
      crossInitialMarginSum,
      isolatedMarginSum,
      frozenMarginSum,
    });
    if (available < 0n) {
      fail("③", `账户 ${acc.id} 可用余额为负：${available}`);
    }
  }

  // ⑨ 不能留下该强平没强平的仓位：逐仓 仓位权益 > 维持保证金；全仓 全仓权益 > 全仓维持保证金之和
  if (options.brackets) {
    const brackets = options.brackets;
    const mmOf = (p: (typeof snapshot.positions)[number], mark: Fixed) => {
      const value = notional(p.qty, mark);
      return maintMargin(value, findBracket(brackets[p.symbol]!, value));
    };
    for (const acc of snapshot.accounts) {
      const own = positionsByAccount.get(acc.id) ?? [];
      let isolatedMarginSum = 0n;
      let crossEquity = 0n;
      let crossMaintMargin = 0n;
      let crossCount = 0;
      let crossMarkMissing = false;
      for (const p of own) {
        const mark = marks.get(p.symbol);
        if (p.marginMode === "ISOLATED") {
          isolatedMarginSum += p.isolatedMargin;
          if (mark === undefined) continue;
          const equity = p.isolatedMargin + unrealizedPnl(p, mark);
          const mm = mmOf(p, mark);
          if (equity <= mm) {
            fail("⑨", `逐仓仓位 ${acc.id}/${p.symbol}/${p.positionSide} 权益 ${equity} ≤ 维持保证金 ${mm}，应该已经被强平`);
          }
          continue;
        }
        crossCount++;
        if (mark === undefined) {
          crossMarkMissing = true;
          continue;
        }
        crossEquity += unrealizedPnl(p, mark);
        crossMaintMargin += mmOf(p, mark);
      }
      if (crossCount === 0 || crossMarkMissing) continue;
      crossEquity += acc.walletBalance - isolatedMarginSum;
      if (crossEquity <= crossMaintMargin) {
        fail("⑨", `账户 ${acc.id} 全仓权益 ${crossEquity} ≤ 全仓维持保证金 ${crossMaintMargin}，应该已经被强平`);
      }
    }
  }

  // ⑥ 只减仓 / 全部平仓单永远不冻结保证金——它们只会释放保证金，不会占用新的（见 formulas.ts frozenMargin）
  for (const o of snapshot.orders) {
    if ((o.reduceOnly || o.closePosition) && o.frozenMargin !== 0n) {
      fail("⑥", `订单 ${o.id} reduceOnly/closePosition=true 但 frozenMargin=${o.frozenMargin} ≠ 0`);
    }
  }
}

/**
 * 回滚自检：apply 之后 rollback，账户类状态必须和 apply 之前一模一样。
 * 抓的是"某处修改绕过了 journal.ts 的 put / remove"——那样的改动回滚时会被漏掉。
 *
 * 比较时不看顺序：回滚会把被删除的键重新放回 Map，插入顺序可能变，但内容必须一致。
 */
export function checkRollback(before: EngineSnapshot, afterRollback: EngineSnapshot): void {
  for (const slot of ["accounts", "settings", "positions", "orders"] as const) {
    const expected = canonical(before[slot]);
    const actual = canonical(afterRollback[slot]);
    if (expected !== actual) {
      throw new InvariantError(
        `回滚不完整：${slot} 在 rollback 之后和 apply 之前不一致，说明有修改没经过 journal.ts\n` +
          `  apply 之前：${expected}\n  rollback 后：${actual}`,
      );
    }
  }
}

function canonical(items: readonly object[]): string {
  return items.map(stableStringify).sort().join("\n");
}

/** 键排序后的 JSON，bigint 写成 123n。JSON.stringify 不认 bigint，而且键顺序不稳定。 */
function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${fields.join(",")}}`;
}
