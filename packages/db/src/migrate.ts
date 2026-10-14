import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createPool } from "./index.js";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const pool = createPool(url, 1);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(724001)");
  const role = await client.query("SELECT current_user");
  if (role.rows[0].current_user !== "confsys_migrator")
    throw new Error("Use the dedicated migration role");
  await client.query("CREATE SCHEMA IF NOT EXISTS confsys");
  await client.query(
    "CREATE TABLE IF NOT EXISTS confsys.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = resolve("packages/db/migrations");
  for (const name of (await readdir(directory))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(resolve(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT checksum FROM confsys.schema_migrations WHERE version = $1",
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO confsys.schema_migrations(version, checksum) VALUES ($1, $2)",
      [name, checksum],
    );
    console.log(`Applied ${name}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
