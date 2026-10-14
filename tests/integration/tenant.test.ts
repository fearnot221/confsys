import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { createPool, withTenant, assertRuntimeRole } from "@confsys/db";
function testUrl(key: string) {
  const value = process.env[key];
  if (
    !value ||
    new URL(value).pathname !== "/confsys_test" ||
    !["127.0.0.1", "localhost"].includes(new URL(value).hostname)
  )
    throw new Error(`Local confsys_test URL required: ${key}`);
  return value;
}
const migrator = createPool(testUrl("TEST_MIGRATION_DATABASE_URL"), 1);
const app = createPool(testUrl("TEST_DATABASE_URL"), 1);
const worker = createPool(testUrl("TEST_WORKER_DATABASE_URL"), 1);
const orgA = randomUUID(),
  orgB = randomUUID();
const scopes = [
  { organizationId: orgA, conferenceId: randomUUID() },
  { organizationId: orgA, conferenceId: randomUUID() },
  { organizationId: orgB, conferenceId: randomUUID() },
];
const ids = scopes.map(() => randomUUID());
let fixtureInstalled = false;
let fixtureClient: PoolClient | undefined;
beforeAll(async () => {
  fixtureClient = await migrator.connect();
  // Keep the lock-owning session checked out for the whole fixture lifetime.
  await fixtureClient.query("SELECT pg_advisory_lock(724002)");
  await fixtureClient.query("DROP SCHEMA IF EXISTS phase0_rls CASCADE");
  await fixtureClient.query(await readFile("tests/fixtures/rls.sql", "utf8"));
  fixtureInstalled = true;
  for (const [index, scope] of scopes.entries())
    await withTenant(app, scope, async (_db, client) => {
      await client.query("INSERT INTO phase0_rls.conferences VALUES ($1, $2)", [
        scope.organizationId,
        scope.conferenceId,
      ]);
      await client.query(
        "INSERT INTO phase0_rls.notes VALUES ($1, $2, $3, $4)",
        [
          scope.organizationId,
          scope.conferenceId,
          ids[index],
          `synthetic-${index}`,
        ],
      );
    });
});
afterAll(async () => {
  try {
    if (fixtureClient) {
      if (fixtureInstalled)
        await fixtureClient.query("DROP SCHEMA phase0_rls CASCADE");
      await fixtureClient.query("SELECT pg_advisory_unlock(724002)");
    }
  } finally {
    fixtureClient?.release();
    await Promise.all([app.end(), worker.end(), migrator.end()]);
  }
});
for (const [name, pool] of [
  ["confsys_app", app],
  ["confsys_worker", worker],
] as const)
  describe(name, () => {
    it("uses the actual non-owner, non-superuser, non-bypass login role", async () => {
      await expect(assertRuntimeRole(pool, name)).resolves.toBeUndefined();
      const result = await pool.query("SELECT current_user");
      expect(result.rows[0].current_user).toBe(name);
      await expect(
        pool.query("SET ROLE confsys_migrator"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("ALTER TABLE phase0_rls.notes DISABLE ROW LEVEL SECURITY"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        pool.query("TRUNCATE phase0_rls.notes CASCADE"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("permits scoped reads and writes through Drizzle and the same transaction", async () => {
      await withTenant(pool, scopes[0]!, async (db, client) => {
        const result = await db.execute(sql`SELECT body FROM phase0_rls.notes`);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.body).toBe("synthetic-0");
        const id = randomUUID();
        await client.query(
          "INSERT INTO phase0_rls.notes VALUES ($1,$2,$3,$4)",
          [orgA, scopes[0]!.conferenceId, id, "temporary"],
        );
        expect(
          (
            await client.query(
              "UPDATE phase0_rls.notes SET body=$1 WHERE id=$2",
              ["changed", id],
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (await client.query("DELETE FROM phase0_rls.notes WHERE id=$1", [id]))
            .rowCount,
        ).toBe(1);
      });
    });
    for (const index of [1, 2])
      it(`blocks read/update/delete and insert for ${index === 1 ? "same organization / other conference" : "other organization"}`, async () => {
        await withTenant(pool, scopes[0]!, async (_db, client) => {
          expect(
            (
              await client.query("SELECT * FROM phase0_rls.notes WHERE id=$1", [
                ids[index],
              ])
            ).rows,
          ).toEqual([]);
          expect(
            (
              await client.query(
                "UPDATE phase0_rls.notes SET body=$1 WHERE id=$2",
                ["forbidden", ids[index]],
              )
            ).rowCount,
          ).toBe(0);
          expect(
            (
              await client.query("DELETE FROM phase0_rls.notes WHERE id=$1", [
                ids[index],
              ])
            ).rowCount,
          ).toBe(0);
        });
        await expect(
          withTenant(pool, scopes[0]!, async (_db, client) => {
            const other = scopes[index]!;
            await client.query(
              "INSERT INTO phase0_rls.notes VALUES ($1,$2,$3,$4)",
              [
                other.organizationId,
                other.conferenceId,
                randomUUID(),
                "forbidden",
              ],
            );
          }),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          withTenant(pool, scopes[0]!, async (_db, client) => {
            await client.query(
              "UPDATE phase0_rls.notes SET organization_id=$1, conference_id=$2 WHERE id=$3",
              [
                scopes[index]!.organizationId,
                scopes[index]!.conferenceId,
                ids[0],
              ],
            );
          }),
        ).rejects.toMatchObject({ code: "42501" });
      });
    it("denies missing context, partial context and reused connections after commit", async () => {
      const pidBefore = (await pool.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      await withTenant(pool, scopes[1]!, async (_db, client) => {
        expect(
          (await client.query("SELECT body FROM phase0_rls.notes")).rows[0]
            .body,
        ).toBe("synthetic-1");
      });
      const pidAfter = (await pool.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      expect(pidAfter).toBe(pidBefore);
      expect((await pool.query("SELECT * FROM phase0_rls.notes")).rows).toEqual(
        [],
      );
      await expect(
        pool.query("INSERT INTO phase0_rls.notes VALUES ($1,$2,$3,$4)", [
          orgA,
          scopes[0]!.conferenceId,
          randomUUID(),
          "denied",
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.organization_id', $1, true)",
          [orgA],
        );
        expect(
          (await client.query("SELECT * FROM phase0_rls.notes")).rows,
        ).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
    it("rolls back data and clears scope after failure", async () => {
      const id = randomUUID();
      await expect(
        withTenant(pool, scopes[0]!, async (_db, client) => {
          await client.query(
            "INSERT INTO phase0_rls.notes VALUES ($1,$2,$3,$4)",
            [orgA, scopes[0]!.conferenceId, id, "rollback"],
          );
          throw new Error("synthetic failure");
        }),
      ).rejects.toThrow("synthetic failure");
      expect((await pool.query("SELECT * FROM phase0_rls.notes")).rows).toEqual(
        [],
      );
      await withTenant(pool, scopes[0]!, async (_db, client) => {
        expect(
          (
            await client.query("SELECT * FROM phase0_rls.notes WHERE id=$1", [
              id,
            ])
          ).rows,
        ).toEqual([]);
      });
    });
    it("composite foreign keys reject references to another conference or organization", async () => {
      for (const index of [1, 2])
        await expect(
          withTenant(pool, scopes[0]!, async (_db, client) => {
            await client.query(
              "INSERT INTO phase0_rls.attachments VALUES ($1,$2,$3,$4)",
              [orgA, scopes[0]!.conferenceId, randomUUID(), ids[index]],
            );
          }),
        ).rejects.toMatchObject({ code: "23503" });
    });
    it("keeps concurrent callers isolated even when a single pooled connection is reused", async () => {
      const values = await Promise.all(
        scopes.map((scope) =>
          withTenant(
            pool,
            scope,
            async (_db, client) =>
              (await client.query("SELECT body FROM phase0_rls.notes")).rows[0]
                .body,
          ),
        ),
      );
      expect(values).toEqual(["synthetic-0", "synthetic-1", "synthetic-2"]);
    });
  });
