import { positionKey, settingKey, writable, type EngineState } from "./state";
import type { Account, AccountSymbolSetting, Order, Position } from "./types";

/**
 * 一次 apply 的 undo 日志：每个被改动的键，记下它在本次 apply 之前的值。
 *
 * - 值为 undefined 表示"本次 apply 之前这个键不存在"，回滚时删掉它
 * - 同一个键在一次 apply 里只记第一次——回滚要回到 apply 之前，不是回到上一步
 *
 * 为什么不直接用 snapshot()：快照是 O(全体账户) 的深拷贝，而一次 apply 通常只碰几个账户。
 * 日志只记旧值的引用（账户类对象不许原地改，旧对象不会被污染），代价是 O(本次改动数)。
 * 见 02-architecture.md 第七节"回滚怎么做"。
 */
export interface Journal {
  accounts: Map<string, Readonly<Account> | undefined>;
  settings: Map<string, Readonly<AccountSymbolSetting> | undefined>;
  positions: Map<string, Readonly<Position> | undefined>;
  orders: Map<string, Readonly<Order> | undefined>;
}

type Slot = keyof Journal;

/** 开始记录一次 apply。上一次还没结算就再开，说明宿主漏了 commit / rollback。 */
export function beginJournal(state: EngineState): void {
  if (state.journal) {
    throw new Error("上一次 apply 还没有 commit() 或 rollback()，宿主必须先结算再喂下一个输入");
  }
  state.journal = { accounts: new Map(), settings: new Map(), positions: new Map(), orders: new Map() };
}

/** 宿主落库成功：丢弃日志，本次改动生效。 */
export function commitJournal(state: EngineState): void {
  requireJournal(state, "commit");
  state.journal = null;
}

/** 宿主落库失败：把本次 apply 改过的键恢复成旧值。行情类状态不在日志里，保持不动。 */
export function rollbackJournal(state: EngineState): void {
  const journal = requireJournal(state, "rollback");
  undo(writable(state.accounts), journal.accounts);
  undo(writable(state.settings), journal.settings);
  undo(writable(state.positions), journal.positions);
  undo(writable(state.orders), journal.orders);
  state.journal = null;
}

// ─────────────────────────────────────────────────────────────
// 修改账户类状态的唯一入口。EngineState 上这几个 Map 是只读的，
// 引擎代码想改账户、设置、仓位、订单，只能调下面这些函数。
//
// 存进去的对象会被 Object.freeze：日志里存的是旧对象的引用而不是拷贝，
// 编译期 Readonly 已经拦住了原地改，冻结再在运行时兜一层——谁绕过类型原地改，当场抛 TypeError。
// ─────────────────────────────────────────────────────────────

export function putAccount(state: EngineState, account: Account): void {
  record(state, "accounts", account.id);
  writable(state.accounts).set(account.id, Object.freeze(account));
}

export function putSetting(state: EngineState, setting: AccountSymbolSetting): void {
  const key = settingKey(setting.accountId, setting.symbol);
  record(state, "settings", key);
  writable(state.settings).set(key, Object.freeze(setting));
}

export function putPosition(state: EngineState, position: Position): void {
  const key = positionKey(position.accountId, position.symbol, position.positionSide);
  record(state, "positions", key);
  writable(state.positions).set(key, Object.freeze(position));
}

export function removePosition(state: EngineState, key: string): void {
  record(state, "positions", key);
  writable(state.positions).delete(key);
}

export function putOrder(state: EngineState, order: Order): void {
  record(state, "orders", order.id);
  writable(state.orders).set(order.id, Object.freeze(order));
}

/** 订单进入终态、发出 orderUpdate 之后调用：内存里只留未完成订单。 */
export function removeOrder(state: EngineState, orderId: string): void {
  record(state, "orders", orderId);
  writable(state.orders).delete(orderId);
}

function record(state: EngineState, slot: Slot, key: string): void {
  // 没开日志（单元测试直接调 applyInput）时不记录
  const log = state.journal?.[slot] as Map<string, unknown> | undefined;
  if (log && !log.has(key)) {
    log.set(key, state[slot].get(key));
  }
}

function undo<V>(map: Map<string, V>, log: Map<string, V | undefined>): void {
  for (const [key, before] of log) {
    if (before === undefined) {
      map.delete(key);
    } else {
      map.set(key, before);
    }
  }
}

function requireJournal(state: EngineState, action: string): Journal {
  if (!state.journal) {
    throw new Error(`没有待结算的 apply，${action}() 调用多余，宿主流程有 bug`);
  }
  return state.journal;
}
