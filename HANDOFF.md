# 会话交接说明

> 给接手这个项目的 Claude Code（或任何人）。
> 生成时间：2026-09-15 ｜ 来源：Claude 桌面端 Cowork 会话

---

## 一、目前走到哪了

**数据库层已完成，引擎内核开始搭建。教程按模块一讲一讲写，总览和进度见 `docs/tutorial/README.md`。**

| 阶段 | 状态 |
| --- | --- |
| 需求探讨与技术决策 | ✅ 完成 |
| 设计文档 | ✅ 完成，7 份在 `docs/design/`（已含邮箱 / Google 登录，14 张表版本） |
| 第 01 讲 · 数据库层 | ✅ 用户已完成：`packages/shared` + 12 张表 + 种子/对账脚本；分层表由 `fetch:brackets` 从币安拉取，20 个币对已导入 |
| 第 02 讲 · 引擎骨架与测试脚手架 | 📝 讲义已写（`docs/tutorial/02-engine-skeleton.md`），代码在隔离 worktree 里逐个检查点验证过，等用户动手 |
| 第 03–09 讲 · 引擎内核 | ⬜ 只有大纲（见教程 README），每讲等用户完成上一讲后，读其实际代码再写 |
| 第 10–14 讲 · 服务端 | ⬜ 只有大纲 |
| 前端 | 不出教程——`apps/web` 由 AI 直接实现 |
| 表结构 12 → 14 张（`identities` / `email_verification_codes`） | ⬜ 放在第 12 讲鉴权里做迁移，不挡引擎 |

**写下一讲之前必看**：`docs/tutorial/README.md` 的"设计缺口清单"。其中第 6 条（逐仓保证金算不算在钱包余额里）设计文档前后矛盾，**第 05 讲开工前必须跟用户定下来**，它决定开仓时要不要写流水。

> **本节踩过的一个坑，供参考**：上一位接手者一开始把"M0 地基"理解成"AI 直接写代码"，写了一份完整的实现计划（`docs/superpowers/plans/2026-09-15-m0-foundation.md`）。用户确认后发现本意是"数据库/后端两层用户自己动手，AI 写教程带路，前端才是 AI 直接写"，于是那份计划改成了仅供参考（教程内容是从它转写的，代码经过和设计文档核对，可以放心抄），真正要跟的是 `docs/tutorial/01-database.md`。**如果又看到类似"AI 要不要直接写数据库/后端代码"的模糊指令，先跟用户确认这一点，别想当然直接开始写实现。**

---

## 二、先读什么

```
docs/design/
├── README.md                索引 + 五条贯穿原则          ← 从这里开始
├── 00-overview.md           定位、边界、技术决策定稿表
├── 01-domain-knowledge.md   合约业务基础（概念 + 算例）
├── 02-architecture.md       ★ 系统架构总纲              ← 最重要
├── 03-database-design.md      ├─ 数据库子设计
├── 04-backend-design.md       ├─ 后端子设计（最长，1180 行）
├── 05-frontend-design.md      ├─ 前端子设计
└── 06-testing-design.md       └─ 测试子设计
```

仓库根的 `CLAUDE.md` 是常驻约束，每次开工都会读到。

**⚠️ 两个陷阱**

1. `docs/books-tutorial.md` 和 `docs/db-notes.md` 是早前跑通全栈链路的**练手记录**，和本项目业务无关。别照着它们建表。
2. 工作区有一堆未提交的改动（见第三节），都属于那条 books 练手链路，不是本项目的代码。

---

## 三、仓库现状

分支 `main`，只有一个 commit（`initial commit`）。工作区未提交的改动：

```
 M apps/server/package.json          books 练手：加 drizzle-orm 依赖
 M apps/server/src/index.ts          books 练手：挂载 /books 路由
 M apps/web/src/components/header.tsx books 练手：加导航入口
 M package.json / turbo.json / pnpm-workspace.yaml   books 练手：catalog 加 drizzle-orm
 M packages/db/src/index.ts          books 练手：透出 schema
 M packages/db/src/schema/index.ts   books 练手：导出 books
?? apps/server/src/routers/          books 练手：路由
?? apps/web/src/app/books/           books 练手：页面
?? apps/web/src/lib/                 books 练手：api 封装
?? packages/db/src/schema/books.ts   books 练手：表定义
?? packages/db/src/migrations/       books 练手：迁移
?? docs/                             本项目的设计文档（保留）
```

