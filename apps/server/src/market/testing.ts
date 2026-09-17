import type { SocketLike } from "./connection";

/** 测试用：手动推进的定时器。 */
export function fakeClock() {
  let time = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    /** 往前走 ms 毫秒，按时间顺序触发到期的定时器 */
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
      }
      time = target;
    },
    pending: () => [...timers.values()].map((t) => t.at - time).sort((a, b) => a - b),
  };
}

/** 测试用：假的 WebSocket，由测试手动触发 open / message / close。 */
export class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  closed = false;
  constructor(readonly url: string) {}
  open() {
    this.onopen?.({});
  }
  message(text: string) {
    this.onmessage?.({ data: text });
  }
  /** 服务器那边断开 */
  drop() {
    this.onclose?.({});
  }
  close() {
    this.closed = true;
  }
}
