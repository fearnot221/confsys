import { createServer } from "node:net";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createNotificationBatchService } from "../../apps/api/src/notification-batches/service.js";
import {
  createMailSender,
  processNotification,
} from "../../packages/notifications/src/worker.js";
import { withIdentityTransaction } from "@confsys/db";
import { tokenHash } from "../../apps/api/src/auth/session.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createNotificationBatchService(f.app, f.config);
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
let admin: Awaited<ReturnType<typeof active>>,
  recipient: Awaited<ReturnType<typeof active>>;
const input = () => ({
  idempotencyKey: rid(),
  recipientIds: [recipient.id],
  subject: "Synthetic capture batch",
  text: "Visit the authenticated conference dashboard.",
});
async function mailId(batchId: string) {
  return (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.notifications WHERE batch_id=$1",
      [batchId],
    )
  ).rows[0]!.id;
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
beforeAll(async () => {
  f.migrate();
  admin = await active(true);
  recipient = await active();
});
afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_template_versions WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
it("requires current permission and fresh proof, uses explicit verified recipients and creates one immutable outbox batch on retries", async () => {
  const data = input();
  await expect(
    service.create(recipient.raw, data, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.create(admin.raw, { ...data, recipientIds: [rid()] }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(admin.raw)],
  );
  await expect(service.create(admin.raw, data, rid())).rejects.toMatchObject({
    code: "REAUTH_REQUIRED",
  });
  await auth.reauthenticate(admin.raw, password, rid());
  const [one, two] = await Promise.all([
    service.create(admin.raw, data, rid()),
    service.create(admin.raw, data, rid()),
  ]);
  expect(one.id).toBe(two.id);
  expect(one.recipientCount).toBe(1);
  expect(one.statuses).toEqual([{ status: "pending", count: 1 }]);
  await expect(
    service.create(admin.raw, { ...data, text: "Different payload" }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.create(
      admin.raw,
      { ...input(), recipientIds: [recipient.id, recipient.id] },
      rid(),
    ),
  ).rejects.toThrow();
  await expect(
    f.worker.query("SELECT * FROM confsys.notification_batches"),
  ).rejects.toMatchObject({ code: "42501" });
  expect(JSON.stringify(await service.list(admin.raw, {}))).not.toMatch(
    /credential|recipient_ids|request_hash/,
  );
  await expect(service.list(recipient.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("delivers through real capture SMTP and records accepted without secrets, then never recalls an accepted attempt", async () => {
  const batch = await service.create(admin.raw, input(), rid());
  await send(batch.id);
  expect(
    (await service.list(admin.raw, {})).items.find((b) => b.id === batch.id)
      ?.statuses,
  ).toEqual([{ status: "accepted", count: 1 }]);
  await service.cancel(admin.raw, { id: batch.id }, rid());
  await send(batch.id);
  expect(
    (await service.list(admin.raw, {})).items.find((b) => b.id === batch.id)
      ?.statuses,
  ).toEqual([{ status: "accepted", count: 1 }]);
  expect(
    (
      await f.worker.query(
        "SELECT * FROM confsys.notification_batch_authority WHERE id=$1",
        [await mailId(batch.id)],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await f.admin.query(
        "SELECT * FROM confsys.notification_secrets WHERE notification_id=$1",
        [await mailId(batch.id)],
      )
    ).rows,
  ).toHaveLength(0);
});
it("cancels queued work after explicit cancellation, issuer permission removal, credential epoch change or recipient disable", async () => {
  const cancelled = await service.create(admin.raw, input(), rid());
  await service.cancel(admin.raw, { id: cancelled.id }, rid());
  await send(cancelled.id);
  const revoked = await service.create(admin.raw, input(), rid());
  await f.admin.query(
    "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='conference_admin'",
    [admin.id],
  );
  await send(revoked.id);
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [admin.id],
  );
  const disabled = await service.create(admin.raw, input(), rid());
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    recipient.id,
  ]);
  await send(disabled.id);
  await f.admin.query("UPDATE confsys.users SET state='active' WHERE id=$1", [
    recipient.id,
  ]);
  const epoch = await service.create(admin.raw, input(), rid());
  await f.admin.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [admin.id],
  );
  await send(epoch.id);
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  const rows = (await service.list(admin.raw, {})).items;
  for (const batch of [cancelled, revoked, disabled, epoch])
    expect(rows.find((b) => b.id === batch.id)?.statuses).toEqual([
      { status: "cancelled", count: 1 },
    ]);
});
async function connectionFailure(batchId: string) {
  // Bind then close a fresh loopback port: a real pre-SMTP connection refusal.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const sender = createMailSender({
    ...f.workerConfig,
    SMTP_HOST: "localhost",
    SMTP_PORT: port,
  });
  try {
    for (let i = 0; i < 3; i++) {
      await f.admin.query(
        "UPDATE confsys.notifications SET next_attempt_at=now()-interval '1 second' WHERE batch_id=$1",
        [batchId],
      );
      await processNotification(
        f.worker,
        f.workerConfig,
        await mailId(batchId),
        sender.send,
      );
    }
  } finally {
    sender.close();
  }
  expect(
    (
      await f.admin.query(
        "SELECT status,result_code FROM confsys.notifications WHERE batch_id=$1",
        [batchId],
      )
    ).rows,
  ).toEqual([{ status: "failed", result_code: "CONNECT_FAILED" }]);
}
it("retries only known pre-SMTP failures as one immutable child under concurrent idempotent requests, then sends through real Mailpit", async () => {
  const batch = await service.create(admin.raw, input(), rid());
  await connectionFailure(batch.id);
  expect(
    (await service.list(admin.raw, {})).items.find((b) => b.id === batch.id)
      ?.retryableCount,
  ).toBe(1);
  const request = {
    id: batch.id,
    idempotencyKey: rid(),
    reason: "Loopback SMTP restored after known connection failure",
  };
  const [one, two] = await Promise.all([
    service.retry(admin.raw, request, rid()),
    service.retry(admin.raw, request, rid()),
  ]);
  expect(one.id).toBe(two.id);
  expect(one.retryOf).toBe(batch.id);
  expect(one.statuses).toEqual([{ status: "pending", count: 1 }]);
  await expect(
    service.retry(admin.raw, { ...request, idempotencyKey: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.retry(
      admin.raw,
      { ...request, reason: "Changed reason payload" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const original = (await service.list(admin.raw, {})).items.find(
    (b) => b.id === batch.id,
  )!;
  expect(original).toMatchObject({
    retriedAs: one.id,
    retryableCount: 0,
    statuses: [{ status: "failed", count: 1 }],
  });
  await send(one.id);
  expect(
    (await service.list(admin.raw, {})).items.find((b) => b.id === one.id)
      ?.statuses,
  ).toEqual([{ status: "accepted", count: 1 }]);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::integer AS n FROM confsys.auth_audit WHERE event='notification_batch.retry' AND actor_id=$1",
        [admin.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("never retries unknown, accepted, pending, cancelled, expired or revoked authority, and audit failures roll back child and outbox", async () => {
  for (const state of ["unknown", "accepted", "pending", "cancelled"]) {
    const batch = await service.create(admin.raw, input(), rid());
    if (state !== "pending")
      await f.admin.query(
        "UPDATE confsys.notifications SET status=$2,result_code=$3 WHERE batch_id=$1",
        [
          batch.id,
          state,
          state === "unknown" ? "SMTP_UNCERTAIN" : "CONNECT_FAILED",
        ],
      );
    await expect(
      service.retry(
        admin.raw,
        {
          id: batch.id,
          idempotencyKey: rid(),
          reason: "Must not resend uncertain or ineligible delivery",
        },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
  const batch = await service.create(admin.raw, input(), rid());
  await connectionFailure(batch.id);
  const request = {
    id: batch.id,
    idempotencyKey: rid(),
    reason: "Explicit operator retry after connection recovery",
  };
  await expect(
    service.retry(recipient.raw, request, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    recipient.id,
  ]);
  await expect(service.retry(admin.raw, request, rid())).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await f.admin.query("UPDATE confsys.users SET state='active' WHERE id=$1", [
    recipient.id,
  ]);
  await f.admin.query(
    "UPDATE confsys.notifications SET expires_at=now()-interval '1 second' WHERE batch_id=$1",
    [batch.id],
  );
  await expect(service.retry(admin.raw, request, rid())).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await f.admin.query(
    "UPDATE confsys.notifications SET expires_at=now()+interval '1 hour' WHERE batch_id=$1",
    [batch.id],
  );
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(admin.raw)],
  );
  await expect(service.retry(admin.raw, request, rid())).rejects.toMatchObject({
    code: "REAUTH_REQUIRED",
  });
  await auth.reauthenticate(admin.raw, password, rid());
  const requestId = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.notification_retry_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${requestId}'::uuid THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER notification_retry_test_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.notification_retry_test_failure()",
  );
  try {
    await expect(
      service.retry(admin.raw, request, requestId),
    ).rejects.toThrow();
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notification_batches WHERE retry_of=$1",
          [batch.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notifications WHERE request_id=$1",
          [requestId],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await f.admin.query(
      "DROP TRIGGER notification_retry_test_failure ON confsys.auth_audit",
    );
    await f.admin.query(
      "DROP FUNCTION confsys.notification_retry_test_failure()",
    );
  }
  const operator = await active(true);
  await f.admin.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [admin.id],
  );
  await expect(
    service.retry(operator.raw, request, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
});
it("serializes different retry keys against the same source and refuses cancelled or older-than-seven-day batches", async () => {
  const batch = await service.create(admin.raw, input(), rid());
  await connectionFailure(batch.id);
  const outcomes = await Promise.allSettled([
    service.retry(
      admin.raw,
      {
        id: batch.id,
        idempotencyKey: rid(),
        reason: "Concurrent operator first request",
      },
      rid(),
    ),
    service.retry(
      admin.raw,
      {
        id: batch.id,
        idempotencyKey: rid(),
        reason: "Concurrent operator second request",
      },
      rid(),
    ),
  ]);
  expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((v) => v.status === "rejected")).toHaveLength(1);
  const cancelled = await service.create(admin.raw, input(), rid());
  await connectionFailure(cancelled.id);
  await service.cancel(admin.raw, { id: cancelled.id }, rid());
  await expect(
    service.retry(
      admin.raw,
      {
        id: cancelled.id,
        idempotencyKey: rid(),
        reason: "Cancelled source must stay cancelled",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const old = await service.create(admin.raw, input(), rid());
  await connectionFailure(old.id);
  await f.admin.query(
    "UPDATE confsys.notification_batches SET created_at=now()-interval '8 days' WHERE id=$1",
    [old.id],
  );
  await expect(
    service.retry(
      admin.raw,
      {
        id: old.id,
        idempotencyKey: rid(),
        reason: "Source outside explicit age window",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

const audienceFilters = {
  role: null,
  registration: "any",
  submission: "any",
  publishedOutcome: "any",
} as const;
it("previews only eligible local audience with current registration precedence and excludes unpublished decisions", async () => {
  await expect(
    service.preview(recipient.raw, audienceFilters),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await f.app.query("SELECT * FROM confsys.notification_audience")).rows,
  ).toHaveLength(0);
  const person = await active();
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'reviewer')",
    [person.id],
  );
  const version = Number(
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
  const paperId = rid(),
    revisionId = rid(),
    decisionId = rid();
  try {
    for (const state of ["cancelled", "cancelled", "confirmed"])
      await f.admin.query(
        "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'Synthetic',$5,'Synthetic','Institute','{}','Synthetic consent',$6,'synthetic')",
        [rid(), person.id, version, rid(), state, rid()],
      );
    const filters = {
      ...audienceFilters,
      role: "reviewer",
      registration: "confirmed",
    };
    const preview = await service.preview(admin.raw, filters);
    expect(preview.items).toContainEqual({
      id: person.id,
      email: person.email,
    });
    expect(
      (
        await service.preview(admin.raw, {
          ...filters,
          registration: "cancelled",
        })
      ).items.map((r) => r.id),
    ).not.toContain(person.id);
    await f.admin.query(
      "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,'{}')",
      [paperId, person.id],
    );
    await f.admin.query(
      "INSERT INTO confsys.submission_revisions(id,submission_id,owner_id,version,document,config_snapshot) VALUES($1,$2,$3,1,'{}','{}')",
      [revisionId, paperId, person.id],
    );
    await f.admin.query(
      "UPDATE confsys.submissions SET state='submitted',submitted_version=1,current_revision_id=$2 WHERE id=$1",
      [paperId, revisionId],
    );
    await f.admin.query(
      "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,1,'accept_oral','Published message','Private reason',$4)",
      [decisionId, paperId, revisionId, admin.id],
    );
    expect(
      (
        await service.preview(admin.raw, {
          ...filters,
          publishedOutcome: "accepted",
        })
      ).items.map((r) => r.id),
    ).not.toContain(person.id);
    await f.admin.query(
      "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
      [paperId, decisionId, admin.id],
    );
    expect(
      (
        await service.preview(admin.raw, {
          ...filters,
          publishedOutcome: "accepted",
        })
      ).items,
    ).toContainEqual({ id: person.id, email: person.email });
    await f.admin.query(
      "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='reviewer'",
      [person.id],
    );
    await expect(
      service.create(
        admin.raw,
        { ...input(), recipientIds: [person.id], audience: filters },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(preview)).not.toMatch(
      /Private reason|document|owner_id|roles/,
    );
  } finally {
    await f.admin.query(
      "DELETE FROM confsys.review_publications WHERE submission_id=$1",
      [paperId],
    );
    await f.admin.query("DELETE FROM confsys.review_decisions WHERE id=$1", [
      decisionId,
    ]);
    await f.admin.query(
      "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE id=$1",
      [paperId],
    );
    await f.admin.query(
      "DELETE FROM confsys.submission_revisions WHERE id=$1",
      [revisionId],
    );
    await f.admin.query("DELETE FROM confsys.submissions WHERE id=$1", [
      paperId,
    ]);
    await f.admin.query("DELETE FROM confsys.registrations WHERE user_id=$1", [
      person.id,
    ]);
    await f.admin.query(
      "DELETE FROM confsys.registration_config_versions WHERE version=$1",
      [version],
    );
  }
});
it("versions templates immutably and pins exact reviewed content to a batch", async () => {
  const data = {
    id: rid(),
    key: `notice-${rid()}`,
    expectedVersion: 0,
    name: "Synthetic announcement",
    subject: "Synthetic template subject",
    text: "Generic authenticated navigation only.",
  };
  await expect(
    service.saveTemplate(recipient.raw, data, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const first = await service.saveTemplate(admin.raw, data, rid());
  expect(await service.saveTemplate(admin.raw, data, rid())).toEqual(first);
  const updates = await Promise.allSettled([
    service.saveTemplate(
      admin.raw,
      { ...data, id: rid(), expectedVersion: 1, text: "Second version" },
      rid(),
    ),
    service.saveTemplate(
      admin.raw,
      {
        ...data,
        id: rid(),
        expectedVersion: 1,
        text: "Concurrent other version",
      },
      rid(),
    ),
  ]);
  expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(updates.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  expect(
    (await f.app.query("SELECT * FROM confsys.notification_template_versions"))
      .rows,
  ).toHaveLength(0);
  await expect(
    f.app.query(
      "UPDATE confsys.notification_template_versions SET subject=subject WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const batch = await service.create(
    admin.raw,
    {
      ...input(),
      subject: first.subject,
      text: first.text,
      templateVersionId: first.id,
    },
    rid(),
  );
  expect(batch).toMatchObject({
    templateVersionId: first.id,
    subject: first.subject,
    text: first.text,
  });
  await expect(
    service.create(
      admin.raw,
      {
        ...input(),
        subject: first.subject,
        text: "Tampered materialized content",
        templateVersionId: first.id,
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
async function visibleTo(userId: string, notificationId: string) {
  return withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [userId]);
    return (
      await db.query(
        "SELECT id FROM confsys.user_notification_feed WHERE id=$1",
        [notificationId],
      )
    ).rowCount;
  });
}
it("keeps scheduled content hidden until due and preserves provider identifiers without claiming delivery", async () => {
  const scheduledAt = new Date(Date.now() + 10 * 86400000).toISOString();
  const data = { ...input(), scheduledAt };
  const batch = await service.create(admin.raw, data, rid());
  const notificationId = await mailId(batch.id);
  expect(batch.scheduledAt).toBe(scheduledAt);
  expect(await visibleTo(recipient.id, notificationId)).toBe(0);
  let attempted = false;
  await processNotification(
    f.worker,
    f.workerConfig,
    notificationId,
    async () => {
      attempted = true;
      throw new Error("Future notification must not reach transport");
    },
  );
  expect(attempted).toBe(false);
  const stored = (
    await f.admin.query(
      "SELECT available_at,expires_at,next_attempt_at FROM confsys.notifications WHERE id=$1",
      [notificationId],
    )
  ).rows[0];
  expect(stored.available_at.toISOString()).toBe(scheduledAt);
  expect(stored.expires_at.getTime() - stored.available_at.getTime()).toBe(
    7 * 86400000,
  );
  for (const scheduledAt of [
    new Date(Date.now() - 1000).toISOString(),
    new Date(Date.now() + 31 * 86400000).toISOString(),
  ])
    await expect(
      service.create(admin.raw, { ...input(), scheduledAt }, rid()),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  // Operator-only clock fixture advances initial availability and due work together.
  await f.admin.query(
    "UPDATE confsys.notifications SET available_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=$1",
    [notificationId],
  );
  await f.admin.query(
    "UPDATE confsys.notification_batches SET scheduled_at=now()-interval '1 second' WHERE id=$1",
    [batch.id],
  );
  expect(await visibleTo(recipient.id, notificationId)).toBe(0);
  await send(batch.id);
  expect(await visibleTo(recipient.id, notificationId)).toBe(1);
  const detail = await service.deliveries(admin.raw, { id: batch.id });
  expect(detail.items[0]).toMatchObject({
    status: "accepted",
    resultCode: "SMTP_ACCEPTED",
    email: recipient.email,
  });
  expect(detail.items[0]?.providerId).toBeTruthy();
  expect(detail.items[0]?.nextAttemptAt).not.toBe(detail.items[0]?.availableAt);
  await expect(
    service.deliveries(recipient.raw, { id: batch.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await f.app.query("SELECT * FROM confsys.notification_batch_deliveries"))
      .rows,
  ).toHaveLength(0);
  await expect(
    f.worker.query(
      "UPDATE confsys.notifications SET available_at=now() WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(JSON.stringify(detail)).not.toMatch(
    /secret|ciphertext|token_hash|delivered/,
  );
});
it("cancellation before scheduled availability permanently suppresses recipient content and scheduled retry windows start at due time", async () => {
  const batch = await service.create(
    admin.raw,
    { ...input(), scheduledAt: new Date(Date.now() + 3600000).toISOString() },
    rid(),
  );
  const id = await mailId(batch.id);
  await service.cancel(admin.raw, { id: batch.id }, rid());
  await f.admin.query(
    "UPDATE confsys.notification_batches SET cancelled_at=now()-interval '2 seconds' WHERE id=$1",
    [batch.id],
  );
  await f.admin.query(
    "UPDATE confsys.notifications SET available_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  expect(await visibleTo(recipient.id, id)).toBe(0);
  await send(batch.id);
  expect(
    (await service.deliveries(admin.raw, { id: batch.id })).items[0]?.status,
  ).toBe("cancelled");
  const retryable = await service.create(
    admin.raw,
    { ...input(), scheduledAt: new Date(Date.now() + 3600000).toISOString() },
    rid(),
  );
  await f.admin.query(
    "UPDATE confsys.notification_batches SET created_at=now()-interval '8 days',scheduled_at=now()-interval '1 day' WHERE id=$1",
    [retryable.id],
  );
  await f.admin.query(
    "UPDATE confsys.notifications SET available_at=now()-interval '1 day' WHERE batch_id=$1",
    [retryable.id],
  );
  await connectionFailure(retryable.id);
  const child = await service.retry(
    admin.raw,
    {
      id: retryable.id,
      idempotencyKey: rid(),
      reason: "Known connection failure within scheduled window",
    },
    rid(),
  );
  expect(child.retryOf).toBe(retryable.id);
});
it("audience and template HTTP endpoints enforce session, CSRF and no-store administrative projections", async () => {
  const { buildApp } = await import("../../apps/api/src/app.js");
  const { registerAuthRoutes } =
    await import("../../apps/api/src/auth/routes.js");
  const { registerNotificationBatchRoutes } =
    await import("../../apps/api/src/notification-batches/routes.js");
  const { createRateLimiter } =
    await import("../../apps/api/src/auth/rate-limit.js");
  const { Redis } = await import("ioredis");
  const redis = new Redis(f.config.REDIS_URL),
    up = async () => {},
    server = buildApp({ postgres: up, redis: up, worker: up });
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(
      redis,
      f.config.CSRF_SIGNING_KEY,
      `notification-management-${rid()}`,
    ),
  });
  registerNotificationBatchRoutes(server, f.config, service);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    expect(
      (
        await server.inject({
          url: "/api/notifications/templates",
          headers: { host },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/notifications/audience-preview",
          headers: {
            host,
            cookie: `dev-session=${admin.raw}`,
            origin: f.config.PUBLIC_APP_ORIGIN,
          },
          payload: audienceFilters,
        })
      ).statusCode,
    ).toBe(403);
    const csrf = await server.inject({
      url: "/api/auth/csrf",
      headers: { host },
    });
    const cookies = csrf.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const response = await server.inject({
      method: "POST",
      url: "/api/notifications/audience-preview",
      headers: {
        host,
        cookie: `dev-session=${admin.raw}; ${cookies}`,
        origin: f.config.PUBLIC_APP_ORIGIN,
        "x-csrf-token": csrf.json().csrfToken,
      },
      payload: audienceFilters,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    for (const item of response.json().items)
      expect(Object.keys(item).sort()).toEqual(["email", "id"]);
  } finally {
    await server.close();
    await redis.quit();
  }
});

it("releases scheduled inbox content only after current issuer authority passes worker preflight", async () => {
  const issuer = await active(true);
  const batch = await service.create(
    issuer.raw,
    {
      ...input(),
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
    rid(),
  );
  const id = await mailId(batch.id);
  await f.admin.query(
    "UPDATE confsys.notifications SET available_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  expect(await visibleTo(recipient.id, id)).toBe(0);
  await f.admin.query("DELETE FROM confsys.user_roles WHERE user_id=$1", [
    issuer.id,
  ]);
  await send(batch.id);
  expect(await visibleTo(recipient.id, id)).toBe(0);
  expect(
    (
      await f.admin.query(
        "SELECT status,released_at FROM confsys.notifications WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ status: "cancelled", released_at: null });
  await expect(
    f.app.query(
      "UPDATE confsys.notifications SET released_at=now() WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });

  const authorized = await service.create(
    admin.raw,
    {
      ...input(),
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
    rid(),
  );
  const authorizedId = await mailId(authorized.id);
  await f.admin.query(
    "UPDATE confsys.notifications SET available_at=now()-interval '1 second' WHERE id=$1",
    [authorizedId],
  );
  await connectionFailure(authorized.id);
  expect(await visibleTo(recipient.id, authorizedId)).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT released_at FROM confsys.notifications WHERE id=$1",
        [authorizedId],
      )
    ).rows[0].released_at,
  ).toBeInstanceOf(Date);
});
