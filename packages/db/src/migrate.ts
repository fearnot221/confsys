import { createPool } from "./index.js";
import { loadMigrationConfig } from "@confsys/config";
import { runMigrations } from "./migrations.js";
const pool = createPool(loadMigrationConfig().MIGRATION_DATABASE_URL, 1);
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
