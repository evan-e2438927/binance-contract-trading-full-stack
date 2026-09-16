import type { Fixed } from "@binance-contract-trading-full-stack/shared";
import { createEngine } from "../create-engine";
import type { Engine, EngineConfig, EngineEvent, EngineInput } from "../types";
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

  return {
    engine,
    events,
    apply(input) {
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

      checkInvariants(engine.snapshot(), out, ledgerSums);
      return out;
    },
    ledgerSum(accountId) {
      return ledgerSums.get(accountId) ?? 0n;
    },
  };
}
