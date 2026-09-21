import { DISTORTIONS } from "../_lib/distortions";

/**
 * R-02 和真实交易所的差别。逐条写「现象 · 为什么这么做 · 对你的影响」。
 *
 * 顺序和编号跟 `docs/design/02-architecture.md` 第九节一一对应，方便对账。
 */
export function Differences() {
  return (
    <div className="flex flex-col gap-3">
      {DISTORTIONS.map((item) => (
        <article key={item.n} className="rounded-[8px] border bg-surface p-4">
          <h4 className="flex gap-2 font-semibold text-[14px] text-foreground">
            <span className="text-muted-foreground tabular-nums">{item.n}.</span>
            <span>{item.title}</span>
          </h4>
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 pt-3 text-[13px] leading-[21px]">
            <dt className="text-muted-foreground">现象</dt>
            <dd className="text-foreground">{item.what}</dd>
            <dt className="text-muted-foreground">为什么</dt>
            <dd className="text-muted-foreground">{item.why}</dd>
            <dt className="text-muted-foreground">对你</dt>
            <dd className="text-muted-foreground">{item.impact}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}
