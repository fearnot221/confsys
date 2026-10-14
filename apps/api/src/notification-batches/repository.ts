import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { notificationBatch, notificationBatchPage } from "@confsys/contracts";
export async function context(db: PoolClient, actorId: string) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.notifications_manage','true',true)",
    [actorId],
  );
}
export async function lockKey(db: PoolClient, key: string) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('notification-batch:'||$1,0))",
    [key],
  );
}
export async function prior(db: PoolClient, key: string) {
  return (
    await db.query<{ id: string; request_hash: string }>(
      "SELECT id,request_hash FROM confsys.notification_batches WHERE idempotency_key=$1",
      [key],
    )
  ).rows[0];
}
async function dto(db: PoolClient, row: Record<string, unknown>) {
  const statuses = (
    await db.query(
      "SELECT status,count FROM confsys.notification_batch_status WHERE batch_id=$1 ORDER BY status",
      [row.id],
    )
  ).rows;
  return notificationBatch.parse({
    id: row.id,
    subject: row.subject,
    text: row.message_text,
    recipientCount: (row.recipient_ids as string[]).length,
    createdAt: (row.created_at as Date).toISOString(),
    cancelledAt: (row.cancelled_at as Date | null)?.toISOString() ?? null,
    statuses,
    retryOf: row.retry_of ?? null,
    retriedAs: row.retried_as ?? null,
    retryableCount: Number(row.retryable_count ?? 0),
  });
}
const batchProjection = `SELECT b.id,b.subject,b.message_text,b.recipient_ids,b.created_at,b.cancelled_at,b.retry_of,
      (SELECT c.id FROM confsys.notification_batches c WHERE c.retry_of=b.id) AS retried_as,
      CASE WHEN b.cancelled_at IS NULL AND b.created_at>clock_timestamp()-interval '7 days'
        AND NOT EXISTS(SELECT 1 FROM confsys.notification_batches c WHERE c.retry_of=b.id)
        AND NOT EXISTS(SELECT 1 FROM confsys.notification_batch_retry_source n WHERE n.batch_id=b.id AND n.status IN('pending','processing'))
      THEN (SELECT count(*) FROM confsys.notification_batch_retry_source n WHERE n.batch_id=b.id AND n.status='failed' AND n.result_code='CONNECT_FAILED' AND n.recipient_eligible) ELSE 0 END AS retryable_count
      FROM confsys.notification_batches b`;
export async function detail(db: PoolClient, id: string) {
  const row = (await db.query(`${batchProjection} WHERE b.id=$1`, [id]))
    .rows[0];
  return row ? dto(db, row) : null;
}
export async function list(db: PoolClient, offset: number) {
  const rows = (
    await db.query(
      `${batchProjection} ORDER BY b.created_at DESC,b.id DESC LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
  const items = [];
  for (const row of rows.slice(0, 20)) items.push(await dto(db, row));
  return notificationBatchPage.parse({
    items,
    nextOffset: rows.length > 20 ? offset + 20 : null,
  });
}
export async function eligibleRecipients(db: PoolClient, ids: string[]) {
  return (
    (
      await db.query(
        "SELECT id FROM confsys.users WHERE id=ANY($1::uuid[]) AND state='active' AND verified_at IS NOT NULL",
        [ids],
      )
    ).rowCount === ids.length
  );
}
export async function create(
  db: PoolClient,
  actorId: string,
  input: {
    idempotencyKey: string;
    recipientIds: string[];
    subject: string;
    text: string;
  },
  hash: string,
  retryOf: string | null = null,
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.notification_batches(id,created_by,issuer_credential_version,idempotency_key,request_hash,subject,message_text,recipient_ids,retry_of) SELECT $1,id,credential_version,$3,$4,$5,$6,$7,$8 FROM confsys.users WHERE id=$2",
    [
      id,
      actorId,
      input.idempotencyKey,
      hash,
      input.subject,
      input.text,
      input.recipientIds,
      retryOf,
    ],
  );
  return id;
}
export async function cancel(db: PoolClient, id: string) {
  await db.query(
    "UPDATE confsys.notification_batches SET cancelled_at=coalesce(cancelled_at,now()) WHERE id=$1",
    [id],
  );
  return detail(db, id);
}

export async function retrySource(db: PoolClient, id: string) {
  const row = (
    await db.query<{
      id: string;
      created_by: string;
      issuer_credential_version: number;
      subject: string;
      message_text: string;
      cancelled_at: Date | null;
      in_window: boolean;
      issuer_active: boolean;
    }>(
      "SELECT b.id,b.created_by,b.issuer_credential_version,b.subject,b.message_text,b.cancelled_at,b.created_at>clock_timestamp()-interval '7 days' AS in_window,u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=b.issuer_credential_version AS issuer_active FROM confsys.notification_batches b JOIN confsys.users u ON u.id=b.created_by WHERE b.id=$1 FOR UPDATE OF b",
      [id],
    )
  ).rows[0];
  if (!row) return null;
  const deliveries = (
    await db.query<{
      user_id: string;
      status: string;
      result_code: string | null;
      recipient_eligible: boolean;
    }>(
      "SELECT user_id,status,result_code,recipient_eligible FROM confsys.notification_batch_retry_source WHERE batch_id=$1 ORDER BY user_id",
      [id],
    )
  ).rows;
  const child = (
    await db.query<{
      id: string;
      idempotency_key: string;
      request_hash: string;
    }>(
      "SELECT id,idempotency_key,request_hash FROM confsys.notification_batches WHERE retry_of=$1",
      [id],
    )
  ).rows[0];
  return { row, deliveries, child };
}
