# apps/web

币安合约模拟盘前端。设计见 `docs/design/05-frontend-design.md`（技术选型在第 0 节），页面模块清单见 `docs/design/08-frontend-pages.md`。

## 首次准备：TradingView Charting Library

K 线用 TradingView Charting Library（公司授权，**不进 git**）。拿到授权包后把 `charting_library/` 整个目录放到：

```
apps/web/public/charting_library/
├── charting_library.standalone.js
├── charting_library.d.ts
├── datafeed-api.d.ts
└── bundles/
```

## 命令

```bash
pnpm run dev:web          # 在仓库根目录：前端 :3001（服务端先 pnpm run dev:server 起在 :3000）
pnpm -F web test          # Vitest
pnpm -F web lint          # Biome 检查（format 自动修）
pnpm -F web check-types   # 先生成路由类型再 tsc
```

## 目录

```
src/
├── app/                        业务模块：一个页面模块一个目录（page / layout + 自己的组件）
│   ├── _shared/ui-components/  多个模块共用的业务组件（顶栏、登录弹窗、强平弹窗……）
│   ├── (home)/                 首页 /（路由组，不进 URL）
│   ├── trade/                  交易页 /trade、/trade/[symbol]
│   ├── orders/ · leaderboard/ · rules/ · login/callback/
│   └── <模块>/_ui-components/  只有这个模块用的组件
├── components/                 通用组件，不认识具体业务，只吃 props
├── hooks/                      跨模块的组合逻辑：use-symbols · use-symbol-market
├── server-api-module/          服务端接口，按服务端路由分模块
│   ├── common/types.ts         Decimal、Page、shared 枚举
│   └── market · auth · account · order · position · leaderboard/
│       ├── queries.ts          GET：请求函数 + queryKey + queryOptions
│       ├── mutations.ts        POST / DELETE 请求函数
│       ├── subscriptions.ts    WS 频道名 + 带类型的监听函数
│       └── types.ts            DTO，逐字段注释
├── lib/                        和业务无关的通用能力
│   ├── axios-client/           axios 实例、拆包络、ApiError
│   ├── ws-client/              WS 连接层（partysocket）+ 协议层 + 全局实例
│   ├── session/                token 存取
│   ├── query/                  QueryClient 默认配置
│   ├── format/                 数值（bigint）/ 时间展示格式化
│   └── config/                 服务端地址、常量
├── providers/                  React Query、主题、ws-bridge（WS ↔ store 的接线）
└── stores/                     Zustand：market / account / auth / ui
```

依赖方向（单向）：`app/<模块>` → `app/_shared` → `components`；以上 → `hooks` → `stores` → `server-api-module` → `lib`。
模块之间不互相 import `_ui-components`，两个模块都要用就挪进 `app/_shared/`。完整约定见 `docs/frontend/directory-structure.md`。

分工：**React Query 只管 REST**（币对规格、历史类数据、排行榜）；**实时数据在 Zustand**（盘口、ticker、余额、仓位、挂单）；K 线由图表库的 Datafeed 自己管。
