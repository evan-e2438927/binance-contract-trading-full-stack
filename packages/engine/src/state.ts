import type {
  Fixed,
  PositionSide,
} from "@binance-contract-trading-full-stack/shared";
import type {
  Account,
  AccountSymbolSetting,
  EngineConfig,
  EngineSnapshot,
  LeverageBracket,
  Level,
  Order,
  Position,
  SymbolSpec,
} from "./types";
import type { Journal } from "./journal";

export interface BookState {
  bids: Level[]; // 价格降序，bids[0] 是买一
  asks: Level[]; // 价格升序，asks[0] 是卖一
  ts: number;
}

export interface MarkState {
  markPrice: Fixed;
  fundingRate: Fixed;
  nextFundingTs: number;
  ts: number;
}

/**
 * 引擎的全部内存状态。只在引擎包内部流通，对外只暴露 EngineSnapshot。
 * 用 Map 而不是数组：撮合时要按 id / 仓位键高频查找。
 *
 * 账户类状态对外是只读的（ReadonlyMap + Readonly 值），编译器会拦住两种写法：
 * - state.accounts.set(...)            → 必须改用 journal.ts 的 putAccount 等函数
 * - state.accounts.get(id)!.walletBalance = x → 对象不能原地改，要构造新对象再 put
 * 这样每一处修改都一定经过 undo 日志，回滚才不会漏。
 */
export interface EngineState {
  readonly config: EngineConfig;
  readonly symbols: Map<string, SymbolSpec>;
  readonly brackets: Map<string, LeverageBracket[]>; // 按 notionalCap 升序

  // —— 账户类状态：进快照、可回滚 ——
  readonly accounts: ReadonlyMap<string, Readonly<Account>>;
  readonly settings: ReadonlyMap<string, Readonly<AccountSymbolSetting>>; // key: settingKey()
  readonly positions: ReadonlyMap<string, Readonly<Position>>; // key: positionKey()
  readonly orders: ReadonlyMap<string, Readonly<Order>>; // 只放未完成订单

  /** 本次 apply 的 undo 日志；null 表示没有待结算的 apply。见 journal.ts。 */
  journal: Journal | null;

  // —— 行情类状态：不进快照 ——
  readonly books: Map<string, BookState>;
  readonly marks: Map<string, MarkState>;
  readonly lastPrices: Map<string, Fixed>;
}

export function settingKey(accountId: string, symbol: string): string {
  return `${accountId}|${symbol}`;
}

export function positionKey(
  accountId: string,
  symbol: string,
  positionSide: PositionSide,
): string {
  return `${accountId}|${symbol}|${positionSide}`;
}

export function createState(config: EngineConfig): EngineState {
  const symbols = new Map<string, SymbolSpec>();
  const brackets = new Map<string, LeverageBracket[]>();

  for (const spec of config.symbols) {
    const list = config.brackets[spec.symbol];
    // 没有分层表就算不出维持保证金，这是宿主接线的错，启动时就该炸，而不是等第一笔单
    if (!list || list.length === 0) {
      throw new Error(
        `币对 ${spec.symbol} 没有杠杆分层表，引擎无法计算维持保证金`,
      );
    }
    symbols.set(spec.symbol, spec);
    brackets.set(
      spec.symbol,
      [...list].sort((a, b) =>
        a.notionalCap < b.notionalCap
          ? -1
          : a.notionalCap > b.notionalCap
            ? 1
            : 0,
      ),
    );
  }

  return {
    config,
    symbols,
    brackets,
    accounts: new Map(),
    settings: new Map(),
    positions: new Map(),
    orders: new Map(),
    books: new Map(),
    marks: new Map(),
    lastPrices: new Map(),
    journal: null,
  };
}

export function requireSymbol(state: EngineState, symbol: string): SymbolSpec {
  const spec = state.symbols.get(symbol);
  if (!spec) {
    throw new Error(`未知币对 ${symbol}：引擎配置里没有它的规格`);
  }
  return spec;
}

/**
 * 拿到账户类 Map 的可写版本。只给本文件的 loadSnapshot 和 journal.ts 用——
 * 其它地方要改账户类状态，一律走 journal.ts 的 put / remove。
 */
export function writable<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  return map as Map<string, V>;
}

/** 深拷贝导出。structuredClone 原生支持 bigint。 */
export function toSnapshot(state: EngineState): EngineSnapshot {
  return structuredClone({
    accounts: [...state.accounts.values()],
    settings: [...state.settings.values()],
    positions: [...state.positions.values()],
    orders: [...state.orders.values()],
  });
}

/** 用快照整体替换账户类状态。行情类状态（books/marks/lastPrices）保持不动。 */
export function loadSnapshot(
  state: EngineState,
  snapshot: EngineSnapshot,
): void {
  // 整体替换会让 undo 日志里记的旧值失去意义，必须先把上一次 apply 结算掉
  if (state.journal) {
    throw new Error(
      "还有未结算的 apply（没调 commit() 或 rollback()），不能 restore",
    );
  }

  const copy = structuredClone(snapshot);

  // 先全部校验，再动状态——校验到一半抛错时不能留下半新半旧的状态
  for (const s of copy.settings) requireSymbol(state, s.symbol);
  for (const p of copy.positions) requireSymbol(state, p.symbol);
  for (const o of copy.orders) requireSymbol(state, o.symbol);

  const accounts = writable(state.accounts);
  const settings = writable(state.settings);
  const positions = writable(state.positions);
  const orders = writable(state.orders);

  accounts.clear();
  settings.clear();
  positions.clear();
  orders.clear();

  // 冻结：和 journal.ts 的 put 一致，账户类对象进了引擎就不许原地改
  for (const a of copy.accounts) accounts.set(a.id, Object.freeze(a));
  for (const s of copy.settings)
    settings.set(settingKey(s.accountId, s.symbol), Object.freeze(s));
  for (const p of copy.positions)
    positions.set(
      positionKey(p.accountId, p.symbol, p.positionSide),
      Object.freeze(p),
    );
  for (const o of copy.orders) orders.set(o.id, Object.freeze(o));
}
