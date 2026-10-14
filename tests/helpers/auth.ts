import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createPool } from "@confsys/db";
import { loadApiConfig, loadWorkerConfig } from "@confsys/config";
import { unseal } from "@confsys/notifications";
export function testUrl(key: string, path: string) {
  const value = process.env[key];
  if (
    !value ||
    !["127.0.0.1", "localhost"].includes(new URL(value).hostname) ||
    new URL(value).pathname !== path
  )
    throw new Error(`Local test URL required: ${key}`);
  return value;
}
export function authFixture() {
  const config = loadApiConfig({
    ...process.env,
    DATABASE_URL: testUrl("TEST_DATABASE_URL", "/confsys_test"),
    REDIS_URL: testUrl("TEST_REDIS_URL", "/1"),
  });
  const workerConfig = loadWorkerConfig({
    ...process.env,
    WORKER_DATABASE_URL: testUrl("TEST_WORKER_DATABASE_URL", "/confsys_test"),
    REDIS_URL: config.REDIS_URL,
  });
  const admin = createPool(
    testUrl("TEST_MIGRATION_DATABASE_URL", "/confsys_test"),
  );
  const app = createPool(config.DATABASE_URL);
  const worker = createPool(workerConfig.WORKER_DATABASE_URL);
  const prefix = `auth-${randomUUID()}`;
  const email = () => `${prefix}-${randomUUID()}@example.invalid`;
  return {
    config,
    workerConfig,
    admin,
    app,
    worker,
    email,
    prefix,
    migrate() {
      execFileSync(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          "packages/db/src/migrate.ts",
        ],
        {
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
          },
          stdio: "pipe",
        },
      );
    },
    async link(address: string, kind = "verify") {
      const result = await admin.query<{
        id: string;
        ciphertext: string;
        key_version: string;
      }>(
        `SELECT n.id,s.ciphertext,s.key_version FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id JOIN confsys.notification_secrets s ON s.notification_id=n.id WHERE u.email=$1 AND n.kind=$2 ORDER BY n.created_at DESC LIMIT 1`,
        [address, kind],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Missing test notification");
      const link = unseal(
        row.ciphertext,
        row.id,
        config.MAIL_ENCRYPTION_KEY,
        row.key_version,
      );
      return {
        id: row.id,
        link,
        token: new URLSearchParams(new URL(link).hash.slice(1)).get("token")!,
      };
    },
    async cleanup() {
      const ids = (
        await admin.query<{ id: string }>(
          "SELECT id FROM confsys.users WHERE email LIKE $1",
          [`${prefix}%`],
        )
      ).rows.map((r) => r.id);
      await admin.query(
        "UPDATE confsys.access_control SET initialized_user_id=null,initialized_at=null WHERE initialized_user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.user_roles WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.auth_audit WHERE actor_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.notification_secrets WHERE notification_id IN (SELECT id FROM confsys.notifications WHERE user_id=ANY($1::uuid[]))",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.notifications WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.auth_audit WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.sessions WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM confsys.auth_tokens WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await admin.query("DELETE FROM confsys.users WHERE id=ANY($1::uuid[])", [
        ids,
      ]);
      await Promise.all([admin.end(), app.end(), worker.end()]);
    },
  };
}
export const password = "Synthetic conference phrase 938!";
export const replacement = "Replacement conference phrase 724!";
