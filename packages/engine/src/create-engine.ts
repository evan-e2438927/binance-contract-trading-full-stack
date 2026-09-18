import { applyInput } from "./apply";
import { beginJournal, commitJournal, rollbackJournal } from "./journal";
import { createState, loadSnapshot, toSnapshot } from "./state";
import type { Engine, EngineConfig, EngineSnapshot } from "./types";
import { accountView, allAccountViews, marketView, openOrders, positionViews } from "./views";

export function createEngine(config: EngineConfig, initial?: EngineSnapshot): Engine {
  const state = createState(config);
  if (initial) {
    loadSnapshot(state, initial);
  }

  return {
    apply(input) {
      beginJournal(state);
      try {
        return applyInput(state, input);
      } catch (error) {
        // 程序错误可能发生在改了一半的时候：先撤掉本次改动，再把错误抛给宿主。
        // 这样一次 apply 要么完整生效，要么什么都没发生，不会留下半新半旧的状态。
        rollbackJournal(state);
        throw error;
      }
    },
    commit: () => commitJournal(state),
    rollback: () => rollbackJournal(state),
    snapshot: () => toSnapshot(state),
    restore: (snapshot) => loadSnapshot(state, snapshot),
    accountView: (accountId) => accountView(state, accountId),
    positionViews: (accountId) => positionViews(state, accountId),
    openOrders: (accountId) => openOrders(state, accountId),
    allAccountViews: () => allAccountViews(state),
    marketView: (symbol) => marketView(state, symbol),
  };
}
