import { defineConfig, mergeConfig } from "vitest/config";
import unitConfig from "./vitest.config.js";

export default mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: ["src/generated/**"],
        reporter: ["text", "json-summary", "html", "lcov"],
        reportsDirectory: "../../coverage/api-unit",
      },
    },
  }),
);
