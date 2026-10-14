import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { tokenHash } from "../../apps/api/src/auth/session.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createInvitationService } from "../../apps/api/src/invitations/service.js";
import { registerInvitationRoutes } from "../../apps/api/src/invitations/routes.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { buildApp } from "../../apps/api/src/app.js";
import {
  processNotification,
  createMailSender,
} from "../../packages/notifications/src/worker.js";
import { Redis } from "ioredis";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createInvitationService(f.app, f.config),
  access = createAccessService(f.app, f.config);
const rid = () => randomUUID();
async function active(admin = false) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  if (admin)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES ($1,'conference_admin')",
      [login.account.user.id],
    );
  return { email, id: login.account.user.id, raw: login.raw };
}
let leader: Awaited<ReturnType<typeof active>>;
const create = (
  target: Awaited<ReturnType<typeof active>>,
  role = "conference_staff",
  key = rid(),
) =>
  service.create(
    leader.raw,
    {
      email: target.email,
      role,
      reason: "Synthetic invitation test",
      idempotencyKey: key,
    },
    rid(),
  );
beforeAll(async () => {
  f.migrate();
  leader = await active(true);
});
afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.notification_secrets WHERE notification_id IN (SELECT n.id FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id WHERE u.email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE user_id IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.admin.query(
    "DELETE FROM confsys.role_invitations WHERE user_id IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.cleanup();
});
it("requires verified local recipient, administrator authority, fresh proof, and explicit idempotency", async () => {
  const target = await active(),
    input = {
      email: target.email,
      role: "conference_staff",
      reason: "Synthetic invitation test",
      idempotencyKey: rid(),
    };
  await expect(service.create(undefined, input, rid())).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await expect(service.create(target.raw, input, rid())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    service.create(leader.raw, { ...input, email: f.email() }, rid()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const pending = f.email();
  await auth.requestMail("register", pending, rid());
  await expect(
    service.create(leader.raw, { ...input, email: pending }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(create(leader)).rejects.toMatchObject({ code: "SELF_CHANGE" });
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(leader.raw)],
  );
  await expect(service.create(leader.raw, input, rid())).rejects.toMatchObject({
    code: "REAUTH_REQUIRED",
  });
  await auth.reauthenticate(leader.raw, password, rid());
  const results = await Promise.all([
    service.create(leader.raw, input, rid()),
    service.create(leader.raw, input, rid()),
  ]);
  expect(results[0]?.id).toBe(results[1]?.id);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.notifications WHERE invitation_id=$1",
        [results[0]?.id],
      )
    ).rows[0].count,
  ).toBe("1");
  await expect(
    service.create(leader.raw, { ...input, role: "conference_admin" }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(JSON.stringify(await service.list(leader.raw, {}))).not.toMatch(
    /token_hash|credential_version|idempotency|password/,
  );
  await expect(service.list(target.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("binds token to authenticated email/user, grants once and revokes all previous sessions", async () => {
  const target = await active(),
    other = await active();
  const created = await create(target);
  const token = (await f.link(target.email, "role_invitation")).token;
  await expect(
    service.accept(other.raw, { token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  expect((await auth.me(target.raw)).user.roles).toEqual([]);
  const second = (await auth.login(target.email, password, rid())).raw;
  const results = await Promise.allSettled([
    service.accept(target.raw, { token }, rid()),
    service.accept(second, { token }, rid()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(auth.me(target.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await expect(auth.me(second)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  target.raw = (await auth.login(target.email, password, rid())).raw;
  expect((await auth.me(target.raw)).user.roles).toEqual(["conference_staff"]);
  await expect(
    service.accept(target.raw, { token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.auth_audit WHERE event='invitation.accepted' AND user_id=$1",
        [target.id],
      )
    ).rows[0].count,
  ).toBe("1");
  await expect(
    service.revoke(
      leader.raw,
      created.id,
      { reason: "Already accepted" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("rejects expired/revoked tokens, records revoke idempotently, cancels unsent mail", async () => {
  for (const mode of ["expired", "revoked"]) {
    const target = await active(),
      created = await create(target),
      mail = await f.link(target.email, "role_invitation");
    if (mode === "expired")
      await f.admin.query(
        "UPDATE confsys.role_invitations SET created_at=now()-interval '4 days',expires_at=now()-interval '1 day' WHERE id=$1",
        [created.id],
      );
    else {
      expect(
        await service.revoke(
          leader.raw,
          created.id,
          { reason: "Synthetic revoke" },
          rid(),
        ),
      ).toEqual({ changed: true });
      expect(
        await service.revoke(
          leader.raw,
          created.id,
          { reason: "Synthetic revoke" },
          rid(),
        ),
      ).toEqual({ changed: false });
    }
    await expect(
      service.accept(target.raw, { token: mail.token }, rid()),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    let sent = false;
    await processNotification(f.worker, f.workerConfig, mail.id, async () => {
      sent = true;
      return { messageId: "should-not-send" };
    });
    expect(sent).toBe(false);
    expect(
      (
        await f.admin.query(
          "SELECT status FROM confsys.notifications WHERE id=$1",
          [mail.id],
        )
      ).rows[0].status,
    ).toBe("cancelled");
  }
});
it("issuer revocation and recipient disable/restore invalidate invitations permanently", async () => {
  const issuer = await active(true),
    target = await active();
  const item = await service.create(
    issuer.raw,
    {
      email: target.email,
      role: "conference_admin",
      reason: "Revoked authority regression",
      idempotencyKey: rid(),
    },
    rid(),
  );
  const token = (await f.link(target.email, "role_invitation")).token;
  await access.mutate(
    leader.raw,
    issuer.id,
    {
      action: "revoke",
      role: "conference_admin",
      reason: "Revoke issuer authority",
    },
    rid(),
  );
  await access.mutate(
    leader.raw,
    issuer.id,
    {
      action: "grant",
      role: "conference_admin",
      reason: "Restore issuer authority",
    },
    rid(),
  );
  await expect(
    service.accept(target.raw, { token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  expect(
    (
      await f.admin.query(
        "SELECT accepted_at FROM confsys.role_invitations WHERE id=$1",
        [item.id],
      )
    ).rows[0].accepted_at,
  ).toBeNull();
  await create(target);
  const fresh = (await f.link(target.email, "role_invitation")).token;
  await access.mutate(
    leader.raw,
    target.id,
    { action: "disable", reason: "Disable invited account" },
    rid(),
  );
  await access.mutate(
    leader.raw,
    target.id,
    { action: "restore", reason: "Restore invited account" },
    rid(),
  );
  target.raw = (await auth.login(target.email, password, rid())).raw;
  await expect(
    service.accept(target.raw, { token: fresh }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
});
it("audit/outbox failure rolls back invitation creation and acceptance", async () => {
  const target = await active(),
    failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.test_invitation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_invitation_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.test_invitation_failure()",
  );
  try {
    await expect(
      service.create(
        leader.raw,
        {
          email: target.email,
          role: "conference_staff",
          reason: "Rollback creation",
          idempotencyKey: rid(),
        },
        failure,
      ),
    ).rejects.toThrow();
    expect(
      (
        await f.admin.query(
          "SELECT count(*) FROM confsys.role_invitations WHERE user_id=$1",
          [target.id],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await f.admin.query(
          "SELECT count(*) FROM confsys.notifications WHERE user_id=$1 AND kind='role_invitation'",
          [target.id],
        )
      ).rows[0].count,
    ).toBe("0");
    await create(target);
    const token = (await f.link(target.email, "role_invitation")).token;
    await expect(
      service.accept(target.raw, { token }, failure),
    ).rejects.toThrow();
    expect((await auth.me(target.raw)).user.roles).toEqual([]);
    expect(await service.accept(target.raw, { token }, rid())).toEqual({
      changed: true,
    });
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_invitation_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.test_invitation_failure()");
  }
});
it("worker sends invitation through real Mailpit SMTP and retains no completed recipient projection", async () => {
  const target = await active();
  await create(target);
  const mail = await f.link(target.email, "role_invitation");
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(f.worker, f.workerConfig, mail.id, sender.send);
  } finally {
    sender.close();
  }
  expect(
    (
      await f.admin.query(
        "SELECT status FROM confsys.notifications WHERE id=$1",
        [mail.id],
      )
    ).rows[0].status,
  ).toBe("accepted");
  expect(
    (
      await f.worker.query(
        "SELECT * FROM confsys.notification_eligibility WHERE id=$1",
        [mail.id],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await f.admin.query(
        "SELECT * FROM confsys.notification_secrets WHERE notification_id=$1",
        [mail.id],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    f.worker.query("SELECT * FROM confsys.role_invitations"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.app.query(
      "UPDATE confsys.role_invitations SET role='conference_admin' WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("HTTP rejects CSRF, overposting, anonymous listing and token consumption by GET", async () => {
  const up = async () => {};
  const server = buildApp({ postgres: up, redis: up, worker: up }),
    redis = new Redis(f.config.REDIS_URL),
    namespace = `invitation-${rid()}`;
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace),
  });
  registerInvitationRoutes(server, f.config, service);
  try {
    const csrf = await server.inject("/api/auth/csrf"),
      token = csrf.json().csrfToken,
      cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const target = await active(),
      body = {
        email: target.email,
        role: "conference_staff",
        reason: "HTTP invitation",
        idempotencyKey: rid(),
      };
    const post = (payload: object, extra: Record<string, string> = {}) =>
      server.inject({
        method: "POST",
        url: "/api/access/invitations",
        payload,
        headers: {
          cookie: `${cookie}; dev-session=${leader.raw}`,
          origin: f.config.PUBLIC_APP_ORIGIN,
          "x-csrf-token": token,
          ...extra,
        },
      });
    expect((await server.inject("/api/access/invitations")).statusCode).toBe(
      401,
    );
    expect(
      (await post(body, { origin: "http://evil.invalid" })).statusCode,
    ).toBe(403);
    expect((await post(body, { "x-csrf-token": "" })).statusCode).toBe(403);
    expect((await post({ ...body, verified: true })).statusCode).toBe(400);
    const created = await post(body);
    expect(created.statusCode).toBe(200);
    expect(created.body).not.toMatch(/token|secret|password/);
    expect(
      (await server.inject("/api/access/invitations/accept")).statusCode,
    ).toBe(404);
  } finally {
    for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
    redis.disconnect();
    await server.close();
  }
});
