import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  notificationBatch,
  notificationBatchPage,
  notificationTemplate,
  notificationDelivery,
  type NotificationAudience,
} from "@confsys/contracts";
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
    audience: row.audience ?? null,
    templateVersionId: row.template_version_id ?? null,
    scheduledAt: (row.scheduled_at as Date | null)?.toISOString() ?? null,
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
const batchProjection = `SELECT b.id,b.subject,b.message_text,b.recipient_ids,b.created_at,b.cancelled_at,b.retry_of,b.audience,b.template_version_id,b.scheduled_at,
      (SELECT c.id FROM confsys.notification_batches c WHERE c.retry_of=b.id) AS retried_as,
      CASE WHEN b.cancelled_at IS NULL AND coalesce(b.scheduled_at,b.created_at)>clock_timestamp()-interval '7 days'
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
    audience?: NotificationAudience | null;
    templateVersionId?: string | null;
    scheduledAt?: string | null;
  },
  hash: string,
  retryOf: string | null = null,
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.notification_batches(id,created_by,issuer_credential_version,idempotency_key,request_hash,subject,message_text,recipient_ids,retry_of,audience,template_version_id,scheduled_at) SELECT $1,id,credential_version,$3,$4,$5,$6,$7,$8,$9,$10,$11 FROM confsys.users WHERE id=$2",
    [
      id,
      actorId,
      input.idempotencyKey,
      hash,
      input.subject,
      input.text,
      input.recipientIds,
      retryOf,
      input.audience ?? null,
      input.templateVersionId ?? null,
      input.scheduledAt ?? null,
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
      audience: NotificationAudience | null;
      template_version_id: string | null;
    }>(
      "SELECT b.id,b.created_by,b.issuer_credential_version,b.subject,b.message_text,b.cancelled_at,b.audience,b.template_version_id,coalesce(b.scheduled_at,b.created_at)>clock_timestamp()-interval '7 days' AS in_window,u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=b.issuer_credential_version AS issuer_active FROM confsys.notification_batches b JOIN confsys.users u ON u.id=b.created_by WHERE b.id=$1 FOR UPDATE OF b",
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

const audienceWhere = `($1::text IS NULL OR $1=ANY(roles))
 AND ($2='any' OR ($2='none' AND registration_state IS NULL) OR registration_state=$2)
 AND ($3='any' OR ($3='none' AND cardinality(submission_states)=0) OR $3=ANY(submission_states))
 AND ($4='any' OR ($4='accepted' AND published_outcomes && ARRAY['accept_oral','accept_poster']::text[]) OR $4=ANY(published_outcomes))`;
const audienceValues = (filters: NotificationAudience) => [
  filters.role,
  filters.registration,
  filters.submission,
  filters.publishedOutcome,
];
export async function audience(db: PoolClient, filters: NotificationAudience) {
  const values = audienceValues(filters);
  const items = (
    await db.query<{ id: string; email: string }>(
      `SELECT id,email FROM confsys.notification_audience WHERE ${audienceWhere} ORDER BY email,id LIMIT 100`,
      values,
    )
  ).rows;
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM confsys.notification_audience WHERE ${audienceWhere}`,
        values,
      )
    ).rows[0]?.total ?? 0,
  );
  return { items, total, truncated: total > items.length };
}
export async function matchesAudience(
  db: PoolClient,
  filters: NotificationAudience,
  ids: string[],
) {
  return (
    (
      await db.query(
        `SELECT id FROM confsys.notification_audience WHERE ${audienceWhere} AND id=ANY($5::uuid[])`,
        [...audienceValues(filters), ids],
      )
    ).rowCount === ids.length
  );
}
export async function databaseTime(db: PoolClient) {
  return (await db.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
    .rows[0]!.now;
}
function templateDto(row: {
  id: string;
  template_key: string;
  version: number;
  name: string;
  subject: string;
  message_text: string;
  created_at: Date;
}) {
  return notificationTemplate.parse({
    id: row.id,
    key: row.template_key,
    version: row.version,
    name: row.name,
    subject: row.subject,
    text: row.message_text,
    createdAt: row.created_at.toISOString(),
  });
}
export async function templateById(db: PoolClient, id: string) {
  const row = (
    await db.query(
      "SELECT * FROM confsys.notification_template_versions WHERE id=$1",
      [id],
    )
  ).rows[0];
  return row ? templateDto(row) : null;
}
export async function latestTemplateVersion(db: PoolClient, key: string) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('notification-template:'||$1,0))",
    [key],
  );
  return Number(
    (
      await db.query(
        "SELECT coalesce(max(version),0) AS version FROM confsys.notification_template_versions WHERE template_key=$1",
        [key],
      )
    ).rows[0].version,
  );
}
export async function templates(db: PoolClient, offset: number) {
  const rows = (
    await db.query(
      "SELECT * FROM confsys.notification_template_versions ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $1",
      [offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map(templateDto),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function saveTemplate(
  db: PoolClient,
  actorId: string,
  data: {
    id: string;
    key: string;
    expectedVersion: number;
    name: string;
    subject: string;
    text: string;
  },
) {
  await db.query(
    "INSERT INTO confsys.notification_template_versions(id,template_key,version,name,subject,message_text,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      data.id,
      data.key,
      data.expectedVersion + 1,
      data.name,
      data.subject,
      data.text,
      actorId,
    ],
  );
  return templateById(db, data.id);
}
export async function deliveries(db: PoolClient, id: string, offset: number) {
  const rows = (
    await db.query(
      "SELECT * FROM confsys.notification_batch_deliveries WHERE batch_id=$1 ORDER BY created_at,id LIMIT 21 OFFSET $2",
      [id, offset],
    )
  ).rows;
  return {
    items: rows
      .slice(0, 20)
      .map((row) =>
        notificationDelivery.parse({
          id: row.id,
          userId: row.user_id,
          email: row.email,
          status: row.status,
          resultCode: row.result_code,
          providerId: row.provider_id,
          attempts: row.attempts,
          nextAttemptAt: row.next_attempt_at.toISOString(),
          availableAt: row.available_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        }),
      ),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
