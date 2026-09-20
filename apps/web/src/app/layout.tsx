import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "../index.css";
import { AppHeader } from "@/app/_shared/ui-components/app-header/app-header";
import { LiquidationDialog } from "@/app/_shared/ui-components/liquidation-dialog";
import { MarketStatusBanner } from "@/app/_shared/ui-components/market-status-banner";
import { Providers } from "@/providers";

// 币安的 BinancePlex 基于 IBM Plex 改的，观感接近，且可以免费商用
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "合约模拟盘",
    template: "%s · 合约模拟盘",
  },
  description: "用币安真实实时行情练习 U 本位合约交易，不产生任何真实下单",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <Providers>
          {/*
            ⚠️ 2026-09-20：这里原来是 `grid grid-rows-[auto_auto_1fr]`，三行对三个孩子。
            但 MarketStatusBanner 在行情正常时 **return null**，不产生 DOM 节点——
            于是只剩两个孩子，落进前两行（都是 auto），第三行 1fr 空着，
            把视口剩下的高度全吃掉：1200px 的屏幕底部空出 372px 黑边，
            而且只有行情异常（横幅出现）时才「碰巧」正常。

            改成 flex 列：横幅渲不渲染都不影响，main 始终吃掉剩余高度。
          */}
          <div className="flex h-svh flex-col">
            <AppHeader />
            <MarketStatusBanner />
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </div>
          <LiquidationDialog />
        </Providers>
      </body>
    </html>
  );
}
