import { sep } from "node:path";

/**
 * vite 插件的最小结构类型。packages/config 自己没有依赖，拿不到 vite 的类型，
 * 这里只声明用到的字段；`any` 是为了能赋给各 workspace 里 vite 的 Plugin 类型。
 */
interface ResolveImportsPlugin {
  name: string;
  enforce: "pre";
  // biome-ignore lint/suspicious/noExplicitAny: vite 插件上下文与返回值类型由各 workspace 的 vite 决定
  resolveId: (this: any, source: string, importer: string | undefined, options: object) => Promise<any>;
}

/**
 * 让仓库根 `tests/unit/` 下的测试能 import 到对应 workspace 的依赖。
 *
 * 背景：测试镜像放在 `tests/unit/<workspace>/`，而 `vitest`、`hono`、`react`、`@sentry/*` 这些包只装在各 workspace 的
 * node_modules 里，根目录没有，裸模块导入（含 `vi.mock("包名")`）会解析失败，或者解析到和源码不是同一份模块导致 mock 不生效。
 * 这个插件把「来自 tests/unit/ 的裸模块导入」改成从 workspace 的 package.json 位置出发解析，和源码用的是同一份。
 *
 * @param workspaceRoot workspace 根目录的绝对路径（vitest.config 所在目录）
 * @param testsUnitDir 仓库根 `tests/unit` 目录的绝对路径
 * @example
 * plugins: [resolveTestsUnitImports(root, testsUnitDir)]
 */
export function resolveTestsUnitImports(workspaceRoot: string, testsUnitDir: string): ResolveImportsPlugin {
  const importerInWorkspace = `${workspaceRoot}${sep}package.json`;
  const testsUnitPrefix = `${testsUnitDir}${sep}`;
  return {
    name: "resolve-tests-unit-imports",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !importer.startsWith(testsUnitPrefix)) return null;
      // 相对路径、绝对路径、虚拟模块、路径别名（@/）都不归这里管
      if (/^(\.|\/|\0|@\/)/.test(source)) return null;
      return this.resolve(source, importerInWorkspace, { ...options, skipSelf: true });
    },
  };
}
