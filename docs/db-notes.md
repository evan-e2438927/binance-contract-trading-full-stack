# 开发笔记：依赖提升 & 数据库迁移策略

> 记录 2026-09-14 讨论的两个问题，结论可直接照做。

---

## 一、`drizzle-orm` 找不到：怎么提到外层公用

**现象**：`apps/server/src/routers/books.ts` 里 `import { desc } from "drizzle-orm"` 报 `Cannot find module 'drizzle-orm'`。

**原因**：`drizzle-orm` 只声明在 `packages/db` 的 dependencies 里，`apps/server` 自己没声明过。pnpm 的严格 node_modules 布局不会让你用到没声明的包。

### 方案 A：提到 catalog（推荐，仓库已在用这套）

catalog = 版本号统一写在 workspace 根，各包只写 `catalog:` 引用。版本集中管理，但每个包仍**显式声明**自己用了什么。

**1. `pnpm-workspace.yaml`**

```yaml
catalog:
  zod: ^4.5.4
  drizzle-orm: ^0.45.2      # 新增（当前锁定版本）
  "@types/node": ^26.4.1
  ...
```

**2. `packages/db/package.json`**

```json
"dependencies": {
  "drizzle-orm": "catalog:",
  "pg": "^8.23.0",
  "zod": "catalog:"
}
```

**3. `apps/server/package.json`** —— 这条是报错的直接解法

```json
"dependencies": {
  "@binance-contract-trading-full-stack/db": "workspace:*",
  "@hono/node-server": "^2.1.1",
  "drizzle-orm": "catalog:",
  "hono": "^4.13.7",
  ...
}
```

**4. 根目录执行**

```bash
pnpm install
pnpm run check-types
```

#### 为什么不能只塞进根 package.json 的 dependencies

Node 找包是逐层往上翻目录的，所以根 `node_modules` 里的东西 `apps/server` 确实也能 import 到，看起来能用。但这叫**幽灵依赖**：server 自己的 package.json 上没写，某天单独构建/部署 server（或把它拆出去），依赖列表里就是没有 drizzle-orm，当场挂掉。catalog 才是 pnpm 官方解法。

### 方案 B：让 server 不直接碰 drizzle-orm

既然 db 包是数据库层，就让它把查询算子一起透出来，server 只依赖一个包：

```ts
// packages/db/src/index.ts 末尾
export * from "./schema";
export { and, asc, desc, eq, like, ilike, sql } from "drizzle-orm";
```

```ts
// apps/server/src/routers/books.ts
import { books, desc } from "@binance-contract-trading-full-stack/db";
```

- 好处：server 依赖更干净，drizzle 换代时只有 db 包受影响
- 代价：每次用到新算子都要回 db 包补一行导出

**建议**：A 是必须做的（基础设施问题）；B 可选，查询写得多时 A+B 一起用体验最好。

---

## 二、`db:generate` 只管结构，不管数据

### 它到底在比什么

generate 是**离线**的，不连数据库：

```
src/schema/*.ts（表定义）
        对比
src/migrations/meta/000X_snapshot.json（上次生成的快照）
        产出
000X_xxx.sql（差异 DDL）+ 新快照
```

产出永远是 `CREATE TABLE` / `ALTER TABLE ADD COLUMN` / `DROP COLUMN` 这类语句，**不会有一句 INSERT / UPDATE**。库里有 10 万行还是 0 行，生成的 SQL 一模一样。

当前仓库状态：`src/migrations/0000_wooden_lady_vermin.sql` + `meta/0000_snapshot.json`。

### 数据变更怎么办

#### 1. 种子数据（seed）—— 开发/初始化用

`packages/db/src/seed.ts`：

```ts
import "varlock/auto-load";
import { createDb } from "./index";
import { books } from "./schema";

const db = createDb({ DATABASE_URL: process.env.DATABASE_URL! });

await db.insert(books).values([
  { title: "人月神话", author: "Frederick P. Brooks Jr." },
  { title: "设计数据密集型应用", author: "Martin Kleppmann" },
]).onConflictDoNothing();

console.log("seeded");
process.exit(0);
```

`packages/db/package.json` 加：`"db:seed": "tsx src/seed.ts"`

可反复跑、可随便改，**但不会在新环境自动执行**，要手动跑。

#### 2. 数据迁移（回填）—— 必须跟结构一起走的

比如加了 `slug` 列，老数据是 NULL 要回填。生成一个**空的** SQL 文件自己写：

```bash
cd packages/db
pnpm dlx drizzle-kit generate --custom --name=backfill_book_slug
```

