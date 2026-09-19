# 首页 · 全站顶栏 · 登录弹窗 设计

> 日期：2026-09-19
> 覆盖模块：M01（G-01 顶栏）、M02（H-01 / H-02 首页）、M05（L-01～L-04 登录弹窗，钱包只做样式）
> 页面编号见 `docs/design/08-frontend-pages.md`，功能清单见 `docs/frontend/README.md`

## 设计稿

设计文件 fileKey：`tEjxTvnW0drLCL1w4ygMgo`（下表节点都在这个文件里）。

| 部分 | 节点 | 用在哪个组件 |
| --- | --- | --- |
| 首页整页 | `2:2` | `(home)/page.tsx` 整体间距 |
| 顶栏 · 未登录 | `2:6` | `app-header/*` |
| 顶栏 · 已登录 | `5:8055`（头像 + 昵称 `5:8093`） | `account-entry.tsx` |
| H-01 介绍区 | `2:365` | `hero-section.tsx` |
| 数据条 | `2:366` | `stats-bar.tsx` |
| H-02 热门合约 | `2:367` | `hot-contracts/*` |
| 卖点卡 | `2:368` | `feature-cards.tsx` |
| 钱包登录 | `5:6852` | `login-dialog.tsx` 外壳 + `wallet-login.tsx` |
| 邮箱登录 | `5:7251` | `email-login.tsx` |
| Google 登录 | `5:7654`（图标在按钮 `5:8041` 里） | `google-login.tsx` |

辅助参考：Figma Make `wwAWi4IZWhobYR4oMYQRgz` 的 `src/pages/HomePage.tsx`、`src/App.tsx`（悬停效果、网格列宽这些静态稿看不出来的交互细节）。

### 样式还原的做法（每个组件都要走一遍）

1. **动手前**：对该组件对应的节点调 Figma MCP `get_design_context`（先加载 `figma:figma-design-to-code` skill），拿参考代码和截图
2. **转换**：参考代码只当参考。颜色换成 `packages/ui/src/styles/globals.css` 的 token（`#161a1e` → `bg-surface`，`#0ecb81` → `text-up`，`#2b3139` → `border` 等），不写十六进制；按钮、Tabs、Dialog 用 `packages/ui` 的组件换样式；字号、字重、行高、间距、圆角按设计稿的数值写；`1.272px` 这类边框是缩放误差，统一 1px
3. **图标和图片**：用设计稿导出的资源，下载下来提交进 `apps/web/public/`，不自己画 SVG
4. **做完后**：浏览器截图，和 `get_screenshot` 拿到的设计稿截图并排对比，差异修完再进下一个组件

下面「一」里列的差异是用户定过的，以这里为准；其它地方都以设计稿为准，这份文档里写的尺寸如果和设计稿对不上，按设计稿来。

---

## 一、和设计稿不一样的地方（2026-09-19 用户已定）

| # | 设计稿 | 实现 | 原因 |
| --- | --- | --- | --- |
| 1 | 数据条「模拟交易者 12,483」「最高杠杆 150x」写死 | 最高杠杆、币对数量从 `/market/symbols` 算；第 4 格换成「20 档 · 真实盘口撮合」 | 不编数字（`CLAUDE.md` 原则） |
| 2 | 已登录顶栏只有头像 + 昵称 | 头像 + 昵称作为下拉菜单的触发器，菜单里保留余额、身份、退出登录；连接状态缩成小圆点放在头像左边 | 保留已经做好的功能 |
| 3 | 热门合约 6 行 | 全部 19 个，按 24h 成交额降序 | 首页是看所有币对的入口 |
| 4 | 交易页顶栏显示最新价 + 涨跌幅 | 只留插槽，数据等 M02 行情条一起做 | 控制范围 |
| 5 | 卖点卡「无限次重置」 | 「可随时重置（每 24 小时一次）」 | 服务端 `RESET_COOLDOWN_MS` = 24 小时 |
| 6 | 介绍区没有规则链接 | 按钮下面加「和真实交易所有哪些不同 →」跳 `/rules` | `08` H-01 的要求 |
| 7 | 钱包登录按钮 | 只做样式，点了用 Toast 提示「钱包登录即将开放」 | Reown AppKit 还没装，Project ID 还没申请；功能另做 |
| 8 | 底部「登录即代表同意《用户服务协议》及《隐私政策》」 | 「首次登录自动开户并发放 10,000 USDT；不同登录方式是不同账户」 | 项目里没有这两份协议；`08` L-01 要求说清楚各自开户 |
| 9 | 邮箱 tab 有「设置昵称（可选）」 | 去掉 | 登录接口不收昵称；改昵称放在 M06 |
| 10 | 热门合约的最新价、资金费率、头像按涨跌 / 正负着色 | 只有「24h 涨跌」着色；最新价、标记价、资金费率、成交额都是白色 | 用户 2026-09-19 定（参照币安列表） |
| 11 | 币对头像是两个字母 | 币种图标：`@web3icons/core`（MIT）的 19 个 SVG，放 `apps/web/public/icons/coins/`；没有图标的币种显示字母头像 | 用户 2026-09-19 定。先试过币安网页版资产接口，但币安图片 CDN 有防盗链（带我们域名的 Referer 返回 403），改用开源图标 |

