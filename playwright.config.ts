import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:25173", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node apps/worker/dist/main.js",
      url: "http://127.0.0.1:23001/health/ready",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "node apps/api/dist/main.js",
      url: "http://127.0.0.1:23000/api/health/ready",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "pnpm dev:web",
      url: "http://127.0.0.1:25173",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
