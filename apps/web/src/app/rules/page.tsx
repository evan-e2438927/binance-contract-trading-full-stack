import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "模拟规则" };

/**
 * 模拟规则说明（05 第 1 节，不是可选项）：用户迟早会问"为什么我的单没成交"，把规则摆出来比一次次解释便宜。
 * 内容来自 02-architecture.md 第九节的失真点清单，第 5 阶段写成正文。
 */
export default function RulesPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6">
      <ModulePlaceholder id="R-01" name="目录" note="左侧锚点目录，交易页的 ? 图标直接跳到对应段落" />
      <ModulePlaceholder
        id="R-02"
        name="和真实交易所的差别（失真点）"
        note="逐条：现象 · 为什么这么做 · 对你的影响"
        className="min-h-60"
      />
      <ModulePlaceholder id="R-03" name="撮合与排队" note="限价单排队、前方排队量怎么估、为什么价格到了没成交" />
      <ModulePlaceholder id="R-04" name="保证金、强平与资金费" note="公式 + 算例，和币安一致的地方注明出处" />
      <ModulePlaceholder id="R-05" name="账户与重置" note="初始 10,000 USDT、24 小时一次重置、排行榜影响" />
    </div>
  );
}
