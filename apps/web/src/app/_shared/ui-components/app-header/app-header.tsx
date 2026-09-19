import type { ReactNode } from "react";

import { AccountEntry } from "./account-entry";
import { BrandLogo } from "./brand-logo";
import { ConnectionIndicator } from "./connection-indicator";
import { MainNav } from "./main-nav";

/**
 * G-01 全站顶栏（Figma 2:6 未登录 / 5:8055 已登录）：Logo · 主导航 · [行情插槽] · 连接状态 · 登录入口 / 账户菜单。
 * ticker：交易页当前币对的最新价 + 涨跌幅，M02 接入；其它页面不传。
 */
export function AppHeader({ ticker }: { ticker?: ReactNode }) {
  return (
    <header className="flex h-12 items-center gap-2 border-b bg-surface px-4">
      <BrandLogo />
      <MainNav />
      {ticker && <div className="mr-3 flex items-center gap-3.5">{ticker}</div>}
      <div className="flex items-center gap-2">
        <ConnectionIndicator />
        <AccountEntry />
      </div>
    </header>
  );
}
