import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { withIdentityTransaction } from "@confsys/db";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createRegistrationService } from "../../apps/api/src/registration/service.js";
import { createFinanceService } from "../../apps/api/src/finance/service.js";
import { createFinanceReminderService } from "../../apps/api/src/finance-reminders/service.js";
import { createNotificationBatchService } from "../../apps/api/src/notification-batches/service.js";
import {
  createMailSender,
  processNotification,
} from "../../packages/notifications/src/worker.js";
import { Redis } from "ioredis";
import { buildApp } from "../../apps/api/src/app.js";
import {
  registerAuthRoutes,
  cookiePolicy,
} from "../../apps/api/src/auth/routes.js";
import { registerFinanceReminderRoutes } from "../../apps/api/src/finance-reminders/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
const f = authFixture(),
  rid = () => randomUUID(),
  auth = createAuthService(f.app, f.config),
  registration = createRegistrationService(f.app, f.config),
  finance = createFinanceService(f.app, f.config),
  reminders = createFinanceReminderService(f.app, f.config),
  batches = createNotificationBatchService(f.app, f.config);
const redis = new Redis(f.config.REDIS_URL),
  namespace = `reminder-http-${rid()}`,
  up = async () => {},
  app = buildApp({ postgres: up, redis: up, worker: up });
async function account(role?: string) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  if (role)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,$2)",
      [login.account.user.id, role],
    );
  return { id: login.account.user.id, raw: login.raw, email };
}
let admin: Awaited<ReturnType<typeof account>>,
  officer: typeof admin,
  person: typeof admin,
  unpaid: typeof admin,
  oldVersion: number | null,
  orderId: string,
  queuedId: string;
