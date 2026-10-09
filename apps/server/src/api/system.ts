import { readFileSync } from "node:fs";
import { Hono, type MiddlewareHandler } from "hono";
import { ok } from "../http/respond";

/**
 * 系统信息（version / uptime），只读、不需要登录（04-backend-design.md「## 3. 接口契约」）。
 *
 * `version` 来自 apps/server/package.json，只读一次并缓存在模块级变量，避免每次请求都读文件。
 * 用 readFileSync + JSON.parse 而不是 ESM JSON import assertion：仓库目前没有 JSON import 先例，
 * 不同 Node/TS 版本对 `import ... assert { type: "json" }` 语法支持不一致，readFileSync 更稳。
 */

let cachedVersion: string | null = null;

function readVersion(): string {
  if (cachedVersion === null) {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf-8");
    cachedVersion = (JSON.parse(raw) as { version: string }).version;
  }
  return cachedVersion;
}

export function createSystemRoutes(deps: { now?: () => number; startedAt?: number } = {}, middleware?: { rateLimit: MiddlewareHandler }) {
  const now = deps.now ?? Date.now;
  // 只在路由创建时（进程启动一次）记录启动时间戳，不是每次请求都重新算基准。
  const startedAt = deps.startedAt ?? now();
  const routes = new Hono();
  if (middleware) routes.use("*", middleware.rateLimit);

  routes.get("/version", (c) => {
    const uptime = Math.floor((now() - startedAt) / 1000);
    return ok(c, { version: readVersion(), uptime });
  });

  return routes;
}
