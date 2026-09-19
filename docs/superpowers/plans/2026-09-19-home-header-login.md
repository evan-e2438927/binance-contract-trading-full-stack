# 首页 · 全站顶栏 · 登录弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Figma 设计稿还原全站顶栏、首页（介绍区 / 数据条 / 热门合约 / 卖点卡）和登录弹窗，并把邮箱验证码登录做通。

**Architecture:** 纯逻辑（排序、统计、导航高亮、显示名、倒计时）写成 `.ts` 纯函数，先写测试；界面组件按 `docs/frontend/directory-structure.md` 分三层：`components/`（通用，只收 props）→ `app/_shared/ui-components/`（顶栏、登录弹窗）→ `app/(home)/_ui-components/`（首页）。数据沿用 M00 已有的 `useSymbols` / `useTickers` / `market-store` / `auth-store`，不新增接口。

**Tech Stack:** Next.js 16 App Router + React 19（React Compiler）· Tailwind 4 · `packages/ui`（shadcn base-ui 版）· Zustand 5 · TanStack Query 5 · zod 4 · sonner · Vitest（jsdom，只收 `src/**/*.test.ts`）· Biome

**Spec:** `docs/superpowers/specs/2026-09-19-home-header-login-design.md`（执行前通读，尤其「设计稿」和「一、和设计稿不一样的地方」两节）

## Global Constraints

- **样式以 Figma 为准**：每个界面任务的第一步都是对指定节点调 Figma MCP `get_design_context`（fileKey `tEjxTvnW0drLCL1w4ygMgo`），调之前先加载 `figma:figma-design-to-code` skill，`skillNames` 传 `figma-design-to-code`。本计划里写的类名是按设计稿推出来的初稿，和 `get_design_context` 的结果不一致时按设计稿改。最后一步用 `get_screenshot` 和浏览器截图并排对比
- 颜色一律用 token：`bg-surface`(#161a1e) · `bg-elevated`(#1e2329) · `border`/`bg-border`(#2b3139) · `text-foreground`(#eaecef) · `text-muted-foreground`(#848e9c) · `text-up`/`bg-up`(#0ecb81) · `text-down`(#f6465d) · `bg-brand`/`text-brand`(#f0b90b)。**不写十六进制**；设计稿的 `1.272px`、`1.037px` 边框一律 1px
- 数值不用浮点：金额、价格比较用 `parse()`（`@binance-contract-trading-full-stack/shared`）转 bigint；展示只用 `@/lib/format/number` 的函数；取不到显示 `--`
- 服务端错误原样显示 `toApiError(e).message`，不翻译不拼接
- 依赖方向：`components/` 不 import `app/`、`stores/`、`server-api-module/`；`app/_shared` 不 import `app/(home)`
- 图标用设计稿导出的资源，下载进 `apps/web/public/`，不手写 SVG
- 文件风格：双引号、分号、2 空格（Biome 会管）；注释用中文，写"是什么 / 为什么"
- **不 commit**：用户的规则是"说提交才提交"。每个任务结束只跑检查，不执行 `git commit`
- 命令都在仓库根 `binance-contract-trading-full-stack/` 下执行
- `pnpm -F web check-types` 只看 web；native 本来就红，不管

---

## 文件地图

```
packages/ui/src/components/dialog.tsx                 改：DialogContent 加 overlayClassName

apps/web/src/
├─ lib/config/constants.ts                            改：+ INITIAL_BALANCE_DISPLAY
├─ components/
│  ├─ letter-avatar.tsx                               新
│  ├─ direction-text.tsx                              新
│  └─ segmented-tabs.tsx                              新
├─ app/layout.tsx                                     改：AppHeader 的 import 路径
├─ app/_shared/ui-components/
│  ├─ app-header/
│  │  ├─ app-header.tsx                               git mv + 重写
│  │  ├─ brand-logo.tsx                               新
│  │  ├─ main-nav.tsx                                 新
│  │  ├─ nav-match.ts / nav-match.test.ts             新
│  │  ├─ account-display.ts / account-display.test.ts 新
│  │  ├─ account-entry.tsx                            git mv + 换样式
│  │  └─ connection-indicator.tsx                     git mv + 改成小圆点
│  └─ login-dialog/
│     ├─ login-dialog.tsx                             git mv + 重写
│     ├─ styles.ts                                    新
│     ├─ wallet-login.tsx                             新
│     ├─ google-login.tsx                             新
│     ├─ email-login.tsx                              新
│     └─ use-countdown.ts / use-countdown.test.ts     新
├─ app/(home)/
│  ├─ page.tsx                                        重写
│  └─ _ui-components/
│     ├─ symbol-market-list.tsx                       删
│     ├─ hero-section.tsx                             新
│     ├─ stats-bar.tsx                                新
│     ├─ stats.ts / stats.test.ts                     新
│     ├─ feature-cards.tsx                            新
│     └─ hot-contracts/
│        ├─ hot-contracts.tsx                         新
│        ├─ contract-row.tsx                          新
│        ├─ grid.ts                                   新（表头和行共用的列定义）
│        └─ sort-by-volume.ts / .test.ts              新
└─ public/icons/google.svg                            新（设计稿导出）
```

---

### Task 1: 通用组件与常量

**Files:**
- Modify: `apps/web/src/lib/config/constants.ts`
- Create: `apps/web/src/components/letter-avatar.tsx`
- Create: `apps/web/src/components/direction-text.tsx`
- Create: `apps/web/src/components/segmented-tabs.tsx`

**Interfaces:**
- Produces:
  - `INITIAL_BALANCE_DISPLAY: "10,000"`
  - `LetterAvatar({ text: string; tone: "up" | "down" | "flat" | "brand"; size?: "sm" | "md"; className?: string })`（sm = 26px，md = 28px）
  - `DirectionText({ value: string | null | undefined; className?: string; children; ...spanProps })`：按 `direction(value)` 着色
  - `SegmentedTabsList(props: TabsList props)`、`SegmentedTabsTrigger(props: TabsTrigger props)`：配合 `packages/ui` 的 `Tabs` / `TabsContent` 用

- [ ] **Step 1: 取设计稿**

对 `2:143`（币对字母头像）、`5:8095`（用户头像）、`5:7228`（分段 tab）调 `get_design_context`，记下尺寸、圆角、字号、颜色。

- [ ] **Step 2: 加常量**

在 `apps/web/src/lib/config/constants.ts` 末尾追加：

```ts
/**
 * 开户发放的初始模拟资金（展示用）。服务端开户时写 INITIAL 流水，金额见 packages/db 的开户逻辑；
 * 这里只是文案，不参与任何计算。
 */
export const INITIAL_BALANCE_DISPLAY = "10,000";
```

- [ ] **Step 3: 写 `letter-avatar.tsx`**

```tsx
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

const TONE = {
  up: "bg-up/15 text-up",
  down: "bg-down/12 text-down",
  flat: "bg-elevated text-muted-foreground",
  brand: "border bg-elevated text-brand",
} as const;

const SIZE = { sm: "size-[26px]", md: "size-7" } as const;

export type LetterAvatarTone = keyof typeof TONE;

/** 字母圆头像：币对用基础币种前两个字母（按涨跌着色），用户用显示名首字母（brand） */
export function LetterAvatar({
  text,
  tone,
  size = "md",
  className,
}: {
  text: string;
  tone: LetterAvatarTone;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold font-sans text-[11px] leading-[16.5px]",
        SIZE[size],
        TONE[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 4: 写 `direction-text.tsx`**

```tsx
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ComponentProps } from "react";

