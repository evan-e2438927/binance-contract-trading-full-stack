// 打包时 package.json 会被内联进 dist，Docker 里 `node dist/index.mjs` 启动也能拿到版本号
import pkg from "../../package.json" with { type: "json" };

/** Sentry 推荐的 release 写法是「包名@版本号」 */
const RELEASE_PREFIX = "server@";

/**
 * 决定上报给 Sentry 的版本标识：手动配了 SENTRY_RELEASE 就用它，否则用 package.json 的 version。
 *
 * @example
 * resolveRelease(undefined, "0.1.0"); // "server@0.1.0"
 * resolveRelease("a1b2c3d", "0.1.0"); // "a1b2c3d"
 */
export function resolveRelease(override: string | undefined, version: string = pkg.version): string {
  return override || `${RELEASE_PREFIX}${version}`;
}
