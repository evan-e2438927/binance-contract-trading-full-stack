import type { Metadata } from "next";
import { Suspense } from "react";

import { LeaderboardView } from "./_ui-components/leaderboard-view";

export const metadata: Metadata = { title: "排行榜" };

/**
 * B 排行榜 + 我的权益曲线（05 第 1 节 / M11）。榜单公开，权益曲线需要登录。
 *
 * 保持服务端组件（metadata 只能在服务端组件里导出）；`LeaderboardView` 要读 URL 查询参数，
 * 外面包一层 Suspense。
 */
export default function LeaderboardPage() {
  return (
    <Suspense fallback={null}>
      <LeaderboardView />
    </Suspense>
  );
}