import { direction } from "@/lib/format/number";

const TONE = { up: "text-up", down: "text-down", flat: "text-muted-foreground" } as const;

/** 按 value 的正负着色（涨绿跌红，0 或取不到为灰）。value 是决定颜色的数，children 是要显示的文字，两者可以不同 */
export function DirectionText({
  value,
  className,
  ...props
}: { value: string | null | undefined } & ComponentProps<"span">) {
  return <span className={cn(TONE[direction(value)], className)} {...props} />;
}
```

- [ ] **Step 5: 写 `segmented-tabs.tsx`**

```tsx
"use client";

import { TabsList, TabsTrigger } from "@binance-contract-trading-full-stack/ui/components/tabs";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * 分段式 tab（08 第 8 节）：深色槽 + 选中项浮起一块。登录弹窗、排行榜周期、订单页 tab 都用这个。
 * 只换 packages/ui Tabs 的样式，外层仍用 <Tabs>，内容用 <TabsContent>。
 */
export function SegmentedTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn("w-full gap-[3px] rounded-md bg-surface p-[3px] group-data-horizontal/tabs:h-10", className)}
      {...props}
    />
  );
}

export function SegmentedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-full rounded-[4px] py-[7px] font-medium text-[12px] text-muted-foreground leading-[18px]",
        "data-active:border-border data-active:bg-elevated data-active:text-foreground",
        "dark:data-active:border-border dark:data-active:bg-elevated dark:data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 6: 检查**

Run: `pnpm -F web check-types && pnpm -F web lint`
Expected: 两个都通过（新组件还没被用到，只看能否编译）

---

### Task 2: 全站顶栏

**Files:**
- Create: `apps/web/src/app/_shared/ui-components/app-header/nav-match.ts`、`nav-match.test.ts`
- Create: `apps/web/src/app/_shared/ui-components/app-header/account-display.ts`、`account-display.test.ts`
- Create: `apps/web/src/app/_shared/ui-components/app-header/brand-logo.tsx`、`main-nav.tsx`
- Move + rewrite: `app-header.tsx`、`account-entry.tsx`、`connection-indicator.tsx`（从 `app/_shared/ui-components/` 挪进 `app-header/`）
- Modify: `apps/web/src/app/layout.tsx`（import 路径）

**Interfaces:**
- Consumes: Task 1 的 `LetterAvatar`
- Produces:
  - `NAV_ITEMS: readonly NavItem[]`，`NavItem = { href: string; match: string; label: string; exact?: boolean }`
  - `isNavActive(pathname: string, item: Pick<NavItem, "match" | "exact">): boolean`
  - `shortId(providerId: string): string`、`displayName(me: Me): string`、`avatarInitial(name: string): string`
  - `AppHeader({ ticker?: ReactNode })`（M02 往 `ticker` 里放交易页行情）

- [ ] **Step 1: 写 `nav-match.test.ts`（先失败）**

```ts
import { describe, expect, it } from "vitest";

import { isNavActive, NAV_ITEMS } from "./nav-match";

const byLabel = (label: string) => {
  const item = NAV_ITEMS.find((i) => i.label === label);
  if (!item) throw new Error(`没有导航项 ${label}`);
  return item;
};

describe("isNavActive", () => {
  it("首页只在 / 完全匹配时高亮", () => {
    expect(isNavActive("/", byLabel("首页"))).toBe(true);
    expect(isNavActive("/trade/BTCUSDT", byLabel("首页"))).toBe(false);
  });

  it("交易页任意币对都高亮「交易」", () => {
    expect(isNavActive("/trade/ETHUSDT", byLabel("交易"))).toBe(true);
    expect(isNavActive("/trade", byLabel("交易"))).toBe(true);
  });

  it("前缀匹配要按路径段，不能把 /orders-x 当成 /orders", () => {
    expect(isNavActive("/orders", byLabel("订单"))).toBe(true);
    expect(isNavActive("/orders-x", byLabel("订单"))).toBe(false);
  });

  it("导航顺序和文案按设计稿", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["首页", "交易", "订单", "排行榜", "规则"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F web test -- nav-match`
Expected: FAIL，`Cannot find module './nav-match'`

- [ ] **Step 3: 写 `nav-match.ts`**

```ts
import { DEFAULT_SYMBOL } from "@/lib/config/constants";

export interface NavItem {
  href: string;
  /** 用来判断高亮的路径 */
  match: string;
  label: string;
  /** true = 只在完全相等时高亮（首页 "/" 要这样，否则所有页面都匹配） */
  exact?: boolean;
}

/** G-01 主导航，顺序和文案按设计稿（Figma 2:17） */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", match: "/", label: "首页", exact: true },
  { href: `/trade/${DEFAULT_SYMBOL}`, match: "/trade", label: "交易" },
  { href: "/orders", match: "/orders", label: "订单" },
  { href: "/leaderboard", match: "/leaderboard", label: "排行榜" },
  { href: "/rules", match: "/rules", label: "规则" },
];

/** 当前路径是否高亮这一项：exact 要完全相等；否则相等或以 "match/" 开头 */
export function isNavActive(pathname: string, item: Pick<NavItem, "match" | "exact">): boolean {
  if (item.exact) return pathname === item.match;
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F web test -- nav-match`
Expected: PASS（4 条）

- [ ] **Step 5: 写 `account-display.test.ts`（先失败）**

```ts
import { describe, expect, it } from "vitest";

import type { Me } from "@/server-api-module/auth/types";

import { avatarInitial, displayName, shortId } from "./account-display";

const me = (nickname: string | null, providerId: string): Me => ({
  account: { id: "a1", nickname, createdAt: 0 },
  identity: { provider: "wallet_evm", providerId },
});

describe("shortId", () => {
  it("长标识取头 6 尾 4", () => {
    expect(shortId("0x12ab34cd56ef7890aabbccddeeff00112233")).toBe("0x12ab…2233");
  });
  it("16 个字符以内原样返回", () => {
    expect(shortId("ab@gmail.com")).toBe("ab@gmail.com");
  });
});

describe("displayName", () => {
  it("有昵称用昵称", () => {
    expect(displayName(me("Google_2761", "x"))).toBe("Google_2761");
  });
  it("昵称为空或全是空白时用标识缩写", () => {
    expect(displayName(me(null, "0x12ab34cd56ef7890aabbccddeeff00112233"))).toBe("0x12ab…2233");
    expect(displayName(me("  ", "ab@gmail.com"))).toBe("ab@gmail.com");
  });
});

describe("avatarInitial", () => {
  it("取第一个字符并大写", () => {
    expect(avatarInitial("google_2761")).toBe("G");
  });
  it("中文和 emoji 按完整字符取，不截断代理对", () => {
    expect(avatarInitial("熊猫")).toBe("熊");
    expect(avatarInitial("🐼panda")).toBe("🐼");
  });
  it("空串给问号", () => {
    expect(avatarInitial("")).toBe("?");
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `pnpm -F web test -- account-display`
Expected: FAIL，`Cannot find module './account-display'`

- [ ] **Step 7: 写 `account-display.ts`**

```ts
import type { Me } from "@/server-api-module/auth/types";

/** 登录标识的简写：钱包地址这类长串取头 6 尾 4，邮箱等短标识原样 */
export function shortId(providerId: string): string {
  return providerId.length > 16 ? `${providerId.slice(0, 6)}…${providerId.slice(-4)}` : providerId;
}

