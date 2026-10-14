import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import nodemailer from "nodemailer";
import type { Pool, PoolClient } from "pg";
import { diagnostic, redisOptions, type WorkerConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { unseal } from "./secrets.js";
import { permissionsFor } from "@confsys/policy";
const queueName = "identity-notifications-v1";
type Notification = {
  id: string;
  batch_id: string | null;
  user_id: string;
  request_id: string;
  kind: string;
  attempts: number;
  claim_id: string;
  conference_name: string | null;
  message_subject: string | null;
  message_text: string | null;
};
type Mail = { to: string; subject: string; text: string; messageId: string };
export type SendMail = (mail: Mail) => Promise<{ messageId: string }>;
async function audit(db: PoolClient, row: Notification, event: string) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,user_id,request_id,event_id) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), event, row.user_id, row.request_id, row.id],
  );
}
async function finish(
  pool: Pool,
  row: Notification,
  status: string,
  code: string,
  providerId: string | null = null,
) {
  await withIdentityTransaction(pool, async (db) => {
    const changed = await db.query(
      `UPDATE confsys.notifications SET status=$3,result_code=$4,provider_id=$5,stage=NULL,lease_until=NULL,updated_at=now(),next_attempt_at=now()+interval '30 seconds'
      WHERE id=$1 AND claim_id=$2 AND status='processing' RETURNING id`,
      [row.id, row.claim_id, status, code, providerId],
    );
    if (!changed.rowCount) return;
    if (status !== "pending")
      await db.query(
        "DELETE FROM confsys.notification_secrets WHERE notification_id=$1",
        [row.id],
      );
    await audit(db, row, `mail_${status}`);
  });
  diagnostic("mail-worker", `mail_${status}`, {
    eventId: row.id,
    requestId: row.request_id,
    attempt: row.attempts,
  });
}
export async function recoverNotifications(pool: Pool) {
  await withIdentityTransaction(pool, async (db) => {
    // A lease lost after SMTP starts is uncertain. Never automatically resend it.
    const rows = await db.query<
      Notification & { status: string }
    >(`UPDATE confsys.notifications SET
      status=CASE WHEN stage='sending' THEN 'unknown' ELSE 'pending' END,
      result_code='LEASE_EXPIRED',stage=NULL,lease_until=NULL,updated_at=now()
      WHERE status='processing' AND lease_until<now() RETURNING *`);
    for (const row of rows.rows) await audit(db, row, `mail_${row.status}`);
    const expired =
      await db.query<Notification>(`UPDATE confsys.notifications n SET status='cancelled',result_code='INELIGIBLE',updated_at=now()
      FROM confsys.notification_eligibility e WHERE n.id=e.id AND n.status='pending' AND NOT e.eligible RETURNING n.*`);
    for (const row of expired.rows) await audit(db, row, "mail_cancelled");
    await db.query(`DELETE FROM confsys.notification_secrets s USING confsys.notifications n
      WHERE s.notification_id=n.id AND (s.expires_at<now() OR n.status IN ('accepted','failed','unknown','cancelled'))`);
  });
}
// Batches retain their issuing authority. Pending sends fail closed if the
// issuer is disabled, credentials change, permission is removed, or cancelled.
async function batchEligible(pool: Pool, row: Notification) {
  if (!row.batch_id) return true;
  const result = await pool.query<{ active: boolean; roles: string[] }>(
    "SELECT active,roles FROM confsys.notification_batch_authority WHERE id=$1",
    [row.id],
  );
  const authority = result.rows[0];
  return (
    !!authority?.active &&
    permissionsFor(authority.roles).includes("notifications.manage")
  );
}
export async function processNotification(
  pool: Pool,
  config: Pick<
    WorkerConfig,
    "MAIL_ENCRYPTION_KEY" | "MAIL_KEY_VERSION" | "CONFERENCE_NAME"
  >,
  id: string,
  send: SendMail,
) {
  const claimed = await pool.query<Notification>(
    `UPDATE confsys.notifications SET status='processing',stage='claimed',claim_id=$2,
    lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now()
    WHERE id=$1 AND status='pending' AND next_attempt_at<=now() RETURNING *`,
    [id, randomUUID()],
  );
  const row = claimed.rows[0];
  if (!row) return;
  const data = await pool.query<{
    email: string;
    eligible: boolean;
    ciphertext: string | null;
    key_version: string | null;
  }>(
    `SELECT e.email,e.eligible,s.ciphertext,s.key_version
    FROM confsys.notification_eligibility e LEFT JOIN confsys.notification_secrets s ON s.notification_id=e.id WHERE e.id=$1`,
    [id],
  );
  const entry = data.rows[0];
  if (!entry?.eligible || !(await batchEligible(pool, row))) {
    await finish(pool, row, "cancelled", "INELIGIBLE");
    return;
  }
  let link = "";
  try {
    if (row.kind === "business") {
      if (!row.message_subject || !row.message_text)
        throw new Error("Message unavailable");
    } else {
      if (!entry.ciphertext || entry.key_version !== config.MAIL_KEY_VERSION)
        throw new Error("Key unavailable");
      link = unseal(
        entry.ciphertext,
        id,
        config.MAIL_ENCRYPTION_KEY,
        config.MAIL_KEY_VERSION,
      );
    }
  } catch {
    await finish(pool, row, "failed", "SECRET_UNAVAILABLE");
    return;
  }
  if (!(await batchEligible(pool, row))) {
    await finish(pool, row, "cancelled", "BATCH_AUTHORITY_REVOKED");
    return;
  }
  const sending = await pool.query(
    `UPDATE confsys.notifications n SET stage='sending' FROM confsys.notification_eligibility e
    WHERE n.id=$1 AND n.claim_id=$2 AND n.status='processing' AND n.lease_until>now() AND n.id=e.id AND e.eligible RETURNING n.id`,
    [id, row.claim_id],
  );
  if (!sending.rowCount) {
    await finish(pool, row, "cancelled", "INELIGIBLE");
    return;
  }
  let receipt: { messageId: string };
  try {
    receipt = await send({
      to: entry.email,
      subject:
        row.kind === "business"
          ? `[${row.conference_name ?? config.CONFERENCE_NAME}] ${row.message_subject}`
          : `[${row.conference_name ?? config.CONFERENCE_NAME}] ` +
            (row.kind === "verify"
              ? "確認信箱 / Verify email"
              : row.kind === "reset"
                ? "重設密碼 / Reset password"
                : row.kind === "role_invitation"
                  ? "本研討會角色邀請 / Conference role invitation"
                  : "密碼已變更 / Password changed"),
      text:
        row.kind === "business"
          ? `${row.conference_name ?? config.CONFERENCE_NAME}\n\n${row.message_text}\n\nRequest: ${row.request_id}`
          : `${row.conference_name ?? config.CONFERENCE_NAME} — 本研討會帳號 / Conference account\n\n${row.kind === "password_changed" ? "Your password changed. Existing sessions were revoked." : "Open the link and explicitly submit the form. Opening it does not change your account."}\n\n${link}\n\nRequest: ${row.request_id}`,
      messageId: `<${id}@confsys.invalid>`,
    });
  } catch (error) {
    // Only a connection failure before any SMTP exchange is safely retryable.
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    const command =
      error && typeof error === "object" && "command" in error
        ? error.command
        : undefined;
    const safeRetry =
      (code === "ECONNECTION" || code === "EDNS") && command === "CONN";
    await finish(
      pool,
      row,
      safeRetry ? (row.attempts < 3 ? "pending" : "failed") : "unknown",
      safeRetry ? "CONNECT_FAILED" : "SMTP_UNCERTAIN",
    );
    return;
  }
  // Do not catch a DB failure here as SMTP failure: lease recovery records unknown.
  await finish(pool, row, "accepted", "SMTP_ACCEPTED", receipt.messageId);
}
export async function dispatchNotifications(pool: Pool, queue: Queue) {
  await recoverNotifications(pool);
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM confsys.notifications WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at LIMIT 100",
  );
  for (const { id } of result.rows)
    await queue.add(
      "mail",
      { eventId: id },
      { jobId: id, removeOnComplete: true, removeOnFail: true, attempts: 1 },
    );
}
export function createMailSender(
  config: Pick<WorkerConfig, "SMTP_HOST" | "SMTP_PORT">,
) {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const send: SendMail = async (mail) => {
    const result = await transport.sendMail({
      ...mail,
      from: "Conference <noreply@confsys.invalid>",
    });
    return { messageId: result.messageId };
  };
  return { send, close: () => transport.close() };
}
export function startMailWorker(
  pool: Pool,
  config: WorkerConfig,
  name = queueName,
) {
  const transport = createMailSender(config);
  const send = transport.send;
  const queue = new Queue(name, { connection: redisOptions(config.REDIS_URL) });
  const worker = new Worker(
    name,
    async (job) => {
      const data: unknown = job.data;
      if (
        job.name !== "mail" ||
        !data ||
        typeof data !== "object" ||
        !("eventId" in data) ||
        typeof data.eventId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(data.eventId) ||
        Object.keys(data).length !== 1
      )
        throw new Error("Invalid notification reference");
      await processNotification(pool, config, data.eventId, send);
    },
    { connection: redisOptions(config.REDIS_URL), concurrency: 2 },
  );
  queue.on("error", () => diagnostic("mail-dispatcher", "queue_unavailable"));
  worker.on("error", () => diagnostic("mail-worker", "queue_unavailable"));
  worker.on("failed", (job) =>
    diagnostic(
      "mail-worker",
      "job_failed",
      job?.id ? { eventId: job.id, attempt: job.attemptsMade } : {},
    ),
  );
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let inFlight: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      await dispatchNotifications(pool, queue);
    } catch {
      diagnostic("mail-dispatcher", "dispatch_unavailable");
    }
    if (!stopped)
      timer = setTimeout(() => {
        inFlight = tick();
      }, 1000);
  };
  inFlight = tick();
  return {
    worker,
    async close() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
      await worker.close();
      await queue.close();
      transport.close();
    },
  };
}
