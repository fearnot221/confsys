import { renderBadges } from "../../packages/documents/src/index.js";
import { createDocumentJobsService } from "../../apps/api/src/document-jobs/service.js";
import {
  startDocumentWorker,
  processDocumentJob,
  recoverDocumentJobs,
} from "../../packages/documents/src/worker.js";
import { writeFile, mkdir } from "node:fs/promises";
import { Redis } from "ioredis";
import { buildApp } from "../../apps/api/src/app.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { registerOnsiteRoutes } from "../../apps/api/src/onsite/routes.js";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createOnsiteService } from "../../apps/api/src/onsite/service.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createOnsiteService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  rid = () => randomUUID();
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const l = await auth.login(email, password, rid());
  return { id: l.account.user.id, email, raw: l.raw };
}
let owner: Awaited<ReturnType<typeof account>>,
  other: Awaited<ReturnType<typeof account>>,
  admin: Awaited<ReturnType<typeof account>>,
  staff: Awaited<ReturnType<typeof account>>,
  version: number;
const registrationId = rid(),
  orderId = rid(),
  activityId = rid(),
  bookingId = rid(),
  addonOrder = rid();
let token: string;
let pendingBadgeJob: string;
const jobs = createDocumentJobsService(f.app, f.config);
beforeAll(async () => {
  f.migrate();
  owner = await account();
  other = await account();
  admin = await account();
  staff = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: admin.id,
      apply: true,
      reason: "Synthetic onsite bootstrap",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  await access.mutate(
    admin.raw,
    staff.id,
    { action: "grant", role: "onsite", reason: "Synthetic onsite role" },
    rid(),
  );
  staff.raw = (await auth.login(staff.email, password, rid())).raw;
  version = Number(
    (
      await f.admin.query(
        "SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions",
      )
    ).rows[0].version,
  );
  await f.admin.query(
    "INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,'{}',$2)",
    [version, admin.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'合成免費報名','confirmed','陳怡君','合成研究所','{}','synthetic',$5,'synthetic')",
    [registrationId, owner.id, version, rid(), rid()],
  );
  await f.admin.query(
    "INSERT INTO confsys.orders(id,registration_id,user_id,state,amount,currency,kind) VALUES($1,$2,$3,'open',0,'TWD','registration'),($4,$2,$3,'open',0,'TWD','activity')",
    [orderId, registrationId, owner.id, addonOrder],
  );
  await f.admin.query(
    "INSERT INTO confsys.activity_versions(id,version,document,created_by) VALUES($1,1,$2,$3)",
    [activityId, { name: "午餐", capacity: 5 }, admin.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.activities(id,version) VALUES($1,1)",
    [activityId],
  );
  await f.admin.query(
    "INSERT INTO confsys.activity_bookings(id,registration_id,user_id,activity_id,activity_version,quantity,meal_type,state,order_id,snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,1,2,'vegetarian','reserved',$5,$6,$7,'synthetic')",
    [
      bookingId,
      registrationId,
      owner.id,
      activityId,
      addonOrder,
      { name: "午餐", capacity: 5 },
      rid(),
    ],
  );
});
afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.document_jobs WHERE requester_id=ANY($1::uuid[])",
    [[admin.id, staff.id]],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_redemption_reversals WHERE redemption_id IN(SELECT id FROM confsys.onsite_redemptions WHERE booking_id=$1)",
    [bookingId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_redemptions WHERE booking_id=$1",
    [bookingId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_checkin_reversals WHERE checkin_id IN(SELECT id FROM confsys.onsite_checkins WHERE registration_id=$1)",
    [registrationId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_checkins WHERE registration_id=$1",
    [registrationId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_tokens WHERE registration_id=$1",
    [registrationId],
  );
  await f.admin.query("DELETE FROM confsys.activity_bookings WHERE id=$1", [
    bookingId,
  ]);
  await f.admin.query("DELETE FROM confsys.activities WHERE id=$1", [
    activityId,
  ]);
  await f.admin.query("DELETE FROM confsys.activity_versions WHERE id=$1", [
    activityId,
  ]);
  await f.admin.query("DELETE FROM confsys.orders WHERE registration_id=$1", [
    registrationId,
  ]);
  await f.admin.query("DELETE FROM confsys.registrations WHERE id=$1", [
    registrationId,
  ]);
  await f.admin.query(
    "DELETE FROM confsys.registration_config_versions WHERE version=$1",
    [version],
  );
  await f.cleanup();
});
it("owner-only rotating opaque pass and QR; staff minimum lookup, no unauthenticated or ordinary access", async () => {
  const pass = await service.pass(owner.raw, { registrationId }, rid());
  token = pass.token;
  expect(token).toMatch(/^cs1_[A-Za-z0-9_-]{43}$/);
  expect(token).not.toContain(owner.id);
  expect(
    (await service.qr(owner.raw, registrationId)).subarray(1, 4).toString(),
  ).toBe("PNG");
  await expect(
    service.pass(other.raw, { registrationId }, rid()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.qr(other.raw, registrationId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(service.lookup(owner.raw, { token })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(service.lookup(undefined, { token })).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  const result = await service.lookup(staff.raw, { token });
  expect(result).toMatchObject({
    badgeName: "陳怡君",
    eligible: true,
    bookings: [{ quantity: 2, redeemed: 0, eligible: true }],
  });
  expect(result).not.toHaveProperty("email");
  expect(result).not.toHaveProperty("userId");
  const rotated = await service.pass(
    owner.raw,
    { registrationId, rotate: true },
    rid(),
  );
  await expect(service.lookup(staff.raw, { token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  token = rotated.token;
  const changedKey = createOnsiteService(f.app, {
    ...f.config,
    QR_SIGNING_KEY: "ff".repeat(32),
  });
  await expect(changedKey.lookup(staff.raw, { token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    (await f.app.query("SELECT * FROM confsys.onsite_tokens")).rowCount,
  ).toBe(0);
  await expect(
    f.worker.query("SELECT * FROM confsys.onsite_tokens"),
  ).rejects.toMatchObject({ code: "42501" });
});
it("concurrent check-in is unique, undo preserves history and role restriction; replay after undo stays reversed", async () => {
  const key = rid(),
    results = await Promise.all([
      service.checkin(staff.raw, { token, idempotencyKey: key }, rid()),
      service.checkin(staff.raw, { token, idempotencyKey: rid() }, rid()),
    ]);
  expect(results[0]?.id).toBe(results[1]?.id);
  const id = results[0]!.id;
  await expect(
    service.undo(
      staff.raw,
      { kind: "checkin", id, reason: "Synthetic wrong scan" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await service.undo(
    admin.raw,
    { kind: "checkin", id, reason: "Synthetic wrong scan" },
    rid(),
  );
  expect(
    (await service.checkin(staff.raw, { token, idempotencyKey: key }, rid()))
      .active,
  ).toBe(false);
  expect(
    (await service.checkin(staff.raw, { token, idempotencyKey: rid() }, rid()))
      .active,
  ).toBe(true);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.onsite_checkin_reversals WHERE checkin_id=$1",
        [id],
      )
    ).rows[0].count,
  ).toBe("1");
});
it("redemption retry consumes once; concurrent excess rejected; reversal restores quantity and unpaid charge blocks", async () => {
  const key = rid(),
    input = { token, bookingId, quantity: 1, idempotencyKey: key };
  const a = await service.redeem(staff.raw, input, rid()),
    b = await service.redeem(staff.raw, input, rid());
  expect(a).toEqual(b);
  await expect(
    service.redeem(staff.raw, { ...input, quantity: 2 }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const results = await Promise.allSettled([
    service.redeem(staff.raw, { ...input, idempotencyKey: rid() }, rid()),
    service.redeem(staff.raw, { ...input, idempotencyKey: rid() }, rid()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await service.lookup(staff.raw, { token })).bookings[0]?.redeemed,
  ).toBe(2);
  await expect(
    f.admin.query(
      "UPDATE confsys.activity_bookings SET state='cancelled' WHERE id=$1",
      [bookingId],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await service.undo(
    admin.raw,
    { kind: "redemption", id: a.id, reason: "Synthetic quantity correction" },
    rid(),
  );
  expect(
    (await service.lookup(staff.raw, { token })).bookings[0]?.redeemed,
  ).toBe(1);
  await f.admin.query("UPDATE confsys.orders SET amount=100 WHERE id=$1", [
    addonOrder,
  ]);
  await expect(
    service.redeem(staff.raw, { ...input, idempotencyKey: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query("UPDATE confsys.orders SET amount=0 WHERE id=$1", [
    addonOrder,
  ]);
});
it("real Redis worker builds private CJK/QR batch; idempotency and token rotation protect old outputs", async () => {
  const key = rid(),
    input = { registrationIds: [registrationId], idempotencyKey: key };
  await expect(jobs.create(owner.raw, input, rid())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const job = await jobs.create(staff.raw, input, rid());
  expect(await jobs.create(staff.raw, input, rid())).toEqual(job);
  expect((await jobs.list(admin.raw, 0)).items).toHaveLength(0);
  await expect(jobs.download(admin.raw, job.id, rid())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const worker = startDocumentWorker(
    f.worker,
    f.workerConfig,
    `synthetic-documents-${rid()}`,
  );
  try {
    await worker.worker.waitUntilReady();
    await expect
      .poll(
        async () =>
          (await jobs.list(staff.raw, 0)).items.find((j) => j.id === job.id)
            ?.status,
        { timeout: 15000 },
      )
      .toBe("ready");
  } finally {
    await worker.close();
  }
  const file = await jobs.download(staff.raw, job.id, rid());
  expect(file.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(file.bytes.length).toBeLessThan(16_777_216);
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/synthetic-qr-badge.pdf", file.bytes);
  const rotated = await service.pass(
    owner.raw,
    { registrationId, rotate: true },
    rid(),
  );
  token = rotated.token;
  await expect(jobs.download(staff.raw, job.id, rid())).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const retry = await jobs.create(
    staff.raw,
    { registrationIds: [registrationId], idempotencyKey: rid() },
    rid(),
  );
  await f.admin.query(
    "UPDATE confsys.document_jobs SET status='processing',attempts=1,claim_id=$2,lease_until=now()-interval '1 second' WHERE id=$1",
    [retry.id, rid()],
  );
  await recoverDocumentJobs(f.worker);
  expect(
    (await jobs.list(staff.raw, 0)).items.find((j) => j.id === retry.id)
      ?.status,
  ).toBe("pending");
  await processDocumentJob(f.worker, f.workerConfig, retry.id);
  expect(
    (await jobs.list(staff.raw, 0)).items.find((j) => j.id === retry.id)
      ?.status,
  ).toBe("ready");
  const midRender = (
    await jobs.create(
      staff.raw,
      { registrationIds: [registrationId], idempotencyKey: rid() },
      rid(),
    )
  ).id;
  await processDocumentJob(
    f.worker,
    f.workerConfig,
    midRender,
    async (badges) => {
      await access.mutate(
        admin.raw,
        staff.id,
        {
          action: "revoke",
          role: "onsite",
          reason: "Synthetic mid-render revoke",
        },
        rid(),
      );
      return renderBadges(badges);
    },
  );
  expect(
    (
      await f.admin.query(
        "SELECT status,pdf FROM confsys.document_jobs WHERE id=$1",
        [midRender],
      )
    ).rows[0],
  ).toEqual({ status: "cancelled", pdf: null });
  await access.mutate(
    admin.raw,
    staff.id,
    { action: "grant", role: "onsite", reason: "Synthetic restore onsite" },
    rid(),
  );
  staff.raw = (await auth.login(staff.email, password, rid())).raw;
  await expect(jobs.download(staff.raw, retry.id, rid())).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
  pendingBadgeJob = (
    await jobs.create(
      staff.raw,
      { registrationIds: [registrationId], idempotencyKey: rid() },
      rid(),
    )
  ).id;
  expect(
    (await f.app.query("SELECT * FROM confsys.document_jobs")).rowCount,
  ).toBe(0);
});
it("audit failure rolls back redemption and revoked staff loses access", async () => {
  const failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.onsite_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER onsite_test_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.onsite_test_failure()",
  );
  try {
    await expect(
      service.redeem(
        staff.raw,
        { token, bookingId, quantity: 1, idempotencyKey: rid() },
        failure,
      ),
    ).rejects.toThrow();
    expect(
      (await service.lookup(staff.raw, { token })).bookings[0]?.redeemed,
    ).toBe(1);
  } finally {
    await f.admin.query(
      "DROP TRIGGER onsite_test_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.onsite_test_failure()");
  }
  await access.mutate(
    admin.raw,
    staff.id,
    { action: "revoke", role: "onsite", reason: "Synthetic revoke staff" },
    rid(),
  );
  await expect(service.lookup(staff.raw, { token })).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await processDocumentJob(f.worker, f.workerConfig, pendingBadgeJob);
  expect(
    (
      await f.admin.query(
        "SELECT status,result_code FROM confsys.document_jobs WHERE id=$1",
        [pendingBadgeJob],
      )
    ).rows[0],
  ).toEqual({ status: "cancelled", result_code: "INELIGIBLE" });
});

it("HTTP pass mutations enforce origin/CSRF; QR is private and raw token never authenticates", async () => {
  const up = async () => {},
    server = buildApp({ postgres: up, redis: up, worker: up }),
    redis = new Redis(f.config.REDIS_URL);
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(
      redis,
      f.config.CSRF_SIGNING_KEY,
      `onsite-${rid()}`,
    ),
  });
  registerOnsiteRoutes(server, f.config, service);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    const csrf = await server.inject({
        url: "/api/auth/csrf",
        headers: { host },
      }),
      cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers = {
      host,
      cookie: `dev-session=${owner.raw}; ${cookie}`,
      origin: f.config.PUBLIC_APP_ORIGIN,
      "x-csrf-token": csrf.json().csrfToken,
    };
    for (const extra of [
      { origin: "https://evil.invalid" },
      { "x-csrf-token": "" },
    ])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/onsite/pass",
            payload: { registrationId },
            headers: { ...headers, ...extra },
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/onsite/pass",
          payload: { registrationId, userId: owner.id },
          headers,
        })
      ).statusCode,
    ).toBe(400);
    const pass = await server.inject({
      method: "POST",
      url: "/api/onsite/pass",
      payload: { registrationId },
      headers,
    });
    expect(pass.statusCode).toBe(200);
    const qr = await server.inject({ url: pass.json().qrPath, headers });
    expect(qr.statusCode).toBe(200);
    expect(qr.headers["cache-control"]).toContain("no-store");
    expect(qr.headers["content-type"]).toContain("image/png");
    expect(
      (
        await server.inject({
          url: pass.json().qrPath,
          headers: { host, cookie: `dev-session=${pass.json().token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await server.inject({ url: "/api/onsite/directory", headers }))
        .statusCode,
    ).toBe(403);
  } finally {
    redis.disconnect();
    await server.close();
  }
});
