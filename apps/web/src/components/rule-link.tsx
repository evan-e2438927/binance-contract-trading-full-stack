import Link from "next/link";

import { type RuleAnchor, ruleHref } from "@/lib/config/rule-anchors";

/**
 * 界面上的 `?`：点开跳到规则页对应段落（08 第 8 节 Tooltip / `?` 说明）。
 *
 * 为什么不用 tooltip 把话说完：这些问题（前方排队怎么估的、为什么市价单被拒、强平怎么算）
 * 一两句话讲不清楚，硬塞进悬浮框只会得到一句正确的废话。规则页有地方展开讲。
 */
export function RuleLink({ anchor, label }: { anchor: RuleAnchor; label: string }) {
  return (
    <Link
      href={ruleHref(anchor)}
      title={`${label}（点开看规则说明）`}
      aria-label={`${label}（规则说明）`}
      className="ml-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] text-muted-foreground align-middle transition-colors hover:border-brand hover:text-brand"
    >
      ?
    </Link>
  );
}
