import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import type { EngineEvent, EngineSnapshot } from "../types";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

function fail(rule: string, detail: string): never {
  throw new InvariantError(`不变式 ${rule} 被破坏：${detail}`);
}

/**
 * 06-testing-design.md 第 4 节的引擎层不变式，每次 apply 之后自动跑。
 *
 * ③ 可用余额非负、⑥ 冻结保证金总额，要等模块 03 写出公式之后才能加进来。
 * ⑧ 是我们自己加的：内存里只能有未完成订单。
 */
export function checkInvariants(
  snapshot: EngineSnapshot,
  events: readonly EngineEvent[],
  ledgerSums: ReadonlyMap<string, Fixed>,
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
