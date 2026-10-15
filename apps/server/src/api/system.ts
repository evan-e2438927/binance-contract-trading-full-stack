import { Hono, type MiddlewareHandler } from "hono";
import packageJson from "../../package.json" with { type: "json" };
import { ok } from "../http/respond";

/**
 * 系统信息（version / uptime），只读、不需要登录（04-backend-design.md「## 3. 接口契约」）。
 *
 * `version` 来自 apps/server/package.json，构建时内联，避免打包后文件相对路径失效。
 */

export function createSystemRoutes(deps: { now?: () => number; startedAt?: number } = {}, middleware?: { rateLimit: MiddlewareHandler }) {
  const now = deps.now ?? Date.now;
  // 只在路由创建时（进程启动一次）记录启动时间戳，不是每次请求都重新算基准。
  const startedAt = deps.startedAt ?? now();
  const routes = new Hono();
  if (middleware) routes.use("*", middleware.rateLimit);

  routes.get("/version", (c) => {
    const uptime = Math.floor((now() - startedAt) / 1000);
    return ok(c, { version: packageJson.version, uptime });
  });

  return routes;
}
