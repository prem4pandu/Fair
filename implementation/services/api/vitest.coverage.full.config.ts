import { defineConfig, mergeConfig } from "vitest/config";
import integrationConfig from "./vitest.integration.config.js";

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      include: ["test/**/*.spec.ts"],
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
