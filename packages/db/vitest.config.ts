import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { resolveTestsUnitImports } from "../config/vitest/resolve-tests-unit-imports";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const testsUnitDir = fileURLToPath(new URL("../../tests/unit", import.meta.url));

export default defineConfig({
  plugins: [resolveTestsUnitImports(root, testsUnitDir)],
  test: {
    environment: "node",
    include: ["../../tests/unit/packages/db/**/*.test.ts"],
  },
});