产出 `src/migrations/000X_backfill_book_slug.sql`（空文件）并登记进 `_journal.json`，自己往里写：

```sql
UPDATE books SET slug = lower(replace(title, ' ', '-')) WHERE slug IS NULL;
```

之后和其它迁移一样按顺序执行，且只执行一次（drizzle 用库里的 `__drizzle_migrations` 表记录）。

---

## 三、更省心的做法：分阶段策略

上面那套复杂流程，是为「线上有数据还要动结构」准备的。按下面三个阶段走，大概率一辈子用不上 `--custom`。

### 阶段一：现在开发阶段（表还在反复改，数据可丢）

**用 `db:push` + seed 脚本，别管迁移文件。**

```bash
pnpm run db:push      # 改完 schema 直接推，不生成文件
pnpm run db:seed      # 数据没了就重灌
```

安全感来自**数据随时能重建**，不是来自小心翼翼地迁移。改崩了 `drizzle-kit push --force` 重来，30 秒的事。

> **切换分界线**：库里出现「丢了会心疼」的数据时切迁移。对本项目大概是真实接上币安、开始存历史行情/订单那天。

### 阶段二：有真实数据了 —— 一条铁律解决 90% 的麻烦

> **只做加法，不改名、不删列。**

把「改名」和「删列」从习惯里去掉，`db:generate` 生成的 SQL 就永远安全。

| 想做的改动 | 安全做法 |
| --- | --- |
| 加一张表 | 直接加，无风险 |
| 加一列 | 加，但**必须可空或带默认值**（`.default(0)` / 不写 `.notNull()`）—— 否则老数据填不上，迁移直接失败 |
| 加索引 | 直接加 |
| 改列名 | 见下面那招，根本不用改库 |
| 不要某列了 | **先不删**。代码里停止读写即可，一列 NULL 不占什么空间。三个月后确认没人用了再删 |
| 改列类型 | 加新列 → 双写一段 → 切读 → 删旧列（躲不掉，但很少发生） |

#### 改列名的那招

Drizzle 里 **TS 属性名和数据库列名是分开的**：

```ts
export const books = pgTable("books", {
  authorName: text("author"),
  // 左边：代码里用的名字     右边：数据库里的真实列名
});
```

想把代码里的 `author` 改成 `authorName`？只改左边，右边 `"author"` 不动 —— `db:generate` 会认为结构没变化，**一行 SQL 都不生成**，数据一动不动。数据库列名本来就不需要跟着代码审美走。

#### 真要改列名时的坑

`db:generate` 会**交互式询问**：

```
Is authorName column created or renamed from another column?
  > + authorName            create column
    ~ author > authorName   rename column
```

选 `create` 生成的是「删掉 author 列 + 新建 authorName 列」—— **老数据全没了**。选 `rename` 才是 `ALTER TABLE ... RENAME COLUMN`。这个交互一闪而过容易手快选错，**生成完养成习惯去 `src/migrations/` 把 SQL 打开看一眼再 migrate**。

#### 破坏性改动的三步走（万不得已时）

拆成三个独立迁移，中间可部署、可回滚：

1. **加**：新列，允许 NULL（DDL，generate 自动生成）
2. **搬**：`--custom` 手写 UPDATE 把老列数据写进新列
3. **删**：加 NOT NULL 约束、删掉老列（DDL，generate 自动生成）

### 阶段三：备份兜底

migrate 前存一份，习惯问题：

```bash
# 备份，文件名带时间戳
pg_dump "$DATABASE_URL" -Fc -f "backup-$(date +%Y%m%d-%H%M).dump"

# 恢复
pg_restore -d "$DATABASE_URL" --clean --if-exists backup-xxx.dump
```

可在 `packages/db/package.json` 加一条 `"db:backup"`，migrate 前手动跑。

另外 Supabase 免费版自带**每日自动备份**（控制台 Database → Backups），可回滚到过去 7 天的任意一天，当前量级足够。

---

## 一页速查

1. **现在**：`db:push` + `seed.ts`，别管迁移文件
2. **真实数据进来后**：切 `db:generate` + `db:migrate`，守住「只加不改」
3. **加列**记得可空或给默认值；**想改名**就只改 TS 属性名
4. **结构自动，数据手写** —— generate 永远不会帮你生成 INSERT/UPDATE

---

## 待办

- [ ] `drizzle-orm` 提到 catalog（方案 A 三处改动 + `pnpm install`）
- [ ] 建 `packages/db/src/seed.ts` + `db:seed` 脚本
- [ ] 加 `db:backup` 脚本

---

*文档位置：`docs/db-notes.md`*
