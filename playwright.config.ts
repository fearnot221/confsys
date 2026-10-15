import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
function localTestUrl(name: string, path: string) {
  const value = process.env[name];
  if (
    !value ||
    !["127.0.0.1", "localhost"].includes(new URL(value).hostname) ||
    new URL(value).pathname !== path
  )
    throw new Error(`Local test URL required: ${name}`);
  return value;
}
// Inherited by Playwright workers solely for isolated synthetic rate-limit cleanup.
process.env.CONFSYS_E2E_RATE_KEY ??= randomBytes(32).toString("hex");
const testEnvironment = {
  DATABASE_URL: localTestUrl("TEST_DATABASE_URL", "/confsys_test"),
  WORKER_DATABASE_URL: localTestUrl(
    "TEST_WORKER_DATABASE_URL",
    "/confsys_test",
  ),
  REDIS_URL: localTestUrl("TEST_REDIS_URL", "/1"),
  // Per-run key isolates rate counters and browser CSRF cookies without changing limits.
  QR_SIGNING_KEY: randomBytes(32).toString("hex"),
  CSRF_SIGNING_KEY: process.env.CONFSYS_E2E_RATE_KEY,
};
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.PUBLIC_APP_ORIGIN!, trace: "retain-on-failure" },
  webServer: [
    {
      env: testEnvironment,
      command:
        "node --conditions=development --import tsx scripts/run-process.ts worker built",
      url: `${process.env.WORKER_HEALTH_URL}/health/ready`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      env: testEnvironment,
      command:
        "node --conditions=development --import tsx scripts/run-process.ts api built",
      url: `http://127.0.0.1:${process.env.API_PORT ?? 23000}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `node apps/web/node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${process.env.WEB_PORT ?? 25173} --strictPort --config apps/web/vite.config.ts apps/web`,
      url: process.env.PUBLIC_APP_ORIGIN!,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
