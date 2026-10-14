import pg, { type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
export const tenantScopeSchema = z.strictObject({
  organizationId: z.uuid(),
  conferenceId: z.uuid(),
});
export type TenantScope = z.infer<typeof tenantScopeSchema>;
export function createPool(connectionString: string, max = 10) {
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 4000,
  });
  // Avoid unhandled idle socket errors; never log connection strings or query data.
  pool.on("error", () => console.error("Database idle connection failed"));
  return pool;
}
export async function assertRuntimeRole(
  pool: pg.Pool,
  expectedRole: "confsys_app" | "confsys_worker",
) {
  const result = await pool.query<{ safe: boolean }>(
    `SELECT current_user = $1 AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
 AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid AND c.relkind IN ('r','p'))
 AND NOT EXISTS (SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolbypassrls OR elevated.rolcreaterole OR elevated.rolname = 'confsys_migrator') AND pg_has_role(current_user, elevated.oid, 'MEMBER')) AS safe FROM pg_roles r WHERE rolname = current_user`,
    [expectedRole],
  );
  if (result.rows[0]?.safe !== true)
    throw new Error("Unsafe database runtime role");
}
export async function databaseReady(
  pool: pg.Pool,
  role: "confsys_app" | "confsys_worker",
) {
  await assertRuntimeRole(pool, role);
  const result = await pool.query(
    `SELECT version FROM confsys.schema_migrations WHERE version = '0001_foundation.sql'`,
  );
  if (result.rowCount !== 1) throw new Error("Database migrations required");
}
// Internal infrastructure primitive, NOT authentication. A future service must
// resolve scope from authenticated membership and resource ownership first.
export async function withTenant<T>(
  pool: pg.Pool,
  scope: TenantScope,
  work: (db: NodePgDatabase, client: PoolClient) => Promise<T>,
): Promise<T> {
  const parsed = tenantScopeSchema.parse(scope);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.organization_id', $1, true), set_config('app.conference_id', $2, true)`,
      [parsed.organizationId, parsed.conferenceId],
    );
    const result = await work(drizzle(client), client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
