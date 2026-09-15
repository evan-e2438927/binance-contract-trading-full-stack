# Books 列表页：从数据入库到页面显示（含数据库上云）

这份教程带你在当前仓库里跑通一条最小但完整的全栈链路：

```
浏览器页面 (Next.js, :3001)
      │  fetch
      ▼
Hono 接口 (apps/server, :3000)
      │  Drizzle ORM
      ▼
Postgres（先本地 Supabase，最后换成 Supabase 云）
```

字段只有两个：书名 `title`、作者 `author`。目标不是做产品，是把「表 → 接口 → 页面 → 云端库」这条路走通一遍，之后加任何业务表都是同一套动作。

**技术选型（已确认）**：Supabase 云做数据库；本地先用 Supabase CLI 起的本地库开发，最后切云端；前后端走 Hono 接口 + fetch（不引入 tRPC，脚手架 `api: none`）。

**全程需要改的文件一览**（心里先有个数）：

| 文件 | 动作 |
| --- | --- |
| `packages/db/src/schema/books.ts` | 新建，定义表 |
| `packages/db/src/schema/index.ts` | 改，导出 books |
| `packages/db/src/index.ts` | 改，把 schema 透出给别的包用 |
| `apps/server/src/routes/books.ts` | 新建，两个接口 |
| `apps/server/src/index.ts` | 改，挂载路由 |
| `apps/web/src/lib/api.ts` | 新建，服务端地址 |
| `apps/web/src/app/books/page.tsx` | 新建，页面 |
| `apps/web/src/components/header.tsx` | 改，加导航入口 |
| `apps/server/.env` | 改，最后切云端连接串 |

---

## 第 0 步：准备本地数据库

这个仓库是用 Better-T-Stack 的 `--db-setup supabase` 生成的，`packages/db/supabase/` 里已经有 Supabase CLI 的配置，本地库跑在 `127.0.0.1:54322`（`apps/server/.env` 里的 `DATABASE_URL` 已经指向它）。

本地 Supabase 需要 Docker Desktop 在运行。先确认：

```bash
docker info
```

有输出说明 Docker 正常。然后在 `packages/db` 目录起本地库：

```bash
cd packages/db
pnpm dlx supabase start
```

第一次会拉镜像，几分钟。跑完它会打印一串地址，其中这一行就是你 `.env` 里那个：

```
      DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
   Studio URL: http://127.0.0.1:54323
```

✅ **验收**：浏览器打开 `http://127.0.0.1:54323`，能看到 Supabase 的本地控制台。

> 不想装 Docker？可以跳过本地这一段，直接做到第 6 步再回来 —— 但那样每次改表都动云端库，调试会慢一点。

---

## 第 1 步：定义表结构

Drizzle 的思路是：**表结构就是一段 TypeScript 代码**，数据库里的表由这段代码生成，类型也由这段代码推导出来。你只写一处，接口层和页面层的类型自动就有了。

新建 `packages/db/src/schema/books.ts`：

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 查出来的一行长什么样
export type Book = typeof books.$inferSelect;
// 插入时需要传什么
export type NewBook = typeof books.$inferInsert;
```

几个说明：

- `uuid().defaultRandom()`：主键交给数据库生成，前端不用管 id。
- `notNull()`：书名和作者必填，这条约束落在数据库层，接口层再校验一次是双保险。
- `createdAt` 加上是为了列表能按时间倒序，成本几乎为零，后面会用到。
- `$inferSelect` / `$inferInsert` 是 Drizzle 的类型推导，不需要手写 interface。

然后改 `packages/db/src/schema/index.ts`（原本只有一行 `export {};`）：

```ts
export * from "./books";
```

再改 `packages/db/src/index.ts`，在文件末尾加一行，把表定义透出去，这样 `apps/server` 才能 import 到 `books`：

```ts
import { drizzle } from "drizzle-orm/node-postgres";

import type { DatabaseConfig } from "./config";
import * as schema from "./schema";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DATABASE_URL, { schema });
}

export type Database = ReturnType<typeof createDb>;

