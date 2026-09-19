import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "排行榜" };

/** 排行榜 + 我的权益曲线（05 第 1 节）。榜单公开，权益曲线需要登录 */
export default function LeaderboardPage() {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[1fr_420px] gap-4 px-6 py-6">
      <div className="flex flex-col gap-4">
        <ModulePlaceholder id="B-01" name="周期切换" note="日榜 · 周榜 · 总榜；数据截至日期（每日 UTC 00:00 快照）" />
        <ModulePlaceholder
          id="B-02"
          name="收益率榜"
          note="排名 · 昵称 · 收益率 · 权益 · 胜率 · 成交笔数；前三名强调"
          className="min-h-96"
        />
      </div>
      <div className="flex flex-col gap-4">
        <ModulePlaceholder id="B-03" name="我的排名" note="未登录提示登录；未上榜说明原因（期内无成交 / 期内重置过）" />
        <ModulePlaceholder
          id="B-04"
          name="我的权益曲线"
          note="近 7 / 30 / 90 天；每日快照 + 当前实时权益；缺的日子不插值"
          className="min-h-72"
        />
        <ModulePlaceholder
          id="B-05"
          name="榜单规则说明"
          note="收益率口径：期初权益为分母；期内重置不上日榜周榜；胜率按平仓成交"
        />
      </div>
    </div>
  );
}
