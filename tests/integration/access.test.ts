import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withIdentityTransaction } from "@confsys/db";
import { authFixture, password, replacement } from "../helpers/auth.js";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { verifyPassword } from "../../apps/api/src/auth/password.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import {
  lockAccess,
  assertAdministratorRemains,
} from "../../apps/api/src/access/repository.js";
import { buildApp } from "../../apps/api/src/app.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { registerAccessRoutes } from "../../apps/api/src/access/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { Redis } from "ioredis";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  access = createAccessService(f.app, f.config);
const instance = {
  conferenceName: f.config.CONFERENCE_NAME,
  origin: f.config.PUBLIC_APP_ORIGIN,
};
const rid = () => randomUUID();
const change = (raw: string, id: string, action: string, role?: string) =>
  access.mutate(
    raw,
    id,
    {
      action,
      reason: "synthetic access test",
      ...(role && (action === "grant" || action === "revoke") ? { role } : {}),
    },
    rid(),
  );
async function active() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  return { email, id: login.account.user.id, raw: login.raw };
}
let leader: Awaited<ReturnType<typeof active>>;
async function leaderLogin() {
  leader.raw = (await auth.login(leader.email, password, rid())).raw;
  return leader.raw;
}
const cli = async (id: string, apply = false, origin = instance.origin) =>
  promisify(execFile)(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "scripts/bootstrap-admin.ts",
      "--user-id",
      id,
      ...(apply
        ? [
            "--apply",
            "--reason",
            "synthetic bootstrap",
            "--confirm-origin",
            origin,
          ]
        : []),
    ],
    {
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
      },
      maxBuffer: 1024 * 1024,
    },
  );