// 👇 新增：把表定义和类型一起导出
export * from "./schema";
```

✅ **验收**：

```bash
# 在仓库根目录
pnpm run check-types
```

没有报错就说明 schema 写对了。

---

## 第 2 步：把表推到数据库

Drizzle 有两种把代码变成真实表的方式：

- `db:push`：直接对比代码和数据库，差什么补什么。**快，适合开发期**，但没有历史记录。
- `db:generate` + `db:migrate`：生成 SQL 迁移文件再执行。**有版本记录，适合上线后**。

现在先用 push，第 8 步再讲怎么切到 migrate。

```bash
# 在仓库根目录
pnpm run db:push
```

它会读 `apps/server/.env` 里的 `DATABASE_URL`（`packages/db/.env.schema` 第一行 `@import(../../apps/server/, pick=[NODE_ENV, DATABASE_*])` 就是干这个的：db 包的环境变量是从 server 那边借过来的）。

看到类似 `[✓] Changes applied` 就成了。

✅ **验收**：打开 Drizzle Studio 看一眼表在不在：

```bash
pnpm run db:studio
```

浏览器里应该能看到 `books` 表，三列加一个 `created_at`，0 行数据。看完 `Ctrl+C` 关掉。

> 也可以在 `http://127.0.0.1:54323` 的 Supabase Table Editor 里看同一张表。

---

## 第 3 步：写两个接口

服务端已经有一个现成的数据库连接封装 `apps/server/src/services.ts`（`getDb()`），直接用就行，不用自己 new 连接。

新建 `apps/server/src/routes/books.ts`：

```ts
import { books } from "@binance-contract-trading-full-stack/db";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../services";

export const booksRoute = new Hono();

// GET /books —— 列表，最新的排前面
booksRoute.get("/", async (c) => {
  const db = getDb();
  const rows = await db.select().from(books).orderBy(desc(books.createdAt));
  return c.json(rows);
});

const createBookSchema = z.object({
  title: z.string().trim().min(1, "书名不能为空"),
  author: z.string().trim().min(1, "作者不能为空"),
});

// POST /books —— 新增一本
booksRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBookSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("；");
    return c.json({ error: message }, 400);
  }

  const db = getDb();
  const [row] = await db.insert(books).values(parsed.data).returning();
  return c.json(row, 201);
});
```

说明：

- `db.select().from(books)` 就是 `select * from books`，Drizzle 的写法刻意贴着 SQL，读起来不用翻译。
- `.returning()` 让 insert 把刚写进去的那一行带回来（包含数据库生成的 `id` 和 `createdAt`），前端拿到就能直接塞进列表，不用再请求一次。
- zod 校验挡的是「前端绕过去了、或者别人直接 curl」的脏数据。`trim()` 顺手把首尾空格去掉。

再改 `apps/server/src/index.ts`，把路由挂上去：

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.server";
import { booksRoute } from "./routes/books"; // 👈 新增

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

app.route("/books", booksRoute); // 👈 新增

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
```

> CORS 里 `allowMethods` 已经包含 `POST` 了，这一步不用改。以后要做删除，记得把 `DELETE` 加进去，否则浏览器预检会被拦。

---

## 第 4 步：先用命令行验证接口

页面还没写，先确认后端这一段是通的 —— 这一步很关键，出问题时你就知道锅在前端还是后端。

开一个终端启动服务端：

```bash
pnpm run dev:server
```

另开一个终端：

```bash
# 新增一本
curl -X POST http://localhost:3000/books \
  -H "Content-Type: application/json" \
  -d '{"title":"人月神话","author":"Frederick P. Brooks Jr."}'

# 查列表
curl http://localhost:3000/books
```

✅ **验收**：POST 返回一个带 `id` 和 `createdAt` 的 JSON 对象；GET 返回一个数组，里面有刚才那本书。

顺手验证一下校验有没有生效：

```bash
curl -X POST http://localhost:3000/books \
  -H "Content-Type: application/json" \
  -d '{"title":"","author":""}'
# 期望：{"error":"书名不能为空；作者不能为空"}，状态码 400
```

**到这里，「数据入库」这半条链路已经跑通了。** 剩下的是把它显示出来。

---

## 第 5 步：写页面

先建一个小文件放服务端地址，`apps/web/src/lib/api.ts`：

```ts
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";
```

`NEXT_PUBLIC_` 开头的变量 Next.js 会在构建时直接内联进浏览器代码，所以客户端组件里能读到。值在 `apps/web/.env` 里，已经是 `http://localhost:3000`。

新建 `apps/web/src/app/books/page.tsx`：