const input = (ids: string[]) => ({
  idempotencyKey: rid(),
  recipientIds: ids,
  reason: "Explicit synthetic payment reminder",
});
async function mailId(batchId: string) {
  return (
    await f.admin.query(
      "SELECT id FROM confsys.notifications WHERE batch_id=$1",
      [batchId],
    )
  ).rows[0].id as string;
}
async function send(batchId: string) {
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(
      f.worker,
      f.workerConfig,
      await mailId(batchId),
      sender.send,
    );
  } finally {
    sender.close();
  }
}
async function state(batchId: string) {
  return (
    await f.admin.query(
      "SELECT status,result_code,released_at FROM confsys.notifications WHERE batch_id=$1",
      [batchId],
    )
  ).rows[0];
}
beforeAll(async () => {
  f.migrate();
  await registerAuthRoutes(app, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace),
  });
  registerFinanceReminderRoutes(app, f.config, reminders);
  admin = await account("conference_admin");
  officer = await account("finance");
  person = await account();
  unpaid = await account();
  const previous = await registration.configuration();
  oldVersion = previous.version || null;
  const ticket = rid(),
    start = new Date(Date.now() - 3600000).toISOString(),
    end = new Date(Date.now() + 3600000).toISOString();
  const config = await registration.configure(
    admin.raw,
    {
      expectedVersion: previous.version,
      document: {
        opensAt: start,
        closesAt: end,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "Synthetic reminder consent",
        fields: [],
        tickets: [
          ...(previous.document?.tickets ?? []),
          {
            id: ticket,
            name: "Reminder ticket",
            capacity: 10,
            waitlist: false,
            rates: [{ startsAt: start, endsAt: end, amount: "100" }],
          },
        ],
      },
    },
    rid(),
  );
  for (const user of [person, unpaid]) {
    const result = await registration.create(
      user.raw,
      {
        idempotencyKey: rid(),
        configVersion: config.version,
        ticketId: ticket,
        badgeName: "Synthetic reminder attendee",
        affiliation: "Test",
        consent: true,
        answers: {},
      },
      rid(),
    );
    if (user === person) orderId = result.order!.id;
  }
});
afterAll(async () => {
  const ids = [admin?.id, officer?.id, person?.id, unpaid?.id].filter(Boolean);
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.refunds WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.payment_allocations WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  if (oldVersion !== undefined)
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      oldVersion,
    ]);
  await f.admin.query(
    "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await app.close();
  for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
  await redis.quit();
  await f.cleanup();
});
it("HTTP enforces permission, CSRF and bounded explicit recipient validation", async () => {
  const cookie = (raw: string) => `${cookiePolicy(f.config).name}=${raw}`;
  const denied = await app.inject({
    url: "/api/finance/reminders/audience",
    headers: { cookie: cookie(person.raw) },
  });
  expect(denied.statusCode).toBe(403);
  const allowed = await app.inject({
    url: "/api/finance/reminders/audience",
    headers: { cookie: cookie(officer.raw) },
  });
  expect(allowed.statusCode, allowed.body).toBe(200);
  const csrf = await app.inject("/api/auth/csrf"),
    csrfCookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const missing = await app.inject({
    method: "POST",
    url: "/api/finance/reminders",
    headers: {
      origin: f.config.PUBLIC_APP_ORIGIN,
      cookie: cookie(officer.raw),
    },
    payload: input([person.id]),
  });
  expect(missing.statusCode).toBe(403);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/finance/reminders",
    headers: {
      origin: f.config.PUBLIC_APP_ORIGIN,
      "x-csrf-token": csrf.json().csrfToken,
      cookie: `${csrfCookie}; ${cookie(officer.raw)}`,
    },
    payload: input(Array.from({ length: 101 }, () => rid())),
  });
  expect(invalid.statusCode).toBe(400);
});
it("requires finance scope, exposes exact net balances and creates one durable batch under concurrent retries", async () => {
  await expect(reminders.preview(person.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.finance_admin','true',true)");
    expect(
      (await db.query("SELECT * FROM confsys.finance_reminder_audience")).rows,
    ).toEqual([]);
  });
  await expect(
    f.worker.query("SELECT * FROM confsys.unpaid_order_balances"),
  ).rejects.toMatchObject({ code: "42501" });
  const preview = await reminders.preview(officer.raw, {});
  expect(preview.items.find((x) => x.id === person.id)?.balances).toEqual([
    { currency: "TWD", amount: "100" },
  ]);
  const data = input([person.id]);
  const [a, b] = await Promise.all([
    reminders.create(officer.raw, data, rid()),
    reminders.create(officer.raw, data, rid()),
  ]);
  expect(a.id).toBe(b.id);
  expect(a.kind).toBe("payment_reminder");
  expect(a.statuses).toEqual([{ status: "pending", count: 1 }]);
  queuedId = a.id;
  await expect(
    reminders.create(
      officer.raw,
      { ...data, reason: "Different audit reason" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [person.id]);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.user_notification_feed WHERE id=$1",
          [await mailId(a.id)],
        )
      ).rows,
    ).toEqual([]);
  });
});
it("delivers real SMTP and releases only worker-authorized inbox content", async () => {
  await send(queuedId);
  expect((await state(queuedId)).status).toBe("accepted");
  expect((await state(queuedId)).released_at).not.toBeNull();
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [person.id]);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.user_notification_feed WHERE id=$1",
          [await mailId(queuedId)],
        )
      ).rowCount,
    ).toBe(1);
  });
});
it("suppresses paid-before-preflight recipients and never releases stale inbox text", async () => {
  const batch = await reminders.create(officer.raw, input([person.id]), rid());
  const p = await finance.submit(
    person.raw,
    {
      idempotencyKey: rid(),
      amount: "100",
      currency: "TWD",
      reference: rid(),
      evidenceFileId: null,
    },
    rid(),
  );
  await finance.verify(
    officer.raw,
    { id: p.id, action: "verify", reason: "Payment received" },
    rid(),
  );
  await finance.allocate(
    officer.raw,
    {
      idempotencyKey: rid(),
      paymentId: p.id,
      orderId,
      amount: "100",
      reason: "Settle before reminder",
    },
    rid(),
  );
  await send(batch.id);
  expect(await state(batch.id)).toMatchObject({
    status: "cancelled",
    result_code: "INELIGIBLE",
    released_at: null,
  });
  await expect(
    reminders.create(officer.raw, input([person.id]), rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await reminders.preview(officer.raw, {})).items.some(
      (x) => x.id === person.id,
    ),
  ).toBe(false);
});
it("honors issuer revocation and explicit cancellation without granting general bulk mail to finance", async () => {
  await expect(
    batches.create(
      officer.raw,
      {
        idempotencyKey: rid(),
        recipientIds: [unpaid.id],
        subject: "Forbidden general",
        text: "Must not grant unrelated mail.",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const revoked = await reminders.create(
    officer.raw,
    input([unpaid.id]),
    rid(),
  );
  await f.admin.query(
    "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='finance'",
    [officer.id],
  );
  await send(revoked.id);
  expect((await state(revoked.id)).status).toBe("cancelled");
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'finance')",
    [officer.id],
  );
  const cancelled = await reminders.create(
    officer.raw,
    input([unpaid.id]),
    rid(),
  );
  await reminders.cancel(
    officer.raw,
    { id: cancelled.id, reason: "Cancel explicit pending reminder" },
    rid(),
  );
  await send(cancelled.id);
  expect((await state(cancelled.id)).status).toBe("cancelled");
});
it("known pre-SMTP retry preserves finance kind and audit failure rolls back batch and outbox", async () => {
  const batch = await reminders.create(officer.raw, input([unpaid.id]), rid());
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  const sender = createMailSender({
    ...f.workerConfig,
    SMTP_HOST: "localhost",
    SMTP_PORT: address.port,
  });
  try {
    for (let i = 0; i < 3; i++) {
      await f.admin.query(
        "UPDATE confsys.notifications SET next_attempt_at=now()-interval '1 second' WHERE batch_id=$1",
        [batch.id],
      );
      await processNotification(
        f.worker,
        f.workerConfig,
        await mailId(batch.id),
        sender.send,
      );
    }
  } finally {
    sender.close();
  }
  expect((await state(batch.id)).status).toBe("failed");
  await expect(
    batches.retry(
      admin.raw,
      {
        id: batch.id,
        idempotencyKey: rid(),
        reason: "Admin without finance cannot retry reminder",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'finance')",
    [admin.id],
  );
  const retry = await batches.retry(
    admin.raw,
    {
      id: batch.id,
      idempotencyKey: rid(),
      reason: "Retry confirmed preconnection failure",
    },
    rid(),
  );
  expect(retry.kind).toBe("payment_reminder");
  await send(retry.id);
  expect((await state(retry.id)).status).toBe("accepted");
  const requestId = rid(),
    data = input([unpaid.id]);
  await f.admin.query(
    `CREATE FUNCTION confsys.reminder_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${requestId}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER reminder_test_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.reminder_test_failure()",
  );
  try {
    await expect(
      reminders.create(officer.raw, data, requestId),
    ).rejects.toThrow();
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notification_batches WHERE idempotency_key=$1",
          [data.idempotencyKey],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notifications WHERE request_id=$1",
          [requestId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await f.admin.query(
      "DROP TRIGGER reminder_test_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.reminder_test_failure()");
  }
});

it("finance cancellation is conference-wide while creation cannot forge another issuer", async () => {
  const batch = await reminders.create(admin.raw, input([unpaid.id]), rid());
  const cancelled = await reminders.cancel(
    officer.raw,
    { id: batch.id, reason: "Finance colleague cancels pending reminder" },
    rid(),
  );
  expect(cancelled.cancelledAt).not.toBeNull();
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin','true',true),set_config('app.notifications_manage','false',true)",
        [officer.id],
      );
      await db.query(
        "INSERT INTO confsys.notification_batches(id,created_by,issuer_credential_version,idempotency_key,request_hash,subject,message_text,recipient_ids,kind) SELECT $1,id,credential_version,$2,'forged','Forged issuer','Must fail',ARRAY[$3]::uuid[],'payment_reminder' FROM confsys.users WHERE id=$4",
        [rid(), rid(), unpaid.id, admin.id],
      );
    }),
  ).rejects.toMatchObject({ code: "42501" });
});
