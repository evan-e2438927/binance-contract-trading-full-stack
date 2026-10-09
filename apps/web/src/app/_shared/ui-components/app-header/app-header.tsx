import { AccountEntry } from "./account-entry";
import { BrandLogo } from "./brand-logo";
import { ConnectionIndicator } from "./connection-indicator";
import { HeaderTicker } from "./header-ticker";
import { MainNav } from "./main-nav";
import { VersionInfo } from "./version-info";

/**
 * G-01 全站顶栏（Figma 2:6 未登录 / 5:8055 已登录）：Logo · 主导航 · [行情] · 连接状态 · 登录入口 / 账户菜单。
 * 行情只在交易页出现（Figma 4:4632），由 HeaderTicker 按路由自己判断。
 */
export function AppHeader() {
  return (
    <header className="flex h-12 items-center gap-2 border-b bg-surface px-4">
      <BrandLogo />
      <MainNav />
      <HeaderTicker />
      <div className="flex items-center gap-2">
        <ConnectionIndicator />
        <VersionInfo />
        <AccountEntry />
      </div>
    </header>
  );
}