/** 顶栏显示的名字：昵称优先，没有就用登录标识简写 */
export function displayName(me: Me): string {
  return me.account.nickname?.trim() || shortId(me.identity.providerId);
}

/** 头像字母：显示名的第一个字符（按码点取，不会把 emoji 切成半个）转大写 */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm -F web test -- account-display`
Expected: PASS（7 条）

- [ ] **Step 9: 取设计稿**

对 `2:6`（未登录顶栏）、`5:8055`（已登录顶栏，右侧头像区 `5:8093`）调 `get_design_context`。

- [ ] **Step 10: 挪文件（保留历史）**

```bash
cd apps/web/src/app/_shared/ui-components
mkdir app-header
git mv app-header.tsx app-header/app-header.tsx
git mv account-entry.tsx app-header/account-entry.tsx
git mv connection-indicator.tsx app-header/connection-indicator.tsx
```

`account-entry.tsx` 里 `import { LoginDialog } from "./login-dialog";` 改成 `import { LoginDialog } from "../login-dialog";`（Task 5 会再改成 `../login-dialog/login-dialog`）。
`apps/web/src/app/layout.tsx` 里 `@/app/_shared/ui-components/app-header` 改成 `@/app/_shared/ui-components/app-header/app-header`。

- [ ] **Step 11: 写 `brand-logo.tsx`**

```tsx
import Link from "next/link";

/** G-01 左侧 Logo（Figma 2:7）：黄色 M 方块 + 产品名 + 「模拟交易·虚拟资金」标签 */
export function BrandLogo() {
  return (
    <Link href="/" className="mr-4 flex shrink-0 items-center gap-2">
      <span className="flex size-[26px] items-center justify-center rounded-[5px] bg-brand font-bold text-[12px] text-black leading-[18px]">
        M
      </span>
      <span className="font-bold text-[14px] text-foreground leading-[21px] tracking-[-0.3px]">合约模拟盘</span>
      <span className="rounded-[3px] bg-brand/14 px-1.5 py-0.5 font-semibold text-[10px] text-brand leading-[15px]">
        模拟交易·虚拟资金
      </span>
    </Link>
  );
}
```

- [ ] **Step 12: 写 `main-nav.tsx`**

```tsx
"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavActive, NAV_ITEMS } from "./nav-match";