beforeAll(() => f.migrate());
afterAll(() => f.cleanup());
it("CLI preview is inert; invalid targets/confirmation fail; two processes initialize exactly once", async () => {
  const a = await active(),
    b = await active();
  expect((await auth.me(a.raw)).user.roles).toEqual([]);
  const before = (
    await f.admin.query("SELECT count(*) FROM confsys.auth_audit")
  ).rows[0].count;
  expect(JSON.parse((await cli(a.id)).stdout)).toMatchObject({
    changed: false,
    completed: false,
  });
  expect(
    (await f.admin.query("SELECT count(*) FROM confsys.auth_audit")).rows[0]
      .count,
  ).toBe(before);
  await expect(auth.me(a.raw)).resolves.toBeDefined();
  await expect(cli(a.id, true, "http://wrong.localhost")).rejects.toBeDefined();
  await expect(cli(randomUUID(), true)).rejects.toBeDefined();
  const pending = f.email();
  await auth.requestMail("register", pending, rid());
  const pendingId = (
    await f.admin.query("SELECT id FROM confsys.users WHERE email=$1", [
      pending,
    ])
  ).rows[0].id;
  await expect(cli(pendingId, true)).rejects.toBeDefined();
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    b.id,
  ]);
  await expect(cli(b.id, true)).rejects.toBeDefined();
  await f.admin.query("UPDATE confsys.users SET state='active' WHERE id=$1", [
    b.id,
  ]);
  const failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.test_bootstrap_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_bootstrap_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.test_bootstrap_failure()",
  );
  try {
    await expect(
      bootstrapAdministrator(
        f.admin,
        instance,
        {
          targetId: a.id,
          apply: true,
          reason: "rollback initialization",
          confirmOrigin: instance.origin,
        },
        failure,
      ),
    ).rejects.toThrow();
    expect(
      (
        await f.admin.query(
          "SELECT initialized_user_id FROM confsys.access_control",
        )
      ).rows[0].initialized_user_id,
    ).toBeNull();
    expect((await auth.me(a.raw)).user.roles).toEqual([]);
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_bootstrap_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.test_bootstrap_failure()");
  }
  await expect(
    bootstrapAdministrator(f.app, instance, { targetId: a.id }, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const results = await Promise.allSettled([cli(a.id, true), cli(b.id, true)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  leader = results[0]?.status === "fulfilled" ? a : b;
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.user_roles WHERE role='conference_admin'",
      )
    ).rows[0].count,
  ).toBe("1");
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.auth_audit WHERE event='access.bootstrap'",
      )
    ).rows[0].count,
  ).toBe("1");
  await expect(auth.me(leader.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  expect(JSON.parse((await cli(leader.id, true)).stdout).changed).toBe(false);
  await leaderLogin();
});
it("service entry points deny ordinary/staff, own changes, illegal targets; grants/revokes are idempotent and revoke sessions", async () => {
  const user = await active();
  await expect(access.directory(user.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(change(user.raw, leader.id, "disable")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    change(leader.raw, leader.id, "revoke", "conference_admin"),
  ).rejects.toMatchObject({ code: "SELF_CHANGE" });
  await expect(change(leader.raw, leader.id, "disable")).rejects.toMatchObject({
    code: "SELF_CHANGE",
  });
  await expect(
    change(leader.raw, randomUUID(), "grant", "conference_staff"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await change(leader.raw, user.id, "grant", "conference_staff"),
  ).toEqual({ changed: true });
  await expect(auth.me(user.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  user.raw = (await auth.login(user.email, password, rid())).raw;
  expect(
    await change(leader.raw, user.id, "grant", "conference_staff"),
  ).toEqual({ changed: false });
  await expect(auth.me(user.raw)).resolves.toBeDefined();
  expect(
    (await access.directory(user.raw, { search: user.email })).items,
  ).toHaveLength(1);
  await expect(access.audit(user.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    change(user.raw, leader.id, "grant", "conference_admin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await change(leader.raw, user.id, "revoke", "conference_staff"),
  ).toEqual({ changed: true });
  user.raw = (await auth.login(user.email, password, rid())).raw;
  expect(
    await change(leader.raw, user.id, "revoke", "conference_staff"),
  ).toEqual({ changed: false });
  await expect(auth.me(user.raw)).resolves.toBeDefined();
});
it("disable invalidates reset tokens/sessions; restore retains only unrevoked bindings without altering password", async () => {
  const target = await active();
  await change(leader.raw, target.id, "grant", "conference_staff");
  target.raw = (await auth.login(target.email, password, rid())).raw;
  await auth.requestMail("forgot", target.email, rid());
  const token = (await f.link(target.email, "reset")).token;
  await change(leader.raw, target.id, "disable");
  await expect(auth.me(target.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await expect(auth.login(target.email, password, rid())).rejects.toMatchObject(
    { code: "INVALID_CREDENTIALS" },
  );
  await expect(
    auth.consume("reset", token, replacement, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await change(leader.raw, target.id, "revoke", "conference_staff");
  await change(leader.raw, target.id, "restore");
  await expect(
    auth.consume("reset", token, replacement, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await expect(auth.me(target.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  expect(
    (await auth.login(target.email, password, rid())).account.user.roles,
  ).toEqual([]);
  const preserved = await active();
  await change(leader.raw, preserved.id, "grant", "conference_staff");
  await change(leader.raw, preserved.id, "disable");
  await change(leader.raw, preserved.id, "restore");
  expect(
    (await auth.login(preserved.email, password, rid())).account.user.roles,
  ).toEqual(["conference_staff"]);
});
it("recent proof expires, reauth refreshes only its session; failed proof persists safe audit; revoked/reset proof cannot survive", async () => {
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(leader.raw)],
  );
  const target = await active();
  await expect(change(leader.raw, target.id, "disable")).rejects.toMatchObject({
    code: "REAUTH_REQUIRED",
  });
  const requestId = rid();
  await expect(
    auth.reauthenticate(leader.raw, "incorrect", requestId),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  expect(
    (
      await f.admin.query(
        "SELECT event FROM confsys.auth_audit WHERE request_id=$1",
        [requestId],
      )
    ).rows[0].event,
  ).toBe("reauthentication_failed");
  await auth.reauthenticate(leader.raw, password, rid());
  await change(leader.raw, target.id, "disable");
  await change(leader.raw, leader.id, "revoke_sessions");
  await expect(
    auth.reauthenticate(leader.raw, password, rid()),
  ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  await leaderLogin();
  const other = await active();
  await auth.requestMail("forgot", other.email, rid());
  await auth.consume(
    "reset",
    (await f.link(other.email, "reset")).token,
    replacement,
    rid(),
  );
  await expect(
    auth.reauthenticate(other.raw, password, rid()),
  ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
});
it("transaction invariant rejects zero admins even below the self-change policy; audit failure rolls back role/status/epoch/session", async () => {
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await lockAccess(db);
      await db.query(
        "DELETE FROM confsys.user_roles WHERE role='conference_admin'",
      );
      await assertAdministratorRemains(db);
    }),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  const target = await active(),
    failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.test_access_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_access_audit_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.test_access_audit_failure()",
  );
  try {
    for (const input of [
      { action: "grant", role: "conference_admin", reason: "rollback test" },
      { action: "disable", reason: "rollback test" },
    ])
      await expect(
        access.mutate(leader.raw, target.id, input, failure),
      ).rejects.toThrow();
    expect((await auth.me(target.raw)).user.roles).toEqual([]);
    expect(
      (
        await f.admin.query(
          "SELECT state,credential_version FROM confsys.users WHERE id=$1",
          [target.id],
        )
      ).rows[0],
    ).toMatchObject({ state: "active", credential_version: 1 });
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_access_audit_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.test_access_audit_failure()");
  }
  for (const sql of [
    "UPDATE confsys.auth_audit SET event=event WHERE false",
    "DELETE FROM confsys.auth_audit WHERE false",
    "UPDATE confsys.access_control SET initialized_at=null WHERE false",
  ])
    await expect(f.app.query(sql)).rejects.toMatchObject({ code: "42501" });
  for (const table of ["user_roles", "access_control", "auth_audit"])
    await expect(
      f.worker.query(`SELECT * FROM confsys.${table}`),
    ).rejects.toMatchObject({ code: "42501" });
});
it("concurrent administrators revoke/disable each other: waiting actor is rechecked, only one succeeds", async () => {
  for (const action of ["revoke", "disable"]) {
    const other = await active();
    await change(leader.raw, other.id, "grant", "conference_admin");
    other.raw = (await auth.login(other.email, password, rid())).raw;
    const old = leader;
    const results = await Promise.allSettled([
      change(old.raw, other.id, action, "conference_admin"),
      change(other.raw, old.id, action, "conference_admin"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    leader = results[0]?.status === "fulfilled" ? old : other;
    await leaderLogin();
    const loser = leader === old ? other : old;
    await expect(auth.me(loser.raw)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    expect(
      (
        await f.admin.query(
          "SELECT count(*) FROM confsys.users u JOIN confsys.user_roles r ON u.id=r.user_id WHERE r.role='conference_admin' AND u.state='active'",
        )
      ).rows[0].count,
    ).toBe("1");
  }
});
it("completed bootstrap never restores removed administrator rights", async () => {
  const original = (
    await f.admin.query(
      "SELECT initialized_user_id FROM confsys.access_control",
    )
  ).rows[0].initialized_user_id;
  if (original !== leader.id) {
    await change(leader.raw, original, "restore");
    await change(leader.raw, original, "revoke", "conference_admin");
  } else {
    const successor = await active();
    await change(leader.raw, successor.id, "grant", "conference_admin");
    successor.raw = (await auth.login(successor.email, password, rid())).raw;
    await change(successor.raw, leader.id, "revoke", "conference_admin");
    leader = successor;
  }
  expect(
    (
      await bootstrapAdministrator(
        f.admin,
        instance,
        {
          targetId: original,
          apply: true,
          reason: "do not restore",
          confirmOrigin: instance.origin,
        },
        rid(),
      )
    ).changed,
  ).toBe(false);
  expect(
    (
      await f.admin.query(
        "SELECT role FROM confsys.user_roles WHERE user_id=$1 AND role='conference_admin'",
        [original],
      )
    ).rowCount,
  ).toBe(0);
  await expect(cli(leader.id, true)).rejects.toBeDefined();
});
it("password verification racing disable, grant, forced logout and reauthentication cannot mint a surviving stale session", async () => {
  for (const action of ["disable", "grant", "revoke_sessions"]) {
    const target = await active();
    if (action === "revoke_sessions") await auth.logout(target.raw, rid());
    let resume!: () => void, ready!: () => void;
    const gate = new Promise<void>((r) => (resume = r)),
      started = new Promise<void>((r) => (ready = r));
    const racing = createAuthService(f.app, f.config, {
      verify: async (hash, value) => {
        const valid = await verifyPassword(hash, value);
        ready();
        await gate;
        return valid;
      },
    });
    const pending = racing.login(target.email, password, rid());
    const failed = expect(pending).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await started;
    await change(leader.raw, target.id, action, "conference_staff");
    resume();
    await failed;
  }
  const target = await active();
  let resume!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (resume = r)),
    started = new Promise<void>((r) => (ready = r));
  const racing = createAuthService(f.app, f.config, {
    verify: async (hash, value) => {
      const valid = await verifyPassword(hash, value);
      ready();
      await gate;
      return valid;
    },
  });
  const pending = racing.reauthenticate(target.raw, password, rid());
  const failed = expect(pending).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await started;
  await change(leader.raw, target.id, "disable");
  resume();
  await failed;
});
it("HTTP guards use real session/Redis, strict inputs, CSRF, bounded projections, and consistent errors", async () => {
  const up = async () => {};
  const server = buildApp({ postgres: up, redis: up, worker: up });
  const redis = new Redis(f.config.REDIS_URL);
  const namespace = `access-${rid()}`;
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace),
  });
  registerAccessRoutes(server, f.config, access);
  try {
    const csrf = await server.inject("/api/auth/csrf"),
      token = csrf.json().csrfToken;
    const cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (
      raw: string,
      path: string,
      body: object,
      extra: Record<string, string> = {},
    ) =>
      server.inject({
        method: "POST",
        url: path,
        payload: body,
        headers: {
          origin: f.config.PUBLIC_APP_ORIGIN,
          "x-csrf-token": token,
          cookie: `${cookie}; dev-session=${raw}`,
          ...extra,
        },
      });
    const target = await active();
    for (const headers of [
      { origin: "http://evil.invalid" },
      { "x-csrf-token": "" },
    ])
      expect(
        (
          await post(
            leader.raw,
            `/api/access/accounts/${target.id}/actions`,
            { action: "disable", reason: "test" },
            headers,
          )
        ).statusCode,
      ).toBe(403);
    for (const body of [
      {
        action: "grant",
        role: "conference_admin",
        reason: "test",
        system: true,
      },
      { action: "restore", reason: "test", verified: true },
    ])
      expect(
        (
          await post(
            leader.raw,
            `/api/access/accounts/${target.id}/actions`,
            body,
          )
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await post(target.raw, `/api/access/accounts/${leader.id}/actions`, {
          action: "disable",
          reason: "test",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(target.raw, "/api/auth/register", {
          email: f.email(),
          role: "conference_admin",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(leader.raw, "/api/auth/reauthenticate", {
          password,
          verifiedAt: new Date().toISOString(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          url: `/api/access/accounts/${leader.id}`,
          headers: { cookie: `dev-session=${target.raw}` },
        })
      ).statusCode,
    ).toBe(403);
    expect((await server.inject("/api/access/accounts")).statusCode).toBe(401);
    const response = await server.inject({
      url: "/api/access/accounts?limit=1",
      headers: { cookie: `dev-session=${leader.raw}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toMatch(
      /password|token_hash|credential_version|session/,
    );
    expect(
      (
        await server.inject({
          url: "/api/access/accounts?limit=10000",
          headers: { cookie: `dev-session=${leader.raw}` },
        })
      ).statusCode,
    ).toBe(400);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await post(target.raw, "/api/auth/reauthenticate", {
            password: "incorrect",
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (await post(target.raw, "/api/auth/reauthenticate", { password }))
        .statusCode,
    ).toBe(429);
    await expect(auth.me(target.raw)).resolves.toBeDefined();
  } finally {
    for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
    redis.disconnect();
    await server.close();
  }
});

it("password reset racing disable never re-enables account and old tokens stay invalid after restoration", async () => {
  const target = await active();
  await auth.requestMail("forgot", target.email, rid());
  const token = (await f.link(target.email, "reset")).token;
  const outcomes = await Promise.allSettled([
    auth.consume("reset", token, replacement, rid()),
    change(leader.raw, target.id, "disable"),
  ]);
  expect(outcomes[1]?.status).toBe("fulfilled");
  expect(
    (
      await f.admin.query("SELECT state FROM confsys.users WHERE id=$1", [
        target.id,
      ])
    ).rows[0].state,
  ).toBe("disabled");
  await expect(auth.me(target.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await change(leader.raw, target.id, "restore");
  await expect(
    auth.consume("reset", token, password, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
});
