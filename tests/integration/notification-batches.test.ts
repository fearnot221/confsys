import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createNotificationBatchService } from "../../apps/api/src/notification-batches/service.js";
import {
  createMailSender,
  processNotification,
} from "../../packages/notifications/src/worker.js";
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