**建议先处理这件事**：把 books 练手那部分单独 commit 掉（或删掉），再开始本项目的代码。现在混在一起，后面 diff 会很难看。

技术栈：Better-T-Stack 脚手架 —— Next.js 16 + React 19 + Hono + Drizzle + Supabase Postgres + Turborepo + pnpm 11 catalog。Node v22.23.2。脚手架的 `api` 和 `auth` 都是 `none`，所以前后端走 Hono 接口 + fetch，鉴权要自己实现。

---

## 四、已验算的数值（可直接抄成测试用例）

这些数字都用脚本独立复算过，误差为 0：

| 项 | 值 | 验证方式 |
| --- | --- | --- |
| 强平价 A · 逐仓多（EP 50,000，1 BTC，10x，保证金 5,000） | **45,180.72** | 反算：权益 180.7229 = 维持保证金 180.7229 |
| 强平价 B · 逐仓空（同上做空） | **54,780.88** | 反算：权益 219.1235 = 维持保证金 219.1235 |
| 强平价 C · 全仓多（钱包 10,000，其余同 A） | **40,160.64** | 反算：权益 160.6426 = 维持保证金 160.6426 |
| BTCUSDT 十层分层表 | 9 个边界 | 相邻两层在边界上的维持保证金两两相等 |
| 市价逐档吃 5 BTC | 均价 **50,000.4**，滑点 0.4 | 加权平均 |
| 加仓均价（1@50,000 + 1@52,000） | **51,000** | |
| 完整资金流水 | 净收益 **+1,959.5**，ROE **+39.19%**，摩擦 40.5 | 逐笔累加 |
| 拟真排队推演 | 3.0 → 1.8 →（夹逼）1.5 → 0.7 → 成交 0.5 | Maker 费 4.99 |

> 强平价那三条**一定要连反算一起写进测试**。只断言结果的话，公式抄错而期望值也写成错的，测试会一直绿。反算是独立于公式的第二条路径。

---

## 五、下一步

按 `数据库 → 后端 → 前端` 的顺序搭。前两层用户想自己一步步做，前端交给 AI。

### M0 地基（第一步）

1. 建 `packages/shared`，写 `fixed.ts`（定标 1e8、`parse`/`format`、`mul`/`div`、五种舍入）
2. 建 `packages/engine` 骨架 + `types.ts`（`EngineInput` / `EngineEvent`，签名见 `02-architecture.md` 第六节）
3. `packages/db` 建 12 张表（结构逐字段见 `03-database-design.md`）
4. 人工整理 20 个币对的杠杆分层表 JSON
   ⚠️ **必须从币安页面人工核对，不要凭记忆生成**。生成错了会导致所有强平价系统性偏差，而连续性校验只能查出内部不连续，查不出整体抄错一档。
5. 写四个脚本：`seed:symbols`、`seed:brackets`、`verify:brackets`、`reconcile:ledger`

**M0 验收**：`db:push` 后库里有 20 个币对的规格和分层表，`verify:brackets` 全过，`fixed.ts` 单测全绿。

### 一条建议

`06-testing-design.md` 第 4 节那七条不变式，**在写第一行业务代码之前就写好**。一个小时能写完，但从第一天起就替你盯着最危险的那类错误（尤其是"改了余额没写流水"）。等发现账目对不上再回头加，那时候历史数据已经是一团乱麻。

---

## 六、这个项目的性格

用户明确说过：**宁可说做不到，不要编数字。**

- 市价单吃穿 20 档深度 → 拒单，不按"最后一档 + 滑点惩罚"硬成交
- 行情断线 → 暂停撮合，恢复后不补算
- 跨层杠杆超限 → 拒单，不学币安自动降杠杆（那会悄悄改用户的强平价）
- 账户重置 → 走正常平仓流程再设回 10,000，不直接改余额（为了保住"余额 == 流水之和"）

`02-architecture.md` 第九节列了 10 条已知失真点。**做任何改动前对一下那张表**，如果改动会让某条变得更不诚实，就不该做。

---

## 七、还没定的事

| 事项 | 状态 |
| --- | --- |
| VPS 选型与开通 | 未开始。必须在**能直连 `fapi.binance.com`** 的海外区域（日/新/韩），上线前先 `curl https://fapi.binance.com/fapi/v1/time` 验证 |
| Supabase 项目 | 复用 books 练手那个还是新建，未定 |
| 前端 UI 设计稿 | 用户说交给 Figma 做，尚未产出 |
| 域名与 TLS | 未开始（浏览器 WSS 要求 https 来源） |
