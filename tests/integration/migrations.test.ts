import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, assertRuntimeRole } from "@confsys/db";
import { runMigrations } from "../../packages/db/src/migrations.js";
import { testUrl } from "../helpers/auth.js";
it("migrates a blank isolated database and upgrades an isolated Phase 0 database without rewriting history", async () => {
  const original = testUrl("TEST_MIGRATION_DATABASE_URL", "/confsys_test");
  const directory = await mkdtemp(join(tmpdir(), "confsys-phase0-"));
  await copyFile(
    "packages/db/migrations/0001_foundation.sql",
    join(directory, "0001_foundation.sql"),
  );
  const cluster = (sql: string) =>
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        process.env.CONFSYS_ENV_FILE ?? ".env",
        "--project-name",
        process.env.COMPOSE_PROJECT_NAME!,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { stdio: "pipe" },
    );
  try {
    for (const kind of ["blank", "upgrade"]) {
      const name = `confsys_test_${kind}_${randomBytes(6).toString("hex")}`;
      cluster(`CREATE DATABASE ${name} OWNER confsys_migrator`);
      const url = new URL(original);
      url.pathname = `/${name}`;
      const pool = createPool(url.href, 1);
      try {
        let checksum: string | undefined;
        if (kind === "upgrade") {
          await runMigrations(pool, directory);
          checksum = (
            await pool.query(
              "SELECT checksum FROM confsys.schema_migrations WHERE version='0001_foundation.sql'",
            )
          ).rows[0].checksum;
          await pool.query(
            "CREATE TABLE confsys.phase0_preserved (value text)",
          );
          await pool.query(
            "INSERT INTO confsys.phase0_preserved VALUES ('synthetic preserve')",
          );
        }
        await runMigrations(pool);
        await runMigrations(pool);
        expect(
          (await pool.query("SELECT count(*) FROM confsys.schema_migrations"))
            .rows[0].count,
        ).toBe("3");
        if (checksum) {
          expect(
            (
              await pool.query(
                "SELECT checksum FROM confsys.schema_migrations WHERE version='0001_foundation.sql'",
              )
            ).rows[0].checksum,
          ).toBe(checksum);
          expect(
            (await pool.query("SELECT value FROM confsys.phase0_preserved"))
              .rows[0].value,
          ).toBe("synthetic preserve");
        }
        const runtimeUrl = new URL(
          testUrl("TEST_DATABASE_URL", "/confsys_test"),
        );
        runtimeUrl.pathname = `/${name}`;
        const runtime = createPool(runtimeUrl.href);
        try {
          await assertRuntimeRole(runtime, "confsys_app");
          expect(
            (await runtime.query("SELECT count(*) FROM confsys.users")).rows[0]
              .count,
          ).toBe("0");
        } finally {
          await runtime.end();
        }
      } finally {
        await pool.end();
        cluster(`DROP DATABASE ${name}`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
