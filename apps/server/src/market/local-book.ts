import type { Level } from "@binance-contract-trading-full-stack/engine";
import type { Fixed } from "@binance-contract-trading-full-stack/shared";

/**
 * 本地完整盘口（S01）。
 *
 * 原来订的是 `@depth20@100ms`——每 100ms 一份前 20 档快照，不用管序列号，断线重连自动对齐，
 * 但只有 20 档：精度聚合到 100 / 1000 时只剩一两行，「前方排队」超出 20 档只能估，
 * 市价单也容易触发"吃穿深度拒单"（失真点 #4）。
 *
 * 现在改成币安文档《How to manage a local order book correctly》的做法（2026-09-20 核对）：
 * 1. 先开着增量流 `<symbol>@depth`（250ms），把推送缓冲起来
 * 2. 拉一份 REST 快照（limit=1000），记下 `lastUpdateId`
 * 3. 丢掉 `u < lastUpdateId` 的增量
 * 4. 第一条要处理的增量必须满足 `U <= lastUpdateId <= u`
 * 5. 之后每条的 `pu` 必须等于上一条的 `u`，对不上就从第 2 步重来
 * 6. 每条增量里的数量是**绝对值**，不是增减；数量为 0 表示删掉这一档
 *
 * 这个文件只管"维护一份 Map 并按规则判断序列号"，不碰网络、不碰引擎：拉快照、重试都在 market-feed 里。
 */

export interface DepthDiff {
  symbol: string;
  /** U：这条推送里的第一个更新 id */
  firstUpdateId: number;
  /** u：最后一个更新 id */
  finalUpdateId: number;
  /** pu：上一条推送的 u，用来判断有没有掉包 */
  prevFinalUpdateId: number;
  bids: Level[];
  asks: Level[];
  ts: number;
}

export interface DepthSnapshot {
  lastUpdateId: number;
  bids: Level[];
  asks: Level[];
}

export type LocalBookResult =
  /** 盘口更新好了，这是给引擎的新快照（按档位截断到 levels 档） */
  | { t: "book"; bids: Level[]; asks: Level[]; ts: number }
  /** 还没有快照，这条增量先缓冲着 */
  | { t: "buffered" }
  /** 序列号对不上，要重新拉快照 */
  | { t: "resync"; reason: string }
  /** 整条都比快照旧，按币安文档第 4 条丢掉。盘口是好的，什么都不用做 */
  | { t: "skipped" };

export interface LocalBook {
  applyDiff(diff: DepthDiff): LocalBookResult;
  /** 快照到了：丢掉过期的增量、应用缓冲区，成功后转入 live */
  applySnapshot(snapshot: DepthSnapshot, ts: number): LocalBookResult;
  /** 断线、解析失败、要重来时调用：清空状态，回到"等快照"，之后的增量重新缓冲 */
  reset(): void;
  readonly live: boolean;
}

/** 缓冲区上限：100ms 一条，正常几条就等到快照了；堆到这个数说明快照一直没来，丢掉旧的免得无限涨 */
const MAX_BUFFERED = 200;

