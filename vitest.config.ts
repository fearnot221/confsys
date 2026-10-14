import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/{unit,integration,contract}/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: { conditions: ["development"] },
});