---

## 二、全站顶栏（G-01）

高 48px，背景 `bg-surface`，底边一条 `line`，左右内边距 16px。从左到右：

1. **Logo**：26px 黄色圆角方块写「M」+「合约模拟盘」（14px 粗体）+ 小标签「模拟交易·虚拟资金」（10px，黄字，14% 透明度的黄底）。点击回首页
2. **主导航**：首页 `/` · 交易 `/trade/BTCUSDT` · 订单 `/orders` · 排行榜 `/leaderboard` · 规则 `/rules`
   - 当前页：`bg-elevated` 底块 + 主色文字 + 半粗；其它：灰字，悬停变亮
   - 高亮规则：首页只在 `/` 完全匹配时高亮，其它按路径前缀匹配
3. **行情插槽**：`AppHeader` 接收一个可选的 `ticker` 位置，这次为空（M02 放交易页的最新价和涨跌幅）
4. **右侧**：
   - 连接状态：8px 小圆点（绿 = 已连接；黄且闪烁 = 连接中 / 重连中），悬停提示显示文字
   - 登录态还在校验：骨架（保持现有行为，不闪一下登录按钮）
   - 未登录：黄色「登录 / 注册」小按钮（12px 粗体），打开登录弹窗
   - 已登录：26px 圆形头像（`bg-elevated` 底、描边、黄色首字母）+ 灰色昵称；点开下拉菜单：身份行、余额 `xx USDT`、修改昵称 / 持仓模式 / 重置（仍然禁用，等 M06）、退出登录
   - 昵称为空时用登录标识的缩写（沿用 `shortId`）；头像取显示名的第一个字符并转大写

---

## 三、首页

整页在 `main` 里滚动，外边距 32px 40px。

### H-01 介绍区（最大宽 900，居中）

- 胶囊标签：黄色小圆点 +「模拟交易 · 虚拟资金 · 零风险体验」
- 标题「合约模拟盘」44px 超粗
- 介绍文字（15px 灰）：跟随 Binance 实时合约行情的高仿真模拟交易平台……（照设计稿）
- 按钮：「开始模拟交易」（主按钮）→ `/trade/BTCUSDT`；「查看排行榜」（次要按钮）→ `/leaderboard`
- 链接：「和真实交易所有哪些不同 →」→ `/rules`

### 数据条（4 等分，1px 分隔线）

| 值 | 标题 | 副标题 | 来源 |
| --- | --- | --- | --- |
| 10,000 USDT | 初始模拟资金 | 虚拟资金，无真实风险 | 常量 |
| `{max}x` | 最高杠杆 | `{BTC} 永续合约` | symbols 里 `maxLeverage` 最大的那个 |
| `{n}` | 跟踪交易对 | 主流永续合约 | `symbols.length` |
| 20 档 | 真实盘口撮合 | 市价单逐档成交，限价单模拟排队 | 常量 |

symbols 还在加载时，第 2、3 格显示骨架；出错时显示 `--`。

### H-02 热门合约（最大宽 1100）

- 标题行：「热门合约」18px 粗 + 右侧灰字「实时行情 · 自动刷新」
- 表格：`bg-surface`、圆角 10、1px 边框；7 列 `1.2fr 1fr 1fr 1fr 1fr 1fr 120px`
- 列：币对 · 最新价 · 24h 涨跌 · 标记价 · 资金费率 · 24h 成交额 · 操作

