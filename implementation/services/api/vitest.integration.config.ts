import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./test/support/stack-global.ts"],
    include: ["test/**/*.integration.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
