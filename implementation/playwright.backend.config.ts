import { defineConfig } from "@playwright/test";

// Backend browser smoke only. Original Enatega journeys have separate gates.
export default defineConfig({
  testDir: "./e2e/backend",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4199",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node services/api/dist/main.js",
    url: "http://127.0.0.1:4199/health/live",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      APP_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "4199",
      PUBLIC_BASE_URL: "http://127.0.0.1:4199",
      PUBLIC_ACCESS_ENFORCED: "false",
      PASSWORD_AUTH_ENABLED: "false",
      DATABASE_URL: "postgres://127.0.0.1:1/unavailable",
      REDIS_URL: "redis://127.0.0.1:1",
      CORS_ORIGINS: "",
    },
  },
});