| 列 | 展示 | 颜色 |
| --- | --- | --- |
| 币对 | 28px 圆形头像（`baseAsset` 前两个字母）+ `BTC/USDT`（13px 半粗）+「永续」（11px 灰） | 头像按 24h 涨跌：涨绿底 15% / 跌红底 12% |
| 最新价 | `formatPrice`，13px 半粗 | 按 24h 涨跌 |
| 24h 涨跌 | `formatPercentValue`，带正负号 | 按 24h 涨跌 |
| 标记价 | `formatPrice` | 灰 |
| 资金费率 | `formatRatioAsPercent` 4 位，带正负号 | 按正负 |
| 24h 成交额 | `formatCompact` + ` USDT`，悬停 `title` 显示精确值 | 灰 |
| 操作 | 黄色「交易」小按钮 → `/trade/{symbol}` | — |

- 整行可点，悬停 `bg-elevated`；「交易」按钮是 `Link`，点它不重复触发整行跳转
- 数字列 `num`（等宽、`tabular-nums`）
- **排序**：按 `stats24h.quoteVolume` 降序，用 bigint 比较；`stats24h` 为 `null` 的排最后，并列时按 symbol 字母序。24h 数据只在进页面时取一次（缺口 #47），排序只在这份数据变化时重算，所以行不会跳
- 加载中：6 行骨架；出错：显示 `error.message`
- 取不到的值显示 `--`（`formatXxx` 已处理）

### 卖点卡（3 列，最大宽 900）

真实行情 / 零成本练习 / 排行榜竞技，文案照设计稿，只把「无限次重置」改成「可随时重置（每 24 小时一次）」。悬停时边框变成 40% 透明度的黄色。

---

## 四、登录弹窗（L-01～L-04）

外壳：宽 390，内边距 28，`bg-elevated`，圆角 10，1px 描边，遮罩黑色 72%。

- 头部：「登录 / 注册」17px 粗 + 右侧 ×
- 分段式 tab（`bg-surface` 底，内边距 3px）：钱包登录 · 邮箱登录 · Google；选中的是 `bg-elevated` 底 + 描边 + 主色文字。默认选中「邮箱登录」
- 底部灰字 11px 居中：「首次登录自动开户并发放 10,000 USDT；不同登录方式是不同账户」

### 钱包 tab
黄色大按钮「🔗 连接 Web3 钱包」（14px 粗，内边距 14）。点击 → `toast.info("钱包登录即将开放")`。

### 邮箱 tab

```
[ 请输入邮箱地址            ]
[ 发送验证码 / 59 秒后重新发送 ]   ← 次要按钮样式
[ 请输入 6 位验证码          ]   ← 发送成功后才出现
（错误提示行，红字 12px）
[        确认登录            ]   ← 主按钮
```

- 邮箱格式前端先校验（zod `email()`），不对就在输入框下提示，不发请求
- 发送：调 `sendEmailCode`；成功后开始 60 秒倒计时，倒计时期间按钮禁用；失败显示 `ApiError.message`
- 验证码：只收数字，最多 6 位，`inputMode="numeric"`、`autoComplete="one-time-code"`
- 确认登录：没发过验证码或不满 6 位时禁用；提交中禁用 + 文案「登录中…」；调 `verifyEmailCode` → `authStore.login(token)` → 关闭弹窗
- 服务端错误（频率限制、验证码错误 + 剩余次数、过期）原样显示 `ApiError.message`
- `isNew === true`：`toast.success("开户成功，已发放 10,000 USDT 模拟资金")`
- 关闭弹窗时重置表单和倒计时

### Google tab
黄色大按钮 + 18px Google 图标 +「使用 Google 账号登录」。点击走现有的 `loginWithGoogle`（先存回跳地址，再整页跳转），逻辑不改。图标用设计稿导出的 SVG，存成 `apps/web/public/icons/google.svg` 并提交。

---

## 五、组件拆分

