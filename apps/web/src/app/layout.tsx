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
          <div className="grid h-svh grid-rows-[auto_auto_1fr]">
            <AppHeader />
            <MarketStatusBanner />
            <main className="min-h-0 overflow-auto">{children}</main>
          </div>
          <LiquidationDialog />
        </Providers>
      </body>
    </html>
  );
}
