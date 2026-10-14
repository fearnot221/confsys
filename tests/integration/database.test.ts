import { beforeAll, afterAll, it, expect } from "vitest";
import {
  createPool,
  assertRuntimeRole,
  withIdentityTransaction,
} from "@confsys/db";
import { testUrl } from "../helpers/auth.js";
import { randomUUID } from "node:crypto";
const owner = createPool(
  testUrl("TEST_MIGRATION_DATABASE_URL", "/confsys_test"),
  1,
);
const app = createPool(testUrl("TEST_DATABASE_URL", "/confsys_test"), 1);
const worker = createPool(
  testUrl("TEST_WORKER_DATABASE_URL", "/confsys_test"),
  1,
);
beforeAll(async () => {
  await owner.query("CREATE SCHEMA phase1_transaction");
  await owner.query(
    "CREATE TABLE phase1_transaction.notes(id uuid PRIMARY KEY, parent uuid REFERENCES phase1_transaction.notes(id))",
  );
  await owner.query(
    "GRANT USAGE ON SCHEMA phase1_transaction TO confsys_app, confsys_worker; GRANT SELECT, INSERT ON phase1_transaction.notes TO confsys_app, confsys_worker",
  );
});
afterAll(async () => {
  await owner.query("DROP SCHEMA phase1_transaction CASCADE");
  await Promise.all([owner.end(), app.end(), worker.end()]);
});
for (const [role, pool] of [
  ["confsys_app", app],
  ["confsys_worker", worker],
] as const) {
  it(`${role} is actually nonprivileged and cannot assume ownership or change policies`, async () => {
    await assertRuntimeRole(pool, role);
    for (const sql of [
      "SET ROLE confsys_migrator",
      "ALTER TABLE phase1_transaction.notes DISABLE ROW LEVEL SECURITY",
      "TRUNCATE phase1_transaction.notes",
    ])
      await expect(pool.query(sql)).rejects.toMatchObject({ code: "42501" });
  });
  it(`${role} rolls back writes, reuses a clean pooled connection and enforces references`, async () => {
    const id = randomUUID();
    const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    await expect(
      withIdentityTransaction(pool, async (db) => {
        await db.query("INSERT INTO phase1_transaction.notes(id) VALUES ($1)", [
          id,
        ]);
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    expect(
      (
        await pool.query("SELECT * FROM phase1_transaction.notes WHERE id=$1", [
          id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    ).toBe(pid);
    await expect(
      pool.query("INSERT INTO phase1_transaction.notes VALUES ($1,$2)", [
        randomUUID(),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await Promise.all(
      [1, 2, 3].map(() =>
        withIdentityTransaction(pool, async (db) => {
          await db.query(
            "INSERT INTO phase1_transaction.notes(id) VALUES ($1)",
            [randomUUID()],
          );
        }),
      ),
    );
  });
}
