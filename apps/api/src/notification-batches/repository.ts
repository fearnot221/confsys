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
  });
}
export async function detail(db: PoolClient, id: string) {
  const row = (
    await db.query(
      "SELECT id,subject,message_text,recipient_ids,created_at,cancelled_at FROM confsys.notification_batches WHERE id=$1",
      [id],
    )
  ).rows[0];
  return row ? dto(db, row) : null;
}
export async function list(db: PoolClient, offset: number) {
  const rows = (
    await db.query(
      "SELECT id,subject,message_text,recipient_ids,created_at,cancelled_at FROM confsys.notification_batches ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $1",
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
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.notification_batches(id,created_by,issuer_credential_version,idempotency_key,request_hash,subject,message_text,recipient_ids) SELECT $1,id,credential_version,$3,$4,$5,$6,$7 FROM confsys.users WHERE id=$2",
    [
      id,
      actorId,
      input.idempotencyKey,
      hash,
      input.subject,
      input.text,
      input.recipientIds,
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
