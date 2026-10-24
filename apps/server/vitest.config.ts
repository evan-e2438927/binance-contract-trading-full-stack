import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { resolveTestsUnitImports } from "../../packages/config/vitest/resolve-tests-unit-imports";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const testsUnitDir = fileURLToPath(new URL("../../tests/unit", import.meta.url));

export default defineConfig({
  plugins: [resolveTestsUnitImports(root, testsUnitDir)],
  test: {
    // 测试按 workspace 镜像放在仓库根 tests/unit/ 下
    include: ["../../tests/unit/server/**/*.test.ts"],
  },
});
