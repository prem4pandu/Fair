import { defineConfig, mergeConfig } from "vitest/config";
import integrationConfig from "./vitest.integration.config.js";

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      include: ["test/**/*.spec.ts"],
      // Coverage instrumentation makes the real-database suites materially
      // slower than the plain integration run, so the instrumented run gets its
      // own budget instead of timing out on otherwise healthy tests.
      testTimeout: 180000,
      hookTimeout: 240000,
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: ["src/generated/**"],
        reporter: ["text", "json-summary", "html", "lcov"],
        reportsDirectory: "../../coverage/api-full",
        thresholds: { lines: 90, functions: 90, branches: 85, perFile: true },
      },
    },
  }),
);
