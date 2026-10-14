import {completeSite} from "../helpers/site.js";
import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, copyFile, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, assertRuntimeRole } from "@confsys/db";
import { runMigrations } from "../../packages/db/src/migrations.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { loadApiConfig } from "@confsys/config";
import { testUrl } from "../helpers/auth.js";
it("migrates a blank isolated database and upgrades isolated Phase 0 / 520607e databases preserving credentials, sessions, outbox and audit", async () => {
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
    for (const kind of ["blank", "upgrade", "phase11b", "phase12", "phase13"]) {
      const name = `confsys_test_${kind}_${randomBytes(6).toString("hex")}`;
      cluster(`CREATE DATABASE ${name} OWNER confsys_migrator`);
      const url = new URL(original);
      url.pathname = `/${name}`;
      const pool = createPool(url.href, 1);
      try {
        let checksum: string | undefined;
        let saved: unknown;
        let accessSaved: unknown;
        let siteSaved: unknown;
        const userId = randomUUID(),
          tokenId = randomUUID(),
          tokenSecret = randomBytes(32).toString("base64url"),
          sessionSecret = randomBytes(32).toString("base64url"),
          notificationId = randomUUID();
        const snapshot = async () =>
          (
            await pool.query(
              `SELECT jsonb_build_object('users',(SELECT jsonb_agg(u) FROM confsys.users u),'tokens',(SELECT jsonb_agg(t) FROM confsys.auth_tokens t),'outbox',(SELECT jsonb_agg(to_jsonb(n)-'conference_name'-'invitation_id'-'event_key'-'message_subject'-'message_text'-'batch_id'-'available_at') FROM confsys.notifications n),'secrets',(SELECT jsonb_agg(s) FROM confsys.notification_secrets s),'audit',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'event',a.event,'user_id',a.user_id,'request_id',a.request_id,'created_at',a.created_at)) FROM confsys.auth_audit a)) AS data`,
            )
          ).rows[0].data;
        if (kind === "phase11b" || (kind === "phase12" || kind === "phase13")) {
          for (const file of ["0002_identity.sql", "0003_identity_grants.sql"])
            await copyFile(
              `packages/db/migrations/${file}`,
              join(directory, file),
            );
          await runMigrations(pool, directory);
          await pool.query(
            "INSERT INTO confsys.users(id,email,state,password_hash,verified_at,credential_version) VALUES ($1,'upgrade@example.invalid','active',$2,now(),1)",
            [userId, await hashPassword("Synthetic migration password 981!")],
          );
          await pool.query(
            "INSERT INTO confsys.auth_tokens(id,user_id,email,purpose,token_hash,expires_at) VALUES ($1,$2,'upgrade@example.invalid','reset',$3,now()+interval '1 hour')",
            [tokenId, userId, tokenHash(tokenSecret)],
          );
          await pool.query(
            "INSERT INTO confsys.sessions(id,user_id,token_hash,credential_version,created_at,last_seen_at,expires_at) VALUES ($1,$2,$3,1,now(),now(),now()+interval '1 hour')",
            [randomUUID(), userId, tokenHash(sessionSecret)],
          );
          await pool.query(
            "INSERT INTO confsys.notifications(id,scope,user_id,token_id,kind,request_id,expires_at) VALUES ($1,'identity',$2,$3,'reset',$4,now()+interval '1 hour')",
            [notificationId, userId, tokenId, randomUUID()],
          );
          await pool.query(
            "INSERT INTO confsys.notification_secrets(notification_id,key_version,ciphertext,expires_at) VALUES ($1,'synthetic','synthetic-preserved-envelope',now()+interval '1 hour')",
            [notificationId],
          );
          await pool.query(
            "INSERT INTO confsys.auth_audit(id,event,user_id,request_id) VALUES ($1,'login_succeeded',$2,$3)",
            [randomUUID(), userId, randomUUID()],
          );
          if ((kind === "phase12" || kind === "phase13")) {
            await copyFile(
              "packages/db/migrations/0004_access_control.sql",
              join(directory, "0004_access_control.sql"),
            );
            await runMigrations(pool, directory);
            await pool.query(
              "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
              [userId],
            );
            await pool.query(
              "UPDATE confsys.access_control SET initialized_user_id=$1,initialized_at=now()",
              [userId],
            );
          }
          if ((kind === "phase12" || kind === "phase13")) {
            await pool.query(
              "UPDATE confsys.sessions SET password_verified_at=now()",
            );
            await pool.query(
              "UPDATE confsys.auth_audit SET actor_id=$1,source='operator_cli',reason='preserved upgrade audit',before_value='before',after_value='after'",
              [userId],
            );
            accessSaved = (
              await pool.query(
                "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(r) FROM confsys.user_roles r),'control',(SELECT jsonb_agg(c) FROM confsys.access_control c),'sessions',(SELECT jsonb_agg(s) FROM confsys.sessions s),'audit',(SELECT jsonb_agg(a) FROM confsys.auth_audit a)) AS data",
              )
            ).rows[0].data;
          }
          if (kind === "phase13") {
            await copyFile("packages/db/migrations/0005_conference_site.sql",join(directory,"0005_conference_site.sql"));
            await runMigrations(pool,directory);
            const publication=randomUUID(), document=completeSite("Preserved Phase 1.3");
            await pool.query("INSERT INTO confsys.site_publications(id,source_draft_version,document,published_by,changed_fields) VALUES($1,1,$2,$3,'[]')",[publication,JSON.stringify(document),userId]);
            await pool.query("UPDATE confsys.site_state SET draft_version=2,document=$1,active_publication_id=$2",[JSON.stringify(completeSite("Unpublished prior draft")),publication]);
            siteSaved=(await pool.query("SELECT jsonb_build_object('state',(SELECT to_jsonb(s) FROM confsys.site_state s),'history',(SELECT jsonb_agg(p) FROM confsys.site_publications p)) AS data")).rows[0].data;
          }
          saved = await snapshot();
        }
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
        const expectedMigrations = await Promise.all((await readdir("packages/db/migrations")).filter(n => n.endsWith(".sql")).sort().map(async version => ({version,checksum:createHash("sha256").update(await readFile(`packages/db/migrations/${version}`)).digest("hex")})));
        expect((await pool.query("SELECT version,checksum FROM confsys.schema_migrations ORDER BY version")).rows).toEqual(expectedMigrations);
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
          ).toBe(kind === "phase11b" || (kind === "phase12" || kind === "phase13") ? "1" : "0");
          if (kind === "phase11b" || (kind === "phase12" || kind === "phase13")) {
            expect(await snapshot()).toEqual(saved);
            expect((await pool.query("SELECT available_at=created_at AS preserved FROM confsys.notifications WHERE id=$1",[notificationId])).rows[0]).toEqual({preserved:true});
            expect((await pool.query("SELECT invitation_id,event_key,message_subject,message_text,batch_id FROM confsys.notifications WHERE id=$1",[notificationId])).rows[0]).toEqual({invitation_id:null,event_key:null,message_subject:null,message_text:null,batch_id:null});
            if(kind === "phase13") expect((await pool.query("SELECT jsonb_build_object('state',(SELECT to_jsonb(s) FROM confsys.site_state s),'history',(SELECT jsonb_agg(p) FROM confsys.site_publications p)) AS data")).rows[0].data).toEqual(siteSaved);
            if ((kind === "phase12" || kind === "phase13"))
              expect(
                (
                  await pool.query(
                    "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(r) FROM confsys.user_roles r),'control',(SELECT jsonb_agg(c) FROM confsys.access_control c),'sessions',(SELECT jsonb_agg(s) FROM confsys.sessions s),'audit',(SELECT jsonb_agg(a) FROM confsys.auth_audit a)) AS data",
                  )
                ).rows[0].data,
              ).toEqual(accessSaved);

            if ((kind === "phase12" || kind === "phase13")) {
              expect(
                (
                  await pool.query(
                    "SELECT credential_version FROM confsys.users WHERE id=$1",
                    [userId],
                  )
                ).rows[0].credential_version,
              ).toBe(1);
              expect(
                (
                  await pool.query(
                    "SELECT initialized_at FROM confsys.access_control",
                  )
                ).rows[0].initialized_at,
              ).toBeInstanceOf(Date);
            }

            const service = createAuthService(
              runtime,
              loadApiConfig({ ...process.env, DATABASE_URL: runtimeUrl.href }),
            );
            expect((await service.me(sessionSecret)).user.roles).toEqual(
              (kind === "phase12" || kind === "phase13") ? ["conference_admin"] : [],
            );
            expect(
              (
                await runtime.query(
                  "SELECT password_verified_at,revoked_at FROM confsys.sessions",
                )
              ).rows[0],
            ).toEqual({
              password_verified_at:
                (kind === "phase12" || kind === "phase13") ? expect.any(Date) : null,
              revoked_at: null,
            });
            expect(
              (
                await runtime.query(
                  "SELECT initialized_user_id FROM confsys.access_control",
                )
              ).rows[0].initialized_user_id,
            ).toBe((kind === "phase12" || kind === "phase13") ? userId : null);
            if ((kind === "phase12" || kind === "phase13")) {
              await service.consume(
                "reset",
                tokenSecret,
                "Synthetic upgraded password 538!",
                randomUUID(),
              );
              await expect(service.me(sessionSecret)).rejects.toMatchObject({
                code: "SESSION_EXPIRED",
              });
              expect(
                (
                  await service.login(
                    "upgrade@example.invalid",
                    "Synthetic upgraded password 538!",
                    randomUUID(),
                  )
                ).account.user.roles,
              ).toEqual(["conference_admin"]);
            }
          }
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
