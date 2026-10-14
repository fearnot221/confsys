import { registerReportingRoutes } from "../../apps/api/src/reporting/routes.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { buildApp } from "../../apps/api/src/app.js";
import { Redis } from "ioredis";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createReportingService } from "../../apps/api/src/reporting/service.js";
import { tokenHash } from "../../apps/api/src/auth/session.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createReportingService(f.app, f.config);
const rid = () => randomUUID();
async function active(admin = false) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  if (admin)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
      [login.account.user.id],
    );
  return { id: login.account.user.id, email, raw: login.raw };
}
let owner: Awaited<ReturnType<typeof active>>,
  other: Awaited<ReturnType<typeof active>>,
  admin: Awaited<ReturnType<typeof active>>;
beforeAll(async () => {
  f.migrate();
  owner = await active();
  other = await active();
  admin = await active(true);
});
afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.notification_reads WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
it("shows only own business messages, never identity links, and marks read idempotently with real RLS", async () => {
  const key = rid();
  await withIdentityTransaction(f.app, (db) =>
    enqueueBusinessNotification(db, f.config, {
      userId: owner.id,
      eventKey: key,
      subject: "Synthetic notice",
      text: "Visit your authenticated dashboard.",
      requestId: rid(),
    }),
  );
  const id = (
    await f.admin.query(
      "SELECT id FROM confsys.notifications WHERE event_key=$1",
      [key],
    )
  ).rows[0].id;
  expect((await service.list(owner.raw, {})).items).toHaveLength(1);
  expect((await service.list(other.raw, {})).items).toHaveLength(0);
  expect(JSON.stringify(await service.list(owner.raw, {}))).not.toMatch(
    /token|ciphertext|secret|request_id|user_id/,
  );
  await expect(service.read(other.raw, { id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query("SELECT set_config('app.actor_id',$1,true)", [other.id]);
      await db.query(
        "INSERT INTO confsys.notification_reads(notification_id,user_id) VALUES($1,$2)",
        [id, other.id],
      );
    }),
  ).rejects.toMatchObject({ code: "42501" });
  await Promise.all([
    service.read(owner.raw, { id }),
    service.read(owner.raw, { id }),
  ]);
  expect((await service.list(owner.raw, {})).items[0]?.readAt).not.toBeNull();
  const identity = (await f.link(owner.email)).id;
  await expect(service.read(owner.raw, { id: identity })).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
});
it("requires current admin permission and recent proof for exports/preview, audits explicit safe projections without impersonation", async () => {
  await expect(service.stats(owner.raw)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    service.export(
      owner.raw,
      { purpose: "Synthetic operational reconciliation", kind: "emails" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.preview(
      owner.raw,
      { userId: other.id, reason: "Synthetic support" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query(
    "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,$3)",
    [
      rid(),
      owner.id,
      JSON.stringify({
        title: "=PRIVATE_FORMULA()",
        trackId: "science",
        authors: [
          { name: "SECRET_COAUTHOR", email: "private@example.invalid" },
        ],
      }),
    ],
  );
  const requestId = rid(),
    preview = await service.preview(
      admin.raw,
      { userId: owner.id, reason: "Synthetic support check" },
      requestId,
    );
  expect(preview.readOnly).toBe(true);
  expect(preview.submissions[0]?.title).toBe("=PRIVATE_FORMULA()");
  expect(JSON.stringify(preview)).not.toMatch(
    /SECRET_COAUTHOR|private@example|password|internal/,
  );
  expect((await auth.me(admin.raw)).user.id).toBe(admin.id);
  const audit = (
    await f.admin.query(
      "SELECT actor_id,user_id,reason,after_value FROM confsys.auth_audit WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  expect(audit).toMatchObject({
    actor_id: admin.id,
    user_id: owner.id,
    reason: "Synthetic support check",
    after_value: JSON.stringify({ readOnly: true }),
  });
  const data = await service.export(
    admin.raw,
    { purpose: "Synthetic operational reconciliation", kind: "submissions" },
    rid(),
  );
  expect(data.csv).toContain("'=PRIVATE_FORMULA()");
  expect(data.csv).not.toContain("SECRET_COAUTHOR");
  const stat = await service.stats(admin.raw);
  expect(
    stat.submissions.find((r) => r.state === "draft")?.count,
  ).toBeGreaterThanOrEqual(1);
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(admin.raw)],
  );
  await expect(
    service.export(
      admin.raw,
      { purpose: "Synthetic operational reconciliation", kind: "emails" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await expect(
    service.preview(
      admin.raw,
      { userId: owner.id, reason: "Synthetic support" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await auth.reauthenticate(admin.raw, password, rid());
  await f.admin.query("DELETE FROM confsys.user_roles WHERE user_id=$1", [
    admin.id,
  ]);
  await expect(service.stats(admin.raw)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [admin.id],
  );
});
it("bounds exports and feed pagination and rejects revoked sessions", async () => {
  const keys = Array.from({ length: 21 }, () => rid());
  for (const key of keys)
    await withIdentityTransaction(f.app, (db) =>
      enqueueBusinessNotification(db, f.config, {
        userId: other.id,
        eventKey: key,
        subject: "Synthetic page",
        text: "Visit authenticated dashboard.",
        requestId: rid(),
      }),
    );
  const first = await service.list(other.raw, {});
  expect(first.items).toHaveLength(20);
  expect(first.nextOffset).toBe(20);
  const second = await service.list(other.raw, { offset: 20 });
  expect(second.items).toHaveLength(1);
  expect(second.nextOffset).toBeNull();
  expect(new Set([...first.items, ...second.items].map((n) => n.id)).size).toBe(
    21,
  );
  const data = await service.export(
    admin.raw,
    {
      purpose: "Synthetic operational reconciliation",
      kind: "emails",
      offset: 0,
    },
    rid(),
  );
  expect(data.rows).toBeLessThanOrEqual(100);
  expect(data.csv).toContain("email");
  await f.admin.query(
    "UPDATE confsys.sessions SET revoked_at=now() WHERE token_hash=$1",
    [tokenHash(other.raw)],
  );
  await expect(service.list(other.raw, {})).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
});

it("validates HTTP inputs and CSRF before exports and preview", async () => {
  const up = async () => {},
    server = buildApp({ postgres: up, redis: up, worker: up }),
    redis = new Redis(f.config.REDIS_URL),
    namespace = `reporting-${rid()}`;
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace),
  });
  registerReportingRoutes(server, f.config, service);
  try {
    const csrf = await server.inject("/api/auth/csrf"),
      token = csrf.json().csrfToken,
      cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (
      url: string,
      payload: object,
      extra: Record<string, string> = {},
    ) =>
      server.inject({
        method: "POST",
        url,
        payload,
        headers: {
          cookie: `${cookie}; dev-session=${admin.raw}`,
          origin: f.config.PUBLIC_APP_ORIGIN,
          "x-csrf-token": token,
          ...extra,
        },
      });
    expect((await server.inject("/api/notifications")).statusCode).toBe(401);
    expect(
      (
        await post(
          "/api/reporting/export",
          { purpose: "Synthetic operational reconciliation", kind: "emails" },
          { origin: "http://evil.invalid" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          "/api/reporting/export",
          { purpose: "Synthetic operational reconciliation", kind: "emails" },
          { "x-csrf-token": "" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post("/api/reporting/export", {
          kind: "emails",
          ownerId: owner.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post("/api/reporting/author-preview", {
          userId: owner.id,
          reason: "support",
          impersonate: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post("/api/reporting/export", {
          purpose: "Synthetic operational reconciliation",
          kind: "emails",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.inject("/api/reporting/author-preview")).statusCode,
    ).toBe(404);
  } finally {
    for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
    redis.disconnect();
    await server.close();
  }
});

it("reports one timestamped cross-domain snapshot with exact currency values and only aggregate notification states", async () => {
  const before = await service.stats(admin.raw),
    prior = before.payments.find(
      (r) => r.currency === "TWD" && r.state === "submitted",
    );
  await f.admin.query(
    "INSERT INTO confsys.payments(id,payer_id,state,amount,currency,reference,idempotency_key,request_hash) VALUES($1,$2,'submitted',125,'TWD',$3,$4,'synthetic-statistics')",
    [rid(), owner.id, rid(), rid()],
  );
  const start = Date.now(),
    result = await service.stats(admin.raw),
    payment = result.payments.find(
      (r) => r.currency === "TWD" && r.state === "submitted",
    );
  expect(result.timezone).toBe("UTC");
  expect(Date.parse(result.asOf)).toBeGreaterThanOrEqual(start - 100);
  expect(Date.parse(result.asOf)).toBeLessThanOrEqual(Date.now() + 100);
  expect(payment?.amount).toBe(String(BigInt(prior?.amount ?? "0") + 125n));
  expect(payment?.count).toBe((prior?.count ?? 0) + 1);
  expect(
    result.notifications.reduce((sum, r) => sum + r.count, 0),
  ).toBeGreaterThanOrEqual(22);
  for (const list of [
    result.registrationDates,
    result.tickets,
    result.allocations,
    result.refunds,
    result.activities,
    result.checkins,
    result.competitionEntries,
    result.competitionAssignments,
  ])
    expect(Array.isArray(list)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /password_hash|credential|reference|authorComment|privateComment/,
  );
});

it("personal data export requires an operator purpose and records it without adding historic/coauthor emails", async () => {
  await auth.reauthenticate(admin.raw, password, rid());
  for (const purpose of [undefined, "  ", "x".repeat(301)])
    await expect(
      service.export(admin.raw, { kind: "emails", purpose }, rid()),
    ).rejects.toBeDefined();
  const requestId = rid(),
    purpose = "Synthetic participant contact reconciliation";
  const result = await service.export(
    admin.raw,
    { kind: "emails", purpose },
    requestId,
  );
  expect(result.csv).toContain('"user_id","email"');
  const audit = (
    await f.admin.query(
      "SELECT reason FROM confsys.auth_audit WHERE request_id=$1 AND event='reporting.export'",
      [requestId],
    )
  ).rows;
  expect(audit).toEqual([{ reason: purpose }]);
  await expect(
    service.export(
      admin.raw,
      { kind: "emails", purpose },
      "invalid-audit-uuid",
    ),
  ).rejects.toBeDefined();
});
