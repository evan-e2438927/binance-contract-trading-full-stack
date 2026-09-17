import type { Engine, EngineEvent, EngineInput } from "@binance-contract-trading-full-stack/engine";

/**
 * 引擎宿主：把纯引擎接到真实世界（04-backend-design.md 第 10 节）。
 *
 * 一句话：**所有输入排成一队，一个一个 apply → 落库 → commit / rollback**。
 *
 * - 串行：引擎要求每次 apply 之后恰好一次 commit 或 rollback 才能 apply 下一个（第 02 讲）。
 *   落库是异步的，并发调用就会撞上"上一次还没结算"。队列把"异步落库"和"同步引擎"接起来
 * - 没有事件的输入（绝大多数盘口 / 行情成交 / 标记价推送）直接 commit，不碰数据库
 * - 落库失败：rollback，内存回到 apply 之前，和数据库一致；错误抛给调用方（下单接口会返回失败）
 * - 引擎抛程序错误：引擎已经自动撤销（第 02 讲），宿主只记日志、抛给调用方，不再调 rollback
 *
 * 行情断线时怎么办（缺口 #16 的宿主一半，失真点 #7）：
 * - 盘口：照常喂（不产生成交，只更新快照和排队位置，而且是恢复就绪的前提）
 * - 行情成交、标记价：这个币对没就绪就**丢掉**——没有可信行情就不撮合、不强平，恢复后也不补算
 * - 下单：这个币对没就绪就直接拒 MARKET_NOT_READY，不进引擎
 * - 资金费结算：没就绪就跳过并记日志（结算用的费率和标记价不可信）
 * - 撤单、调杠杆、账户重置等：照常处理（币安断线时撤单也应该能撤）
 */

type MarketInput = Extract<EngineInput, { t: "book" | "trade" | "markPrice" }>;

export interface EngineHostOptions {
  engine: Engine;
  /** 一次 apply 的全部事件写进数据库，一个事务。抛错 = 没写进去 */
  persist: (events: EngineEvent[]) => Promise<void>;
  /** 这个币对的行情现在能不能信（market-feed.ts 的 symbolReady） */
  isSymbolReady: (symbol: string) => boolean;
  /** commit 之后通知：第 14 讲 WebSocket 推送、持仓模式缓存都挂在这里 */
  onCommitted?: (input: EngineInput, events: readonly EngineEvent[]) => void;
  logger?: Pick<Console, "log" | "error">;
}

export interface EngineHost {
  /** 接口类输入（下单、撤单、调设置、结算……）：排队处理，commit 之后返回事件；落库失败或引擎报错时 reject */
  submit(input: EngineInput): Promise<EngineEvent[]>;
  /** 行情推送：排队处理，不等结果，出错只记日志。同一币对还没处理的旧盘口会被新盘口替换掉 */
  feedMarket(input: MarketInput): void;
  /**
   * 只读查询（第 13 讲 REST）：排进同一个队列，轮到时同步读引擎。
   * 不能在队列外直接读：上一个输入可能已经 apply、正在 await 落库，这时读到的是还没落库、可能被回滚的状态。
   */
  read<T>(fn: (engine: Engine) => T): Promise<T>;
  /** 等队列清空，测试和优雅退出用 */
  idle(): Promise<void>;
}

type Task =
  | { kind: "input"; input: EngineInput; resolve?: (events: EngineEvent[]) => void; reject?: (error: unknown) => void }
  | { kind: "read"; run: () => void };

export function createEngineHost(options: EngineHostOptions): EngineHost {
  const { engine, persist, isSymbolReady } = options;
  const logger = options.logger ?? console;
  const queue: Task[] = [];
  /** 还在队列里没处理的盘口任务：新盘口到了直接替换 input，不再排一个新任务（盘口是快照，只有最新的有用） */
  const pendingBooks = new Map<string, Extract<Task, { kind: "input" }>>();
  let running: Promise<void> | null = null;

  function enqueue(task: Task): void {
    queue.push(task);
    if (!running) running = drain();
  }

  /**
   * 把队列处理到空。"队列空了"的判断和 running = null 之间不能有 await：
   * 否则最后一个任务 resolve 之后、drain 真正退出之前入队的任务，会看到 running 还在、不启动新的 drain，
   * 也没人处理它（写测试时真的踩到了：标记价推送卡在队列里没进引擎）。
   */
  async function drain(): Promise<void> {
    // 先让出一次：保证 enqueue 里 `running = drain()` 的赋值发生在 drain 结束之前。
    // 只读任务没有 await，如果不让出，drain 会同步跑完、先把 running 置 null，
    // 随后赋值又把它设成一个已完成的 Promise——之后再入队的任务永远没人处理（第 13 讲加 read 时踩到）
    await Promise.resolve();
    for (;;) {
      const task = queue.shift();
      if (!task) {
        running = null;
        return;
      }
      if (task.kind === "read") {
        task.run();
        continue;
      }
      if (task.input.t === "book") pendingBooks.delete(task.input.symbol);
      try {
        const events = await process(task.input);
        task.resolve?.(events);
      } catch (error) {
        if (task.reject) task.reject(error);
        else logger.error(`[engine-host] 处理 ${task.input.t} 失败`, error);
      }
    }
  }

  async function process(input: EngineInput): Promise<EngineEvent[]> {
    const gated = gate(input);
    if (gated) return gated;

    const events = engine.apply(input); // 抛错时引擎已自动撤销
    if (events.length === 0) {
      engine.commit();
      return events;
    }
    try {
      await persist(events);
    } catch (error) {
      engine.rollback();
      throw error;
    }
    engine.commit();
    try {
      options.onCommitted?.(input, events);
    } catch (error) {
      // 已经 commit 了：通知出错不能让调用方以为没成功
      logger.error(`[engine-host] onCommitted 回调出错（${input.t}，已落库）`, error);
    }
    return events;
  }

  /** 行情没就绪时的处理。返回 null = 照常进引擎 */
  function gate(input: EngineInput): EngineEvent[] | null {
    switch (input.t) {
      case "trade":
      case "markPrice":
        return isSymbolReady(input.symbol) ? null : [];
      case "settleFunding":
        if (isSymbolReady(input.symbol)) return null;
        logger.error(`[engine-host] ${input.symbol} 行情未就绪，跳过 ${new Date(input.ts).toISOString()} 的资金费结算`);
        return [];
      case "placeOrder":
        if (isSymbolReady(input.req.symbol)) return null;
        return [
          {
            t: "rejected",
            accountId: input.accountId,
            input: "placeOrder",
            clientOrderId: input.req.clientOrderId,
            orderId: input.orderId,
            code: "MARKET_NOT_READY",
            message: `${input.req.symbol} 行情未就绪或已断线，暂停下单`,
            ts: input.ts,
          },
        ];
      default:
        return null;
    }
  }

  return {
    submit(input) {
      return new Promise((resolve, reject) => enqueue({ kind: "input", input, resolve, reject }));
    },
    read(fn) {
      return new Promise((resolve, reject) =>
        enqueue({
          kind: "read",
          run: () => {
            try {
              resolve(fn(engine));
            } catch (error) {
              reject(error);
            }
          },
        }),
      );
    },
    feedMarket(input) {
      if (input.t === "book") {
        const pending = pendingBooks.get(input.symbol);
        if (pending) {
          pending.input = input;
          return;
        }
        const task = { kind: "input" as const, input };
        pendingBooks.set(input.symbol, task);
        enqueue(task);
        return;
      }
      enqueue({ kind: "input", input });
    },
    async idle() {
      while (running) await running;
    },
  };
}