```tsx
"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Input } from "@binance-contract-trading-full-stack/ui/components/input";
import { Label } from "@binance-contract-trading-full-stack/ui/components/label";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { SERVER_URL } from "@/lib/api";

type Book = {
  id: string;
  title: string;
  author: string;
  createdAt: string;
};

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  // 进页面先拉一次列表
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${SERVER_URL}/books`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Book[] = await res.json();
        if (!cancelled) setBooks(data);
      } catch (error) {
        if (!cancelled) toast.error(`加载失败：${(error as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !author.trim()) {
      toast.error("书名和作者都要填");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // 后端 returning() 把新行带回来了，直接插到列表最前面
      setBooks((prev) => [data as Book, ...prev]);
      setTitle("");
      setAuthor("");
      toast.success("添加成功");
    } catch (error) {
      toast.error(`添加失败：${(error as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 font-semibold text-2xl">Books</h1>

      <form onSubmit={handleSubmit} className="mb-8 grid gap-4 rounded-lg border p-4">
        <div className="grid gap-2">
          <Label htmlFor="title">书名</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="人月神话"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="author">作者</Label>
          <Input
            id="author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Frederick P. Brooks Jr."
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "提交中…" : "添加"}
        </Button>
      </form>

      <section>
        <h2 className="mb-3 font-medium">书单（{books.length}）</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">加载中…</p>
        ) : books.length === 0 ? (
          <p className="text-muted-foreground text-sm">还没有书，上面添加一本试试。</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {books.map((book) => (
              <li key={book.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{book.title}</span>
                <span className="text-muted-foreground text-sm">{book.author}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

页面做了三件事，都刻意写成最直白的样子：进页面 `fetch` 一次列表、提交时 `POST` 一次、成功后把返回的新行拼到本地数组前面。没有引入 react-query 之类的数据层 —— 等以后接口多起来、需要缓存和自动重拉时再加不迟。

---

## 第 6 步：加导航入口，整体跑一遍

改 `apps/web/src/components/header.tsx` 里的 links：

```tsx
const links = [
  { to: "/", label: "Home" },
  { to: "/books", label: "Books" },
] as const;
```

然后在仓库根目录一次性启动全部：

```bash
pnpm run dev
```

（这会同时起 web:3001、server:3000 和 native。只想起前两个就分别跑 `pnpm run dev:web` 和 `pnpm run dev:server`。）

✅ **本地验收清单**，逐条过：

1. 打开 `http://localhost:3001/books`，能看到第 4 步用 curl 加的那本书。
2. 填书名和作者，点添加，列表立刻多一行，右下角弹成功提示。
3. 刷新页面，刚加的书还在 —— **这说明数据真的进库了，不是存在内存里**。
4. 书名留空点添加，弹出「书名和作者都要填」。
5. `pnpm run db:studio` 打开，`books` 表里行数对得上。

五条都过，本地这条链路就完整了。

---

## 第 7 步：数据库上云（Supabase）

现在把数据从本地 Docker 换到云端。**代码一行不用改，只换一个连接串** —— 这就是 `DATABASE_URL` 这层抽象的价值。

### 7.1 建云端项目

1. 打开 https://supabase.com/dashboard 用 GitHub 登录。
2. New project：
   - Name：`binance-contract-trading`
   - Database Password：**点生成，然后立刻存到你的密码管理器**。这个密码页面只显示一次，丢了只能重置。
   - Region：选 `Southeast Asia (Singapore)`，国内访问延迟最低。
   - Plan：Free 够用（500MB 数据库，两个项目）。
3. 等 1～2 分钟初始化完成。

### 7.2 取连接串

项目页面右上角 **Connect** 按钮 → 弹窗里有三种连接方式，区别很重要：

| 方式 | 端口 | 什么时候用 |
| --- | --- | --- |
| Direct connection | 5432 | 长连接、需要完整 Postgres 特性。**但只有 IPv6 地址**，很多本地网络连不上 |
| Transaction pooler | 6543 | Serverless / 短连接（Lambda、Cloudflare Worker） |
| **Session pooler** | 5432 | IPv4 可达的长连接，**本地开发和 Node 服务端选这个** |

你要复制的是 **Session pooler** 那一条，形如：

```
postgresql://postgres.abcdefghijklmn:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

把 `[YOUR-PASSWORD]` 替换成 7.1 存下来的密码。

> ⚠️ **密码里有特殊字符要做 URL 编码**：`@` → `%40`，`#` → `%23`，`/` → `%2F`，`:` → `%3A`，`?` → `%3F`。不编码的话连接串会被解析错，报出来的错误还很难懂（通常是 `password authentication failed`）。为了少踩这个坑，生成密码时尽量只用字母数字。

### 7.3 切换 .env

编辑 `apps/server/.env`，把本地那行注释掉，换成云端的：

```bash
CORS_ORIGIN=http://localhost:3001

# 本地 Supabase（需要 docker + supabase start）
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
# DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Supabase 云（Session pooler）
DATABASE_URL=postgresql://postgres.你的ref:你的密码@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
DIRECT_URL=postgresql://postgres.你的ref:你的密码@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

`.env` 在 `.gitignore` 里，不会提交，放心写真实密码。想留个模板给以后的自己，可以另存一份 `apps/server/.env.example`，把密码位置留空。

### 7.4 把表推到云端

先把正在跑的 dev 全部停掉（环境变量是启动时读的，不重启不生效），然后：

```bash
pnpm run db:push
```

✅ **验收**：回到 Supabase 控制台 → Table Editor → 能看到 `books` 表，0 行数据（云端是新库，本地那几本书不会跟过来，这是对的）。

### 7.5 重新跑一遍

```bash
pnpm run dev
```

打开 `http://localhost:3001/books`：列表是空的（新库），添加一本，刷新还在，Supabase 控制台的 Table Editor 里也能实时看到这一行。

✅ **到这里你要的两件事都完成了**：数据从页面写进数据库并显示出来，数据库在云上。

> 本地的 Docker 库可以留着不动（`pnpm dlx supabase stop` 停掉即可），以后想离线开发随时把 `.env` 换回去。

---

## 第 8 步（可选但建议）：从 push 切到 migrate

`db:push` 适合表结构还在反复改的阶段。一旦云端库里有了你不想丢的数据，就该换成迁移文件的方式：

```bash
# 1. 根据 schema 生成 SQL 迁移文件，落在 packages/db/src/migrations/
pnpm run db:generate

# 2. 把迁移文件应用到 DATABASE_URL 指向的库
pnpm run db:migrate
```

区别在于：`generate` 产出的 SQL 文件是要提交到 git 的，谁在什么时候改了什么表一目了然；换台机器或者部署到新环境时，跑一次 `db:migrate` 就能把库补到最新状态。而 `push` 是「现场比对现场改」，没有痕迹，也没法回滚。

建议的切换时机：Books 这类练手表用 push 快速迭代；等你开始建真正的合约交易相关表时，第一次就用 generate + migrate。

---

## 常见问题排查

| 现象 | 原因 / 解决 |
| --- | --- |
| 页面报 `Failed to fetch`，控制台有 CORS 字样 | 服务端没起，或者 `apps/server/.env` 的 `CORS_ORIGIN` 不等于 `http://localhost:3001` |
| `db:push` 报 `ECONNREFUSED 127.0.0.1:54322` | 本地 Supabase 没启动，`cd packages/db && pnpm dlx supabase start` |
| 云端 `db:push` 卡住不动或超时 | 用成了 Direct connection（只有 IPv6），换 Session pooler 那条 |
| 云端报 `password authentication failed` | 密码错，或者密码里的特殊字符没做 URL 编码 |
| 改了 `.env` 但行为没变 | 环境变量在进程启动时读取，必须重启 dev |
| `pnpm run check-types` 报找不到 `books` | `packages/db/src/index.ts` 忘了加 `export * from "./schema";` |
| 页面拿到数据但不显示 | 打开 Network 面板看 `/books` 的响应，确认是数组不是 `{error: ...}` |
| Supabase 项目提示 paused | Free 项目 7 天无活动会暂停，控制台点 Restore 恢复 |

---

## 之后可以往哪走

这条链路跑通后，加功能都是同一套动作的重复：

1. **删除 / 编辑**：`apps/server/src/routes/books.ts` 加 `DELETE /books/:id`，别忘了在 `index.ts` 的 CORS `allowMethods` 里加上 `DELETE`。
2. **分页和搜索**：Drizzle 的 `.limit()` / `.offset()` / `ilike()`。
3. **数据层**：接口多起来之后引入 TanStack Query，把 `useEffect + useState` 那套换掉，自动处理缓存、重拉和 loading 状态。
4. **服务端上云**：当前脚手架 `serverDeploy: none`，server 只在本地跑。要上线的话，Railway / Fly.io 部署 Node 服务最省事（`packages/infra` 那套 Alchemy 目前只管 web 到 Cloudflare）。
5. **换成真正的业务表**：合约交易的持仓、订单表，建表流程和这里完全一样，区别只在字段更多、索引要想清楚。

---

*文档位置：`docs/books-tutorial.md`*
