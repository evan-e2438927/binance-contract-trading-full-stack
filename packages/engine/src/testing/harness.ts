import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import { createEngine } from "../create-engine";
import { availableBalance, initialMargin, unrealizedPnl } from "../formulas";
import type { Engine, EngineConfig, EngineEvent, EngineInput, EngineSnapshot } from "../types";
import { InvariantError, checkInvariants, checkRollback } from "./invariants";

export interface TestEngine {
  /** 被包裹的真实引擎。测试"不变式会不会被抓到"时，可以绕过脚手架直接调它。 */
  readonly engine: Engine;
  /** 从创建到现在的全部输出事件，按顺序。 */
  readonly events: readonly EngineEvent[];
  /**
   * 调用引擎，然后自动检查全部不变式和回滚自检。任何一条被破坏都会抛 InvariantError。
   * 从调用方看，效果等同于"apply + 宿主落库成功 + commit"。
   */
  apply(input: EngineInput): EngineEvent[];
  /** 该账户所有 balanceUpdate 的 delta 之和，相当于数据库里的 SUM(ledger_entries.amount)。 */
  ledgerSum(accountId: string): Fixed;
}

export function createTestEngine(config: EngineConfig): TestEngine {
  const engine = createEngine(config);
  const events: EngineEvent[] = [];
  const ledgerSums = new Map<string, Fixed>();
  // ③ 用：每个币对最后一次见到的标记价。EngineSnapshot 不含行情状态，所以这份记录
  // 只存在于测试脚手架里，旁路记录调用方喂给 apply() 的 markPrice 输入，不问引擎内部。
  const marks = new Map<string, Fixed>();
  // ⑨ 用：当前生效的分层表。setBrackets 输入会换表，跟着旁路记录，否则 ⑨ 会拿旧表判断
  const brackets = { ...config.brackets };

  return {
    engine,
    events,
    apply(input) {
      if (input.t === "markPrice") marks.set(input.symbol, input.markPrice);
      if (input.t === "setBrackets") {
        brackets[input.symbol] = [...input.brackets].sort((a, b) => (a.notionalCap < b.notionalCap ? -1 : a.notionalCap > b.notionalCap ? 1 : 0));
      }

      // 回滚自检：apply → 记下结果 → rollback → 必须回到 apply 之前 → 再把结果装回去。
      // 这样每一个测试里的每一次 apply 都顺带验证了 undo 日志没有漏记。
      // 三次深拷贝只在测试里付，生产宿主走的是 commit，没有这份开销。
      const before = engine.snapshot();
      const out = engine.apply(input);
      const after = engine.snapshot();
      engine.rollback();
      checkRollback(before, engine.snapshot());
      engine.restore(after);

      for (const event of out) {
        events.push(event);
        if (event.t !== "balanceUpdate") continue;

        const sum = (ledgerSums.get(event.accountId) ?? 0n) + event.delta;
        ledgerSums.set(event.accountId, sum);
        // 每条流水的 balanceAfter 也要自洽，不能只在最后对总账
        if (event.walletBalance !== sum) {
          throw new InvariantError(
            `不变式 ① 被破坏：balanceUpdate 声称余额 ${event.walletBalance}，但流水累加是 ${sum}`,
          );
        }
      }

      checkInvariants(engine.snapshot(), out, ledgerSums, marks, {
        availableScope: availableScopeOf(input, out, before, marks),
        brackets,
      });
      return out;
    },
    ledgerSum(accountId) {
      return ledgerSums.get(accountId) ?? 0n;
    },
  };
}

/**
 * 不变式 ③ 的检查范围（设计缺口 #19）：只有"会占用保证金的操作成功、而且操作之前可用余额非负"时，检查这个账户。
 * 标记价不利变动让可用余额变负是正常的（强平线在维持保证金，不在可用余额）；
 * 下单之前就已经是负的，平仓单成交后仍可能是负的，也不算下单的错。
 */
function availableScopeOf(
  input: EngineInput,
  out: readonly EngineEvent[],
  before: EngineSnapshot,
  marks: ReadonlyMap<string, Fixed>,
): ReadonlySet<string> {
  // 会占用保证金的操作：下单、调杠杆（调低时占用变多）、调逐仓保证金（追加时从可用余额里拿）
  const occupies = input.t === "placeOrder" || input.t === "setLeverage" || input.t === "adjustIsolatedMargin";
  if (!occupies || out.some((e) => e.t === "rejected")) return new Set();
  const account = before.accounts.find((a) => a.id === input.accountId);
  if (!account) return new Set();
  let crossUnrealizedPnlSum = 0n;
  let crossInitialMarginSum = 0n;
  let isolatedMarginSum = 0n;
  for (const p of before.positions) {
    if (p.accountId !== account.id) continue;
    if (p.marginMode === "ISOLATED") {
      isolatedMarginSum += p.isolatedMargin;
      continue;
    }
    const mark = marks.get(p.symbol);
    if (mark === undefined) return new Set();
    crossUnrealizedPnlSum += unrealizedPnl(p, mark);
    crossInitialMarginSum += initialMargin(p.qty, p.entryPrice, p.leverageNum);
  }
  const frozenMarginSum = before.orders.filter((o) => o.accountId === account.id).reduce((s, o) => s + o.frozenMargin, 0n);
  const available = availableBalance({
    walletBalance: account.walletBalance,
    crossUnrealizedPnlSum,
    crossInitialMarginSum,
    isolatedMarginSum,
    frozenMarginSum,
  });
  return available >= 0n ? new Set([account.id]) : new Set();
}