export function createLocalBook(options: { levels: number }): LocalBook {
  const bids = new Map<Fixed, Fixed>();
  const asks = new Map<Fixed, Fixed>();
  let lastUpdateId = -1;
  let buffer: DepthDiff[] = [];
  let live = false;
  /**
   * 快照已装上、但还没应用过第一条增量。
   *
   * ⚠️ 2026-09-20：只在缓冲区里挑「跨过 lastUpdateId 的第一条」是不够的。REST 快照经常比 WS 流**更新**
   * （覆盖那一段的推送还在路上），这时缓冲区里一条 u >= lastUpdateId 的都没有，下一条推送的
   * pu 必然小于 lastUpdateId——按 pu 规则判就是「断档」，于是白白重拉一次快照（权重 10）。
   * 19 个币对各来这么一下，就是把自己往 418 上送。所以快照之后的**第一条**要按第 5 条的跨越规则判，
   * 不按第 6 条的 pu 规则。
   */
  let awaitingFirst = false;

  function put(side: Map<Fixed, Fixed>, levels: Level[]): void {
    for (const level of levels) {
      // 数量为 0 = 这一档没了（币安文档第 8 条）
      if (level.qty === 0n) side.delete(level.price);
      else side.set(level.price, level.qty);
    }
  }

  function apply(diff: DepthDiff): void {
    put(bids, diff.bids);
    put(asks, diff.asks);
    lastUpdateId = diff.finalUpdateId;
  }

  /** 取前 N 档：买盘价格从高到低、卖盘从低到高（引擎假设 bids[0] 是买一） */
  function top(side: Map<Fixed, Fixed>, direction: "bid" | "ask"): Level[] {
    const levels: Level[] = [];
    for (const [price, qty] of side) {
      if (qty > 0n) levels.push({ price, qty });
    }
    levels.sort((a, b) => (direction === "bid" ? (b.price > a.price ? 1 : -1) : a.price > b.price ? 1 : -1));
    return levels.slice(0, options.levels);
  }

  function snapshotOf(ts: number): LocalBookResult {
    return { t: "book", bids: top(bids, "bid"), asks: top(asks, "ask"), ts };
  }

  function clear(): void {
    bids.clear();
    asks.clear();
    lastUpdateId = -1;
    buffer = [];
    live = false;
    awaitingFirst = false;
  }

  return {
    get live() {
      return live;
    },

    reset: clear,

    applyDiff(diff) {
      if (!live) {
        buffer.push(diff);
        if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
        return { t: "buffered" };
      }
      if (awaitingFirst) {
        // 第 4 条：整条都比快照旧，丢掉。盘口没问题，别去重拉快照
        if (diff.finalUpdateId < lastUpdateId) return { t: "skipped" };
        // 快照之后的第一条，两种接法都算数：
        // - 跨过快照点（第 5 条：U <= lastUpdateId <= u）——快照落在这条推送中间
        // - 紧挨着快照点（pu == lastUpdateId）——快照正好落在上一条推送的 u 上
        // 两个都不满足，中间那段才是真的看不到了。
        if (diff.firstUpdateId > lastUpdateId && diff.prevFinalUpdateId !== lastUpdateId) {
          const local = lastUpdateId;
          clear();
          buffer.push(diff);
          return { t: "resync", reason: `快照之后第一条就断了：U=${diff.firstUpdateId}，pu=${diff.prevFinalUpdateId}，快照 lastUpdateId=${local}` };
        }
        apply(diff);
        awaitingFirst = false;
        return snapshotOf(diff.ts);
      }
      // 第 6 条：每条的 pu 必须接上上一条的 u，对不上说明中间掉了包
      if (diff.prevFinalUpdateId !== lastUpdateId) {
        // ⚠️ reason 里的 lastUpdateId 要在 clear() 之前取：clear() 会把它抹成 -1，
        // 日志里永远印 -1 的话，这行日志就失去了排查价值
        const local = lastUpdateId;
        clear();
        buffer.push(diff);
        return { t: "resync", reason: `序列号断了：pu=${diff.prevFinalUpdateId}，本地 lastUpdateId=${local}` };
      }
      apply(diff);
      return snapshotOf(diff.ts);
    },

    applySnapshot(snapshot, ts) {
      bids.clear();
      asks.clear();
      put(bids, snapshot.bids);
      put(asks, snapshot.asks);
      lastUpdateId = snapshot.lastUpdateId;

      // 第 4 条：丢掉 u < lastUpdateId 的；第 5 条：第一条要处理的必须 U <= lastUpdateId <= u
      const pending = buffer.filter((diff) => diff.finalUpdateId >= snapshot.lastUpdateId);
      buffer = [];
      const first = pending[0];
      if (first && !(first.firstUpdateId <= snapshot.lastUpdateId && first.finalUpdateId >= snapshot.lastUpdateId)) {
        // 快照比缓冲区还旧（或者中间断了），这份快照用不了，等下一份
        clear();
        return { t: "resync", reason: `快照和增量对不上：快照 ${snapshot.lastUpdateId}，第一条增量 U=${first.firstUpdateId}` };
      }

      let previous = snapshot.lastUpdateId;
      for (const [index, diff] of pending.entries()) {
        if (index > 0 && diff.prevFinalUpdateId !== previous) {
          clear();
          return { t: "resync", reason: `缓冲区里的增量不连续：pu=${diff.prevFinalUpdateId}，上一条 u=${previous}` };
        }
        apply(diff);
        previous = diff.finalUpdateId;
      }

      live = true;
      // 缓冲区里一条都接不上：快照比流还新，第一条增量按跨越规则判（见 awaitingFirst）
      awaitingFirst = pending.length === 0;
      return snapshotOf(ts);
    },
  };
}
