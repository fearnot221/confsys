import { createPool } from "@confsys/db";
import { runMigrations } from "../packages/db/src/migrations.js";
const value = process.env.TEST_MIGRATION_DATABASE_URL;
if (
  !value ||
  !["localhost", "127.0.0.1"].includes(new URL(value).hostname) ||
  new URL(value).pathname !== "/confsys_test"
)
  throw new Error("Local confsys_test migration URL required");
const pool = createPool(value, 1);
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
