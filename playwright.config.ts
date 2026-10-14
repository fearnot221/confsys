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
const testEnvironment = {
  DATABASE_URL: localTestUrl("TEST_DATABASE_URL", "/confsys_test"),
  WORKER_DATABASE_URL: localTestUrl(
    "TEST_WORKER_DATABASE_URL",
    "/confsys_test",
  ),
  REDIS_URL: localTestUrl("TEST_REDIS_URL", "/1"),
  // Per-run key isolates rate counters and browser CSRF cookies without changing limits.
  CSRF_SIGNING_KEY: randomBytes(32).toString("hex"),
};
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:25173", trace: "retain-on-failure" },
  webServer: [
    {
      env: testEnvironment,
      command:
        "node --conditions=development --import tsx scripts/run-process.ts worker built",
      url: "http://127.0.0.1:23001/health/ready",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      env: testEnvironment,
      command:
        "node --conditions=development --import tsx scripts/run-process.ts api built",
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
