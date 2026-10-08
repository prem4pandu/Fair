import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  // Nest loads GraphQL through CommonJS. Keep transformed transport imports on
  // that same instance instead of Vite's preferred index.mjs entry point.
  resolve: {
    alias: [{ find: /^graphql$/, replacement: require.resolve("graphql") }],
  },
  test: {
    globalSetup: ["./test/support/stack-global.ts"],
    include: ["test/**/*.integration.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
