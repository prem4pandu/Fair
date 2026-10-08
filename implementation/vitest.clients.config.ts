import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/integration/*.spec.ts"],
    testTimeout: 20000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