```
apps/web/src/
├─ components/                                 通用组件：只接收 props
│  ├─ letter-avatar.tsx                        字母圆头像，变体 tone: up | down | brand
│  ├─ direction-text.tsx                       按 direction(value) 着色：up 绿 / down 红 / flat 灰
│  └─ segmented-tabs.tsx                       分段式 tab（基于 packages/ui 的 Tabs 换样式）
│
├─ lib/config/constants.ts                     + INITIAL_BALANCE_DISPLAY = "10,000"
│
├─ app/_shared/ui-components/
│  ├─ app-header/
│  │  ├─ app-header.tsx                        组装 + 行情插槽
│  │  ├─ brand-logo.tsx
│  │  ├─ main-nav.tsx                          NAV 配置 + isActive(pathname, item)
│  │  ├─ nav-match.ts / nav-match.test.ts      高亮规则（纯函数）
│  │  ├─ account-entry.tsx                     从上层目录挪进来，换样式
│  │  └─ connection-indicator.tsx              从上层目录挪进来，改成小圆点
│  └─ login-dialog/
│     ├─ login-dialog.tsx                      外壳 + tab + 底部说明
│     ├─ wallet-login.tsx
│     ├─ email-login.tsx
│     ├─ google-login.tsx
│     └─ use-countdown.ts / use-countdown.test.ts
│
└─ app/(home)/
   ├─ page.tsx                                 只负责拼装（服务端组件）
   └─ _ui-components/
      ├─ hero-section.tsx
      ├─ stats-bar.tsx
      ├─ stats.ts / stats.test.ts              maxLeverageOf(symbols)
      ├─ feature-cards.tsx
      └─ hot-contracts/
         ├─ hot-contracts.tsx                  标题 + 表格外壳 + 骨架 / 错误
         ├─ contract-row.tsx                   单行，只订阅自己那个币对的 ticker
         └─ sort-by-volume.ts / .test.ts
```

删除：`app/(home)/_ui-components/symbol-market-list.tsx`、`app/_shared/ui-components/{app-header,account-entry,connection-indicator,login-dialog}.tsx`（移到子目录，用 `git mv` 保留历史）。

依赖方向不变：`components/` 不 import `app/`、`stores/`、`server-api-module/`。

---

## 六、数据流

- 首页：`useSymbols()`（React Query，10 分钟）+ `useTickers(symbols)`（REST 首屏 + WS `ticker:*`）→ `market-store.tickers`
- 排序：`HotContracts` 用 `useMarketStore` 读每个币对的 `stats24h?.quoteVolume`，拼成排序键字符串传给 `useMemo`，这份数据不变就不重算
- 每行 `ContractRow` 用 selector 只订 `s.tickers[symbol]`，一条推送只重渲染一行
- 顶栏：`auth-store`（status / me）、`account-store`（余额）、`wsClient.onStatus`（连接状态）

## 七、错误和边界

- symbols 接口失败：数据条第 2、3 格显示 `--`，表格显示错误文字
- ticker 缺失或 `stats24h === null`：对应格子显示 `--`，该行排到最后
- 邮箱登录：全部错误文案来自服务端，前端只自己写「邮箱格式不正确」一条
- 行情降级不影响首页浏览（全站横幅由 `MarketStatusBanner` 负责，这次不改）

## 八、测试与验收

**单元测试（Vitest）**
- `sort-by-volume`：降序、null 排最后、并列按字母序、大数值（超过 2^53）比较正确
- `stats`：最高杠杆取最大值和对应币对；空数组
- `nav-match`：`/` 只匹配首页；`/trade/ETHUSDT` 高亮「交易」
- `use-countdown`：开始、每秒减一、到 0 停止、重置（用 fake timers）

**检查**：`pnpm -F web test`、`pnpm -F web check-types`、`pnpm -F web lint` 全过

**浏览器验收**（dev server；每一项都和对应节点的 `get_screenshot` 并排对比）
- 首页未登录：顶栏、介绍区、数据条、19 行热门合约按成交额排序且价格在跳、卖点卡
- 登录弹窗三个 tab 的样子
- 邮箱登录走真实服务端：发验证码（从 server 日志取码）→ 登录 → 顶栏变成头像 + 昵称，下拉菜单能看到余额，能退出
- 进 `/trade/BTCUSDT`：导航「交易」高亮

## 九、不在这次范围

- 钱包登录功能（Reown AppKit）
- 交易页顶栏行情（M02）
- 账户菜单里的修改昵称 / 持仓模式 / 重置（M06）
- 首页可视区域外的行不订阅推送（M02 可选项）
