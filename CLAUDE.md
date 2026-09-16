# CLAUDE.md

币安 U 本位合约**实时模拟交易平台**。
用币安真实实时行情，跑一套我们自己实现的账户、撮合、风控、清算逻辑。
**不产生任何真实下单**，USDT 由本地服务模拟发放。
唯一用到的币安 API Key 是**只读** Key，只在服务端用来同步杠杆分层表（`packages/db/src/brackets/`），绝不下发到前端。

---

## 开工前必读

设计文档在 `docs/design/`，**动手前先读 `README.md` 和 `02-architecture.md`**。

| 要做的事 | 先读 |
| --- | --- |
| 了解项目全貌与决策 | `docs/design/00-overview.md` |
| 不懂合约业务概念 | `docs/design/01-domain-knowledge.md` |
| 架构、精度、分层、持久化 | `docs/design/02-architecture.md` ★ |
| 建表、索引、迁移、种子 | `docs/design/03-database-design.md` |
| 行情、引擎、公式、撮合、接口 | `docs/design/04-backend-design.md` |
| 页面、状态、实时更新 | `docs/design/05-frontend-design.md` |
| 测试、不变式、压测、演练 | `docs/design/06-testing-design.md` |

`docs/books-tutorial.md` 和 `docs/db-notes.md` 是早前跑通全栈链路的练手记录，**和本项目业务无关**，不要照着它们建表。

---

## 五条硬约束

1. **金额、价格、数量一律 `bigint` 定标 1e8**
   禁止 `number` 参与金额运算，禁止 `parseFloat` / `Number()` / `toFixed()` 出现在计算路径上。
   例外：`leverage`（整数倍数）、数组下标、时间戳、计数器。

2. **`packages/engine` 必须是纯的**
   不许 import 数据库/网络/文件系统，不许 `Date.now()`、`Math.random()`、`console.*`、`setTimeout`。
   时间戳从 `EngineInput` 带进来。这是为了让任何一笔交易都能录成事件序列在测试里逐字重放。

3. **舍入必须走 `packages/shared`**
   不许就地写舍入。规则表见 `02-architecture.md` 第五节。

4. **`bigint` 不许直接进 JSON**
   序列化边界统一 `format()` 转字符串，反序列化统一 `parse()`。

5. **任何资金变动必须写 `ledger_entries`**
   `balanceAfter` 必填。要守住：`accounts.wallet_balance === SUM(ledger_entries.amount)`。

### 依赖方向（单向，不许反）

```
web    ──► shared
server ──► engine ──► shared
server ──► db     ──► shared
```

`engine` 依赖 `db` 或 `server` 是架构错误，不是"暂时这样"。

### 命名防呆

定标数值不加后缀、类型标 `Fixed`；**非定标数值必须加 `Num` 后缀**。

```ts
const price: Fixed = parse('50000.25')   // bigint
const leverageNum: number = 10           // 普通数字
```

---

## 一条原则

**宁可说做不到，不要编数字。**

市价单吃穿 20 档深度就拒单（不按"最后一档 + 滑点惩罚"硬成交）；行情断线就暂停撮合、恢复后不补算。
`02-architecture.md` 第九节列了 10 条已知失真点，每一条都对应一个"本可以造假但选择不造"的决定。
**任何改动如果会让某一条变得更不诚实，就不该做**，即使体验更好。

---

## 仓库结构

```
apps/
  web/      Next.js 16 + React 19 + Tailwind 4 + shadcn/ui   → Cloudflare Workers
  server/   Hono + @hono/node-server（常驻 Node 进程）        → VPS（需能直连币安）
  native/   Expo（第一版不动）
packages/
  shared/   ★待建：类型、枚举、错误码、定标换算（零依赖）
  engine/   ★待建：撮合/风控/清算纯逻辑内核（只依赖 shared）
  db/       Drizzle schema + migrations                       → Supabase Postgres
  ui/       共享 shadcn 组件
  config/   共享 tsconfig / lint
  infra/    Alchemy 部署（只管 web）
```

## 常用命令

```bash
pnpm install
pnpm run dev              # 全部启动
pnpm run dev:server       # 只启服务端 (:3000)
pnpm run dev:web          # 只启前端 (:3001)

pnpm run db:generate      # 生成迁移
pnpm run db:migrate       # 应用迁移
pnpm run db:push          # 开发期直接推
pnpm run db:studio        # 可视化

pnpm run check-types
```

## 提交前自检

1. 有没有 `number` 溜进金额运算？
2. `engine` 里有没有 import 了不该 import 的东西？
3. 改了余额但没写流水？
4. 依赖方向有没有反？