/** G-01 主导航（Figma 2:17）：当前页是浮起的深色块 + 半粗白字，其余灰字 */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item);
        return (
          <Link
            key={item.match}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-[5px] px-[13px] py-[5px] text-[13px] leading-[19.5px] transition-colors",
              active ? "bg-elevated font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 13: 重写 `app-header.tsx`**

```tsx
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
```

- [ ] **Step 14: 改 `connection-indicator.tsx` 为小圆点**

把 return 部分换成（`LABEL`、`useSyncExternalStore` 那段不动）：

```tsx
  return (
    <span
      role="status"
      aria-label={`实时数据连接：${LABEL[status]}`}
      title={`实时数据连接：${LABEL[status]}`}
      className="flex size-4 items-center justify-center"
    >
      <span className={cn("size-2 rounded-full", status === "open" ? "bg-up" : "animate-pulse bg-brand")} />
    </span>
  );
```

注释改成：`/** G-02 连接状态：顶栏里只显示小圆点（绿 = 已连接，黄闪 = 连接中 / 重连中），文字放悬停提示 */`

- [ ] **Step 15: 改 `account-entry.tsx` 的样式**

删掉文件内的 `shortId`（改用 `./account-display`），import 改成：

```tsx
import { LetterAvatar } from "@/components/letter-avatar";
import { avatarInitial, displayName, shortId } from "./account-display";
```

未登录分支的按钮：

```tsx
        <Button
          size="sm"
          onClick={() => setLoginOpen(true)}
          className="h-auto rounded-[5px] px-3.5 py-[5px] font-bold text-[12px] text-black leading-[18px]"
        >
          登录 / 注册
        </Button>
```

已登录分支整段换成：

```tsx
  const name = displayName(me);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-[5px] px-1 py-0.5 transition-colors hover:bg-elevated aria-expanded:bg-elevated"
          />
        }
      >
        <LetterAvatar text={avatarInitial(name)} tone="brand" size="sm" />
        <span className="max-w-32 truncate text-[12px] text-muted-foreground leading-[18px]">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          {PROVIDER_LABEL[me.identity.provider]} · {shortId(me.identity.providerId)}
        </DropdownMenuLabel>
        <DropdownMenuLabel className="num flex items-center justify-between text-xs">
          <span className="font-sans text-muted-foreground">钱包余额</span>
          <span>{formatUsdt(walletBalance)} USDT</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* 下面三项等 M06：改昵称（G-06）、持仓模式（G-07）、重置账户（G-08） */}
        <DropdownMenuItem disabled>修改昵称</DropdownMenuItem>
        <DropdownMenuItem disabled>持仓模式</DropdownMenuItem>
        <DropdownMenuItem disabled>重置模拟账户</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
```

`ChevronDown` 的 import 删掉；骨架改成 `<Skeleton className="h-[26px] w-24 rounded-[5px]" />`。

- [ ] **Step 16: 检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过；测试条数 = 原有 26 + 11

- [ ] **Step 17: 浏览器对比**

后台起服务（已在跑就跳过）：`pnpm run dev:server`、`pnpm run dev:web`（都用 Bash `run_in_background`）。浏览器打开 `http://localhost:3001/`，截顶栏；`get_screenshot` 取 `2:6` 并排对比 Logo、导航间距、按钮。再打开 `/trade/BTCUSDT`，确认「交易」高亮。已登录样子放到 Task 6 登录后一起对比 `5:8055`。

---

### Task 3: 热门合约（H-02）

**Files:**
- Create: `apps/web/src/app/(home)/_ui-components/hot-contracts/sort-by-volume.ts`、`sort-by-volume.test.ts`
- Create: `.../hot-contracts/grid.ts`、`contract-row.tsx`、`hot-contracts.tsx`
- Delete: `apps/web/src/app/(home)/_ui-components/symbol-market-list.tsx`
- Modify: `apps/web/src/app/(home)/page.tsx`（换成 `HotContracts`，Task 4 再补其它区块）

**Interfaces:**
- Consumes: Task 1 的 `LetterAvatar`、`DirectionText`；已有 `useSymbols()`、`useTickers(symbols: readonly string[])`、`useMarketStore`（`tickers: Record<string, TickerState>`，`TickerState.stats24h?.quoteVolume / priceChangePercent`）
- Produces: `sortByVolume(entries: readonly VolumeEntry[]): string[]`，`VolumeEntry = { symbol: string; quoteVolume: string | null | undefined }`；`HotContracts()` 组件

- [ ] **Step 1: 写 `sort-by-volume.test.ts`（先失败）**

```ts
import { describe, expect, it } from "vitest";

import { sortByVolume } from "./sort-by-volume";

describe("sortByVolume", () => {
  it("按 24h 成交额从高到低", () => {
    expect(
      sortByVolume([
        { symbol: "ETHUSDT", quoteVolume: "3250000000.5" },
        { symbol: "BTCUSDT", quoteVolume: "16950000000" },
        { symbol: "BNBUSDT", quoteVolume: "272580000" },
      ]),
    ).toEqual(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
  });

  it("没有成交额（null / undefined / 空串）的排最后，彼此按字母序", () => {
    expect(
      sortByVolume([
        { symbol: "XRPUSDT", quoteVolume: null },
        { symbol: "ADAUSDT", quoteVolume: undefined },
        { symbol: "SOLUSDT", quoteVolume: "1" },
        { symbol: "DOGEUSDT", quoteVolume: "" },
      ]),
    ).toEqual(["SOLUSDT", "ADAUSDT", "DOGEUSDT", "XRPUSDT"]);
  });

  it("成交额相同按字母序，结果稳定", () => {
    expect(
      sortByVolume([
        { symbol: "B", quoteVolume: "5" },
        { symbol: "A", quoteVolume: "5.00000000" },
      ]),
    ).toEqual(["A", "B"]);
  });

  it("超过 2^53 的数也能比对（走 bigint，不走 Number）", () => {
    expect(
      sortByVolume([
        { symbol: "LOW", quoteVolume: "90071992547409.93" },
        { symbol: "HIGH", quoteVolume: "90071992547409.94" },
      ]),
    ).toEqual(["HIGH", "LOW"]);
  });

  it("空数组", () => {
    expect(sortByVolume([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F web test -- sort-by-volume`
Expected: FAIL，`Cannot find module './sort-by-volume'`

- [ ] **Step 3: 写 `sort-by-volume.ts`**

```ts
import { parse } from "@binance-contract-trading-full-stack/shared";

export interface VolumeEntry {
  symbol: string;
  /** 24h 成交额（USDT，十进制字符串）；币安限流拿不到时为 null */
  quoteVolume: string | null | undefined;
}

const bySymbol = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * H-02 热门合约的顺序：24h 成交额降序（bigint 比较，不经过 Number）；
 * 拿不到成交额的排最后；相同时按币对名字母序，保证每次结果一样。
 */
export function sortByVolume(entries: readonly VolumeEntry[]): string[] {
  const keyed = entries.map((e) => ({
    symbol: e.symbol,
    volume: e.quoteVolume ? parse(e.quoteVolume) : null,
  }));
  keyed.sort((a, b) => {
    if (a.volume === null || b.volume === null) {
      if (a.volume === b.volume) return bySymbol(a.symbol, b.symbol);
      return a.volume === null ? 1 : -1;
    }
    if (a.volume !== b.volume) return a.volume > b.volume ? -1 : 1;
    return bySymbol(a.symbol, b.symbol);
  });
  return keyed.map((e) => e.symbol);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F web test -- sort-by-volume`
Expected: PASS（5 条）

- [ ] **Step 5: 取设计稿**

对 `2:367` 调 `get_design_context`（已知：表格圆角 10、表头 11px 中等灰字、行上下 12px、7 列）。另外读 Figma Make 资源 `file://figma/make/source/wwAWi4IZWhobYR4oMYQRgz/src/pages/HomePage.tsx` 确认列宽 `1.2fr 1fr 1fr 1fr 1fr 1fr 120px` 和行悬停 `bg-elevated`。

- [ ] **Step 6: 写 `grid.ts`**

```ts
/** 热门合约表头和行共用的列定义（Figma Make HomePage：1.2fr ×5 个 1fr + 120px 操作列） */
export const CONTRACT_GRID = "grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr_1fr_120px] items-center px-4";
```

- [ ] **Step 7: 写 `contract-row.tsx`**

```tsx
"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DirectionText } from "@/components/direction-text";
import { LetterAvatar } from "@/components/letter-avatar";
import { direction, formatCompact, formatPercentValue, formatPrice, formatRatioAsPercent } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

import { CONTRACT_GRID } from "./grid";

/**
 * 热门合约的一行（Figma 2:141）。只订阅自己这个币对的 ticker，一条推送只重渲染一行。
 * 最新价、24h 涨跌、头像按 24h 涨跌着色；资金费率按自身正负着色；标记价、成交额灰色。
 */
export function ContractRow({ spec }: { spec: SymbolSpec }) {
  const router = useRouter();
  const ticker = useMarketStore((s) => s.tickers[spec.symbol]);
  const change = ticker?.stats24h?.priceChangePercent;
  const quoteVolume = ticker?.stats24h?.quoteVolume;
  const href = `/trade/${spec.symbol}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: 行里还有一个「交易」Link，整行不能再包成 <a>（a 不能嵌套 a）
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={cn(CONTRACT_GRID, "num cursor-pointer border-b py-3 transition-colors last:border-b-0 hover:bg-elevated")}
    >
      <div className="flex items-center gap-2.5 font-sans">
        <LetterAvatar text={spec.baseAsset.slice(0, 2)} tone={direction(change)} />
        <div>
          <div className="font-semibold text-[13px] text-foreground leading-[19.5px]">
            {spec.baseAsset}/{spec.quoteAsset}
          </div>
          <div className="text-[11px] text-muted-foreground leading-[16.5px]">永续</div>
        </div>
      </div>
      <DirectionText value={change} className="text-right font-semibold text-[13px] leading-[19.5px]">
        {formatPrice(ticker?.lastPrice, spec)}
      </DirectionText>
      <DirectionText value={change} className="text-right font-medium text-[12px] leading-[18px]">
        {formatPercentValue(change)}
      </DirectionText>
      <span className="text-right text-[12px] text-muted-foreground leading-[18px]">
        {formatPrice(ticker?.markPrice, spec)}
      </span>
      <DirectionText value={ticker?.fundingRate} className="text-right text-[12px] leading-[18px]">
        {formatRatioAsPercent(ticker?.fundingRate, { precision: 4 })}
      </DirectionText>
      <span className="text-right text-[12px] text-muted-foreground leading-[18px]" title={quoteVolume ?? undefined}>
        {quoteVolume ? `${formatCompact(quoteVolume)} USDT` : formatCompact(quoteVolume)}
      </span>
      <div className="flex justify-center font-sans">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[5px] bg-brand px-3.5 py-[5px] font-bold text-[12px] text-black leading-[18px] transition-colors hover:bg-brand/80"
        >
          交易
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 写 `hot-contracts.tsx`**

```tsx
"use client";

import { Skeleton } from "@binance-contract-trading-full-stack/ui/components/skeleton";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useTickers } from "@/hooks/use-symbol-market";
import { useSymbols } from "@/hooks/use-symbols";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

import { ContractRow } from "./contract-row";
import { CONTRACT_GRID } from "./grid";
import { sortByVolume } from "./sort-by-volume";

const EMPTY: SymbolSpec[] = [];
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];
const HEADERS = [
  { label: "币对", align: "text-left font-sans" },
  { label: "最新价", align: "text-right" },
  { label: "24h涨跌", align: "text-right" },
  { label: "标记价", align: "text-right" },
  { label: "资金费率", align: "text-right" },
  { label: "24h成交额", align: "text-right" },
  { label: "操作", align: "text-center font-sans" },
] as const;

/**
 * H-02 热门合约（Figma 2:367）：全部开放币对，按 24h 成交额降序。
 * 24h 统计只在进页面时取一次（缺口 #47），所以排序只会在首屏数据到齐时变一次，之后行不会跳。
 */
export function HotContracts() {
  const { data, isPending, error } = useSymbols();
  const symbols = data ?? EMPTY;
  useTickers(symbols.map((s) => s.symbol));

  // useShallow：只有某个币对的成交额真的变了才触发重渲染，最新价的每秒推送不会
  const volumes = useMarketStore(
    useShallow((s) => symbols.map((spec) => s.tickers[spec.symbol]?.stats24h?.quoteVolume ?? null)),
  );
  const ordered = useMemo(() => {
    const bySymbol = new Map(symbols.map((spec) => [spec.symbol, spec]));
    const order = sortByVolume(symbols.map((spec, i) => ({ symbol: spec.symbol, quoteVolume: volumes[i] })));
    return order.flatMap((symbol) => bySymbol.get(symbol) ?? []);
  }, [symbols, volumes]);

  return (
    <section className="mx-auto w-full max-w-[1100px]">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-[18px] text-foreground leading-[27px]">热门合约</h2>
        <span className="text-[12px] text-muted-foreground leading-[18px]">实时行情 · 自动刷新</span>
      </header>
      <div className="overflow-hidden rounded-[10px] border bg-surface">
        <div
          className={cn(
            CONTRACT_GRID,
            "num border-b py-2.5 font-medium text-[11px] text-muted-foreground leading-[16.5px]",
          )}
        >
          {HEADERS.map((h) => (
            <span key={h.label} className={h.align}>
              {h.label}
            </span>
          ))}
        </div>
        {error ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">{error.message}</p>
        ) : isPending ? (
          SKELETON_ROWS.map((key) => (
            <div key={key} className="border-b px-4 py-3 last:border-b-0">
              <Skeleton className="h-9 w-full" />
            </div>
          ))
        ) : (
          ordered.map((spec) => <ContractRow key={spec.symbol} spec={spec} />)
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 9: 接到首页，删旧列表**

`apps/web/src/app/(home)/page.tsx` 里 `SymbolMarketList` 换成 `HotContracts`（import 自 `./_ui-components/hot-contracts/hot-contracts`），然后：

```bash
git rm "apps/web/src/app/(home)/_ui-components/symbol-market-list.tsx"
```

- [ ] **Step 10: 检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过

- [ ] **Step 11: 浏览器对比**

打开 `http://localhost:3001/`：19 行，第一行成交额最大，价格每秒在跳，点整行和点「交易」都进 `/trade/<SYMBOL>`。`get_screenshot` 取 `2:367` 并排对比列对齐、字号、颜色、按钮位置。

---

### Task 4: 首页其余区块（H-01 介绍区、数据条、卖点卡）

**Files:**
- Create: `apps/web/src/app/(home)/_ui-components/stats.ts`、`stats.test.ts`
- Create: `.../hero-section.tsx`、`stats-bar.tsx`、`feature-cards.tsx`
- Modify: `apps/web/src/app/(home)/page.tsx`

**Interfaces:**
- Consumes: Task 1 的 `INITIAL_BALANCE_DISPLAY`；Task 3 的 `HotContracts`；已有 `useSymbols()`、`PLACEHOLDER`
- Produces: `maxLeverageOf(symbols: readonly Pick<SymbolSpec, "baseAsset" | "maxLeverage">[]): { maxLeverage: number; baseAsset: string } | null`

- [ ] **Step 1: 写 `stats.test.ts`（先失败）**

```ts
import { describe, expect, it } from "vitest";

import { maxLeverageOf } from "./stats";

describe("maxLeverageOf", () => {
  it("取最大杠杆和对应币种", () => {
    expect(
      maxLeverageOf([
        { baseAsset: "ETH", maxLeverage: 100 },
        { baseAsset: "BTC", maxLeverage: 125 },
        { baseAsset: "SOL", maxLeverage: 75 },
      ]),
    ).toEqual({ maxLeverage: 125, baseAsset: "BTC" });
  });

  it("并列时取列表里靠前的", () => {
    expect(
      maxLeverageOf([
        { baseAsset: "BTC", maxLeverage: 125 },
        { baseAsset: "ETH", maxLeverage: 125 },
      ]),
    ).toEqual({ maxLeverage: 125, baseAsset: "BTC" });
  });

  it("分层表还没同步（maxLeverage 为 null）的跳过；全都没有时返回 null", () => {
    expect(maxLeverageOf([{ baseAsset: "BTC", maxLeverage: null }])).toBeNull();
    expect(
      maxLeverageOf([
        { baseAsset: "BTC", maxLeverage: null },
        { baseAsset: "ETH", maxLeverage: 20 },
      ]),
    ).toEqual({ maxLeverage: 20, baseAsset: "ETH" });
  });

  it("空数组返回 null", () => {
    expect(maxLeverageOf([])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F web test -- stats`
Expected: FAIL，`Cannot find module './stats'`

- [ ] **Step 3: 写 `stats.ts`**

```ts
import type { SymbolSpec } from "@/server-api-module/market/types";

/** 数据条「最高杠杆」：所有币对里 maxLeverage 最大的那个。不写死数字，分层表变了这里跟着变 */
export function maxLeverageOf(
  symbols: readonly Pick<SymbolSpec, "baseAsset" | "maxLeverage">[],
): { maxLeverage: number; baseAsset: string } | null {
  let best: { maxLeverage: number; baseAsset: string } | null = null;
  for (const { baseAsset, maxLeverage } of symbols) {
    if (maxLeverage === null) continue;
    if (!best || maxLeverage > best.maxLeverage) best = { maxLeverage, baseAsset };
  }
  return best;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F web test -- stats`
Expected: PASS（4 条）

- [ ] **Step 5: 取设计稿**

对 `2:365`（介绍区）、`2:366`（数据条）、`2:368`（卖点卡）、`2:2`（整页间距）调 `get_design_context`。

- [ ] **Step 6: 写 `hero-section.tsx`**

```tsx
import Link from "next/link";

import { DEFAULT_SYMBOL } from "@/lib/config/constants";

/** H-01 介绍区（Figma 2:365） */
export function HeroSection() {
  return (
    <section className="mx-auto mb-12 max-w-[900px] pt-10 text-center">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/12 px-3.5 py-1 font-semibold text-[12px] text-brand">
        <span className="size-1.5 rounded-full bg-brand" />
        模拟交易 · 虚拟资金 · 零风险体验
      </div>
      <h1 className="mb-4 font-extrabold text-[44px] text-foreground leading-[1.1] tracking-[-1.5px]">合约模拟盘</h1>
      <p className="mx-auto mb-8 max-w-[540px] text-[15px] text-muted-foreground leading-[1.7]">
        跟随 Binance 实时合约行情的高仿真模拟交易平台。使用虚拟资金练习交易策略，掌握合约交易技巧，无需承担真实风险。
      </p>
      <div className="flex justify-center gap-3">
        <Link
          href={`/trade/${DEFAULT_SYMBOL}`}
          className="rounded-[7px] bg-brand px-7 py-3 font-bold text-[14px] text-black transition-colors hover:bg-brand/80"
        >
          开始模拟交易
        </Link>
        <Link
          href="/leaderboard"
          className="rounded-[7px] border bg-elevated px-7 py-3 font-semibold text-[14px] text-foreground transition-colors hover:border-brand/40"
        >
          查看排行榜
        </Link>
      </div>
      {/* 设计稿没有这条；08 H-01 要求给出规则页入口（spec 一·6） */}
      <Link
        href="/rules"
        className="mt-4 inline-block text-[12px] text-muted-foreground transition-colors hover:text-brand"
      >
        和真实交易所有哪些不同 →
      </Link>
    </section>
  );
}
```

- [ ] **Step 7: 写 `stats-bar.tsx`**

```tsx
"use client";

import { Skeleton } from "@binance-contract-trading-full-stack/ui/components/skeleton";

import { useSymbols } from "@/hooks/use-symbols";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { PLACEHOLDER } from "@/lib/format/number";

import { maxLeverageOf } from "./stats";

interface StatItem {
  value: string;
  label: string;
  sub: string;
  loading?: boolean;
}

/**
 * 数据条（Figma 2:366）。设计稿里「模拟交易者 12,483」「最高杠杆 150x」是写死的，
 * 按不编数字的原则：最高杠杆、币对数从 /market/symbols 算，第 4 格换成真实的撮合特性（spec 一·1）。
 */
export function StatsBar() {
  const { data: symbols, isPending } = useSymbols();
  const top = symbols ? maxLeverageOf(symbols) : null;

  const items: StatItem[] = [
    { value: `${INITIAL_BALANCE_DISPLAY} USDT`, label: "初始模拟资金", sub: "虚拟资金，无真实风险" },
    {
      value: top ? `${top.maxLeverage}x` : PLACEHOLDER,
      label: "最高杠杆",
      sub: top ? `${top.baseAsset} 永续合约` : "按币安杠杆分层表",
      loading: isPending,
    },
    {
      value: symbols ? String(symbols.length) : PLACEHOLDER,
      label: "跟踪交易对",
      sub: "主流永续合约",
      loading: isPending,
    },
    { value: "20 档", label: "真实盘口撮合", sub: "市价单逐档成交，限价单模拟排队" },
  ];

  return (
    <section className="mx-auto mb-12 grid max-w-[900px] grid-cols-4 gap-px overflow-hidden rounded-[10px] border bg-border">
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-6 py-5 text-center">
          {item.loading ? (
            <Skeleton className="mx-auto mb-1 h-[33px] w-20" />
          ) : (
            <div className="num mb-1 font-bold text-[22px] text-brand">{item.value}</div>
          )}
          <div className="mb-0.5 font-semibold text-[12px] text-foreground">{item.label}</div>
          <div className="text-[11px] text-muted-foreground">{item.sub}</div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 8: 写 `feature-cards.tsx`**

```tsx
const FEATURES = [
  { icon: "📊", title: "真实行情", desc: "接入 Binance 实时合约数据，价格、资金费率与真实市场完全同步" },
  // 设计稿写「无限次重置」，服务端限制 24 小时一次（RESET_COOLDOWN_MS），按实际改（spec 一·5）
  {
    icon: "⚡",
    title: "零成本练习",
    desc: "使用 10,000 USDT 虚拟资金，可随时重置（每 24 小时一次），没有任何真实资金损失风险",
  },
  { icon: "🏆", title: "排行榜竞技", desc: "与其他模拟交易者同台竞技，展示您的交易技巧，赢得榜单排名" },
] as const;

/** 卖点卡（Figma 2:368） */
export function FeatureCards() {
  return (
    <section className="mx-auto my-12 grid max-w-[900px] grid-cols-3 gap-4">
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className="rounded-[10px] border bg-surface p-6 transition-colors hover:border-brand/40"
        >
          <div aria-hidden className="mb-3.5 text-[28px]">
            {f.icon}
          </div>
          <div className="mb-2 font-bold text-[14px] text-foreground">{f.title}</div>
          <div className="text-[12px] text-muted-foreground leading-[1.7]">{f.desc}</div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 9: 重写 `page.tsx`**

```tsx
import { FeatureCards } from "./_ui-components/feature-cards";
import { HeroSection } from "./_ui-components/hero-section";
import { HotContracts } from "./_ui-components/hot-contracts/hot-contracts";
import { StatsBar } from "./_ui-components/stats-bar";

/** 首页（Figma 2:2）：介绍 → 数据条 → 热门合约 → 卖点。未登录也能看行情 */
export default function HomePage() {
  return (
    <div className="px-10 py-8">
      <HeroSection />
      <StatsBar />
      <HotContracts />
      <FeatureCards />
    </div>
  );
}
```

`ModulePlaceholder` 首页不再用；`components/module-placeholder.tsx` 别的页面还在用，不删。

- [ ] **Step 10: 检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过

- [ ] **Step 11: 浏览器对比**

整页截图，和 `get_screenshot` 取的 `2:2` 并排对比四个区块的宽度、上下间距、字号。数据条第 2 格应显示真实最高杠杆（不是 150x 写死），第 3 格是 19。

---

### Task 5: 登录弹窗外壳 + 钱包 tab + Google tab

**Files:**
- Modify: `packages/ui/src/components/dialog.tsx`（`DialogContent` 加 `overlayClassName`）
- Move + rewrite: `apps/web/src/app/_shared/ui-components/login-dialog.tsx` → `login-dialog/login-dialog.tsx`
- Create: `login-dialog/styles.ts`、`wallet-login.tsx`、`google-login.tsx`
- Create: `apps/web/public/icons/google.svg`（设计稿导出）
- Modify: `app-header/account-entry.tsx`（LoginDialog 的 import 路径）

**Interfaces:**
- Consumes: Task 1 的 `SegmentedTabsList` / `SegmentedTabsTrigger`、`INITIAL_BALANCE_DISPLAY`
- Produces: `PRIMARY_BUTTON`、`SECONDARY_BUTTON`、`INPUT`（类名字符串，Task 6 用）；`LoginDialog()`；`WalletLogin()`；`GoogleLogin()`

- [ ] **Step 1: 取设计稿和图标**

对 `5:6852`（钱包，外壳也按它）、`5:7654`（Google）调 `get_design_context`。Google 那次返回里的 `imgIcon` 是新的临时 URL（7 天过期），下载提交：

```bash
mkdir -p apps/web/public/icons
curl -sSfL "<get_design_context 返回的 imgIcon URL>" -o apps/web/public/icons/google.svg
head -c 200 apps/web/public/icons/google.svg
```

Expected: 输出以 `<svg` 开头。不是 SVG（比如是 PNG）就把文件名改成对应扩展名，下面的 `src` 跟着改。

- [ ] **Step 2: `DialogContent` 支持遮罩样式**

`packages/ui/src/components/dialog.tsx` 的 `DialogContent`：

```tsx
function DialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** 遮罩样式，比如登录弹窗按设计稿要 72% 黑 */
  overlayClassName?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
```

其余不动（这个文件是 shadcn 生成的，保持它原来的无分号风格）。

- [ ] **Step 3: 写 `styles.ts`**

```ts
/** 登录弹窗里三个 tab 共用的样式（Figma 5:6852 / 5:7251 / 5:7654） */

/** 黄色大按钮：连接钱包、Google 登录、确认登录 */
export const PRIMARY_BUTTON =
  "flex w-full items-center justify-center gap-2.5 rounded-md bg-brand p-3.5 font-bold text-[14px] text-black leading-[21px] transition-colors hover:bg-brand/80 disabled:pointer-events-none disabled:opacity-50";

/** 深色描边按钮：发送验证码 */
export const SECONDARY_BUTTON =
  "flex w-full items-center justify-center rounded-md border bg-surface px-3 py-2.5 text-[13px] text-foreground leading-[19.5px] transition-colors hover:border-brand/40 disabled:pointer-events-none disabled:text-muted-foreground";

/** 输入框 */
export const INPUT =
  "h-[42px] w-full rounded-md border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground/50 focus:border-brand aria-invalid:border-down";
```

- [ ] **Step 4: 写 `wallet-login.tsx`**

```tsx
"use client";

import { toast } from "sonner";

import { PRIMARY_BUTTON } from "./styles";

/**
 * L-02 钱包登录（Figma 5:6852）。这次只做样式：Reown AppKit 还没接（要 Project ID），
 * 点了先提示；接入时这里换成「连接钱包 → 签名 → 登录」（docs/frontend/README.md M05）。
 */
export function WalletLogin() {
  return (
    <button type="button" className={PRIMARY_BUTTON} onClick={() => toast.info("钱包登录即将开放")}>
      <span aria-hidden className="text-[18px] leading-[27px]">
        🔗
      </span>
      连接 Web3 钱包
    </button>
  );
}
```

- [ ] **Step 5: 写 `google-login.tsx`**（逻辑从旧 `login-dialog.tsx` 原样搬来）

```tsx
"use client";

import { RETURN_TO_KEY } from "@/lib/config/constants";
import { SERVER_URL } from "@/lib/config/env";

import { PRIMARY_BUTTON } from "./styles";

/** L-04 Google 登录（Figma 5:7654）：整页跳转到服务端 /auth/google，回跳页 /login/callback 取 token */
export function GoogleLogin() {
  const loginWithGoogle = () => {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname + window.location.search);
    } catch {
      // 存不了就回首页
    }
    // 整页跳转走浏览器原生 OAuth 流程，不用弹窗（会被拦截、第三方 cookie 受限）
    window.location.href = `${SERVER_URL}/auth/google`;
  };

  return (
    <button type="button" className={PRIMARY_BUTTON} onClick={loginWithGoogle}>
      {/* 图标是设计稿导出的资源（Figma 5:8042） */}
      <img src="/icons/google.svg" alt="" width={18} height={18} className="size-[18px]" />
      使用 Google 账号登录
    </button>
  );
}
```

- [ ] **Step 6: 挪文件并重写 `login-dialog.tsx`**

```bash
cd apps/web/src/app/_shared/ui-components
mkdir login-dialog
git mv login-dialog.tsx login-dialog/login-dialog.tsx
```

`app-header/account-entry.tsx` 的 import 改成 `import { LoginDialog } from "../login-dialog/login-dialog";`

`login-dialog/login-dialog.tsx` 全文：

```tsx
"use client";

import { Dialog, DialogClose, DialogContent, DialogTitle } from "@binance-contract-trading-full-stack/ui/components/dialog";
import { Tabs, TabsContent } from "@binance-contract-trading-full-stack/ui/components/tabs";

import { SegmentedTabsList, SegmentedTabsTrigger } from "@/components/segmented-tabs";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { useUiStore } from "@/stores/ui-store";

import { EmailLogin } from "./email-login";
import { GoogleLogin } from "./google-login";
import { WalletLogin } from "./wallet-login";

/**
 * L-01 登录弹窗（Figma 5:6852 / 5:7251 / 5:7654）。三种方式各自开户，底部文案说清楚（spec 一·8）。
 * 默认打开邮箱 tab：钱包这次还不能用（spec 一·7）。
 * 弹窗关闭时内容会卸载，邮箱表单和倒计时随之清空，不用手动重置。
 */
export function LoginDialog() {
  const open = useUiStore((s) => s.loginOpen);
  const setOpen = useUiStore((s) => s.setLoginOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/72 supports-backdrop-filter:backdrop-blur-none"
        className="w-[390px] gap-0 rounded-[10px] border bg-elevated p-7 ring-0 sm:max-w-[390px]"
      >
        <div className="flex items-center justify-between">
          <DialogTitle className="font-bold text-[17px] text-foreground leading-[25.5px]">登录 / 注册</DialogTitle>
          <DialogClose
            aria-label="关闭"
            className="text-[20px] text-muted-foreground leading-5 transition-colors hover:text-foreground"
          >
            ×
          </DialogClose>
        </div>
        <Tabs defaultValue="email" className="mt-5 gap-0">
          <SegmentedTabsList>
            <SegmentedTabsTrigger value="wallet">钱包登录</SegmentedTabsTrigger>
            <SegmentedTabsTrigger value="email">邮箱登录</SegmentedTabsTrigger>
            <SegmentedTabsTrigger value="google">Google</SegmentedTabsTrigger>
          </SegmentedTabsList>
          <TabsContent value="wallet" className="pt-[22px]">
            <WalletLogin />
          </TabsContent>
          <TabsContent value="email" className="pt-[22px]">
            <EmailLogin />
          </TabsContent>
          <TabsContent value="google" className="pt-[22px]">
            <GoogleLogin />
          </TabsContent>
        </Tabs>
        <p className="pt-3.5 text-center text-[11px] text-muted-foreground leading-[16.5px]">
          首次登录自动开户并发放 {INITIAL_BALANCE_DISPLAY} USDT；不同登录方式是不同账户
        </p>
      </DialogContent>
    </Dialog>
  );
}
```

这一步会因为 `./email-login` 还不存在而编译失败。先建一个只返回 `null` 的 `email-login.tsx`（`export function EmailLogin() { return null; }`），Task 6 再写完整版。

- [ ] **Step 7: 检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过

- [ ] **Step 8: 浏览器对比**

未登录点「登录 / 注册」，切到钱包和 Google 两个 tab 截图，分别和 `get_screenshot` 取的 `5:6852`、`5:7654` 对比。点「连接 Web3 钱包」出现「钱包登录即将开放」提示；点 Google 按钮跳到 `localhost:3000/auth/google`（能跳就行，不用走完授权）。点 × 或遮罩能关闭。

---

### Task 6: 邮箱验证码登录

**Files:**
- Create: `apps/web/src/app/_shared/ui-components/login-dialog/use-countdown.ts`、`use-countdown.test.ts`
- Modify: `login-dialog/email-login.tsx`（替换 Task 5 的占位）

**Interfaces:**
- Consumes: Task 5 的 `INPUT` / `SECONDARY_BUTTON` / `PRIMARY_BUTTON`；已有 `sendEmailCode(email)`、`verifyEmailCode(email, code): Promise<LoginResult>`、`toApiError(e): ApiError`、`useAuthStore.login(token)`、`useUiStore.setLoginOpen(open)`
- Produces: `remainingSeconds(endsAtMs: number, nowMs: number): number`；`useCountdown(): { seconds: number; running: boolean; start(durationMs: number): void }`

- [ ] **Step 1: 写 `use-countdown.test.ts`（先失败）**

```ts
import { describe, expect, it } from "vitest";

import { remainingSeconds } from "./use-countdown";

describe("remainingSeconds", () => {
  it("刚开始：60 秒", () => {
    expect(remainingSeconds(60_000, 0)).toBe(60);
  });
  it("不足一秒按一秒算（按钮上不会出现 0 秒）", () => {
    expect(remainingSeconds(60_000, 59_001)).toBe(1);
  });
  it("到点和过点都是 0", () => {
    expect(remainingSeconds(60_000, 60_000)).toBe(0);
    expect(remainingSeconds(60_000, 75_000)).toBe(0);
  });
  it("按整秒递减", () => {
    expect(remainingSeconds(60_000, 1_000)).toBe(59);
    expect(remainingSeconds(60_000, 1_500)).toBe(59);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F web test -- use-countdown`
Expected: FAIL，`Cannot find module './use-countdown'`

- [ ] **Step 3: 写 `use-countdown.ts`**

```ts
import { useEffect, useState } from "react";

/** 还剩几秒（向上取整，到点为 0）。按截止时间算而不是每秒减一，页面切到后台定时器变慢也不会走偏 */
export function remainingSeconds(endsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

/** 「59 秒后重新发送」用的倒计时。组件卸载（弹窗关闭）时自动清掉 */
export function useCountdown() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) setEndsAt(null);
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const seconds = endsAt === null ? 0 : remainingSeconds(endsAt, now);

  return {
    seconds,
    running: seconds > 0,
    start(durationMs: number) {
      const t = Date.now();
      setNow(t);
      setEndsAt(t + durationMs);
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F web test -- use-countdown`
Expected: PASS（4 条）

- [ ] **Step 5: 取设计稿**

对 `5:7251` 调 `get_design_context`（输入框高 41.5、按钮间距 10、确认按钮 11px 内边距）。「设置昵称」输入框按 spec 一·9 不做。

- [ ] **Step 6: 写 `email-login.tsx`**

```tsx
"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { toApiError } from "@/lib/axios-client/api-error";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { sendEmailCode, verifyEmailCode } from "@/server-api-module/auth/mutations";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";
import { useCountdown } from "./use-countdown";

/** 重新发送的间隔，和服务端的发送频率限制一致（60 秒） */
const RESEND_MS = 60_000;
const CODE_LENGTH = 6;
const emailSchema = z.email();

/**
 * L-03 邮箱验证码登录（Figma 5:7251）：邮箱 → 发送验证码（60 秒倒计时）→ 6 位验证码 → 确认登录。
 * 前端只自己判断邮箱格式；频率限制、验证码错误（含剩余次数）、过期都显示服务端的中文 message。
 */
export function EmailLogin() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  /** 验证码发到了哪个邮箱。发完再改输入框，登录仍用这个，避免拿 A 的码去登 B */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const countdown = useCountdown();
  const login = useAuthStore((s) => s.login);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  const canSubmit = sentTo !== null && code.length === CODE_LENGTH && !submitting;

  const send = async () => {
    const target = email.trim();
    if (!emailSchema.safeParse(target).success) {
      setEmailError("邮箱格式不正确");
      return;
    }
    setEmailError(null);
    setError(null);
    setSending(true);
    try {
      await sendEmailCode(target);
      setSentTo(target);
      countdown.start(RESEND_MS);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || sentTo === null) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await verifyEmailCode(sentTo, code);
      await login(result.token);
      if (result.account.isNew) toast.success(`开户成功，已发放 ${INITIAL_BALANCE_DISPLAY} USDT 模拟资金`);
      setLoginOpen(false);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const sendLabel = sending
    ? "发送中…"
    : countdown.running
      ? `${countdown.seconds} 秒后重新发送`
      : sentTo
        ? "重新发送验证码"
        : "发送验证码";

  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit} noValidate>
      <div>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="请输入邮箱地址"
          aria-label="邮箱地址"
          aria-invalid={emailError ? true : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
          className={INPUT}
        />
        {emailError && <p className="mt-1 text-[12px] text-down">{emailError}</p>}
      </div>
      <button type="button" className={SECONDARY_BUTTON} disabled={sending || countdown.running} onClick={send}>
        {sendLabel}
      </button>
      {sentTo && (
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={`请输入 ${CODE_LENGTH} 位验证码`}
          aria-label="验证码"
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          className={cn(INPUT, "num tracking-[0.3em]")}
        />
      )}
      {error && (
        <p role="alert" className="text-[12px] text-down">
          {error}
        </p>
      )}
      <button type="submit" className={cn(PRIMARY_BUTTON, "p-[11px]")} disabled={!canSubmit}>
        {submitting ? "登录中…" : "确认登录"}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: 检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过

- [ ] **Step 8: 真实服务端走一遍登录**

服务端开发环境不真的发邮件，验证码打在日志里。浏览器：打开登录弹窗 → 邮箱 tab → 先输入 `abc` 点发送，应提示「邮箱格式不正确」且没有请求（看 network）→ 改成一个测试邮箱（如 `m05-test@example.com`）点发送 → 按钮变「60 秒后重新发送」并每秒减 → 从 dev:server 的后台输出里找到验证码 → 先故意输错一次，应显示服务端的中文错误（含剩余次数）→ 输对 → 弹窗关闭；第一次用这个邮箱会出现开户 Toast。

登录后顶栏变成头像 + 名字，截图和 `get_screenshot` 取的 `5:8055` 右侧对比；点开菜单能看到余额，点「退出登录」回到未登录。

---

### Task 7: 全量检查与文档

**Files:**
- Modify: `docs/frontend/README.md`（M01、M02、M05 的勾选状态）
- Modify: `docs/design/08-frontend-pages.md`（G-01 导航文案、G-05 触发器、L-01 标题和底部文案、H-01 数据条）
- Modify: `HANDOFF.md`（第一节进度表加一行）

- [ ] **Step 1: 全量检查**

Run: `pnpm -F web test && pnpm -F web check-types && pnpm -F web lint`
Expected: 全部通过；测试条数 = 26（原有）+ 4 + 7 + 5 + 4 + 4 = 50

- [ ] **Step 2: 查依赖方向**

```bash
grep -rnE "from \"@/(app|stores|server-api-module)" apps/web/src/components/
```

Expected: 没有输出（通用组件没有引用业务层）

- [ ] **Step 3: 更新 `docs/frontend/README.md`**

- M01 功能点加：`- [x] 顶栏按设计稿还原（Figma 2:6 / 5:8055），导航：首页 · 交易 · 订单 · 排行榜 · 规则；交易页行情插槽（M02 接）`
- M02：首页列表那一项后面加「（热门合约，按 24h 成交额排序，Figma 2:367）」；新增 `- [x] 首页介绍区、数据条、卖点卡（Figma 2:2）`
- M05：`邮箱登录` 改成 `[x]`；`新用户（isNew）首次登录给一个欢迎提示` 改成 `[x]`；`账户菜单` 这一项后面加「（样式和余额已做，菜单项等 M06）」；钱包登录保持 `[ ]`，后面加「（样式已做，点击提示即将开放）」
- 模块总览表 M05 状态保持 🟡

- [ ] **Step 4: 更新 `docs/design/08-frontend-pages.md`**

- G-01 表格「中」一行改成：`主导航：首页 · 交易 · 订单 · 排行榜 · 规则（当前页高亮）`；「左」改成 `Logo「合约模拟盘」+「模拟交易·虚拟资金」标签`
- G-05 触发器改成：`头像（昵称首字母）+ 昵称；余额放在菜单里`
- L-01 标题改成「登录 / 注册」，删掉副标题，加一句：`底部说明：首次登录自动开户并发放 10,000 USDT；不同登录方式是不同账户`
- H-01 加一行：`数据条：初始资金 · 最高杠杆（从币对规格算）· 跟踪交易对数 · 20 档真实盘口撮合`

- [ ] **Step 5: 更新 `HANDOFF.md`**

第一节进度表「前端 · 模块化推进」下面加一行：

```
| 前端 · 首页 / 顶栏 / 登录弹窗 | 🟡 2026-09-19 AI 按 Figma 还原：顶栏（2:6 / 5:8055）、首页四个区块（2:2）、登录弹窗三个 tab；邮箱验证码登录做通；钱包只做样式（等 Reown Project ID）。设计文档 `docs/superpowers/specs/2026-09-19-home-header-login-design.md`，计划 `docs/superpowers/plans/2026-09-19-home-header-login.md`；**未 commit** |
```

- [ ] **Step 6: 交给用户验收**

把首页、顶栏（未登录 / 已登录）、登录弹窗三个 tab 的截图和对应设计稿截图发给用户，列出和设计稿不同的地方（只能是 spec 一 里的 9 条）。等用户说「提交」再 commit。
