import type { PoolClient } from "pg";
import { exportJobSchema, exportJobsPage } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
type Row = {
  id: string;
  kind: string;
  purpose: string;
  status: string;
  result_code: string | null;
  row_count: string | null;
  snapshot_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  expired: boolean;
};
const fields =
  "id,kind,purpose,CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status,result_code,row_count::text,snapshot_at,created_at,completed_at,expires_at,expires_at<=clock_timestamp() AS expired";
const dto = (r: Row) =>
  exportJobSchema.parse({
    id: r.id,
    kind: r.kind,
    purpose: r.purpose,
    status: r.status,
    resultCode: r.expired ? "EXPIRED" : r.result_code,
    rows: r.row_count,
    snapshotAt: r.snapshot_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    expiresAt: r.expires_at.toISOString(),
  });
export async function context(db: PoolClient, actor: string) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.reporting_admin','true',true)",
    [actor],
  );
}
export async function detail(db: PoolClient, id: string) {
  const row = (
    await db.query<Row>(
      `SELECT ${fields} FROM confsys.export_jobs WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return dto(row);
}
export async function prior(db: PoolClient, actor: string, key: string) {
  return (
    await db.query<{ id: string; request_hash: string }>(
      "SELECT id,request_hash FROM confsys.export_jobs WHERE requester_id=$1 AND idempotency_key=$2",
      [actor, key],
    )
  ).rows[0];
}
export async function list(db: PoolClient, offset: number) {
  const rows = (
    await db.query<Row>(
      `SELECT ${fields} FROM confsys.export_jobs ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
  return exportJobsPage.parse({
    items: rows.slice(0, 20).map(dto),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  });
}
export async function pending(db: PoolClient) {
  return Number(
    (
      await db.query<{ count: string }>(
        "SELECT count(*) FROM confsys.export_jobs WHERE status IN('pending','processing') AND expires_at>clock_timestamp()",
      )
    ).rows[0]!.count,
  );
}
export async function insert(
  db: PoolClient,
  id: string,
  actor: string,
  kind: string,
  key: string,
  hash: string,
  purpose: string,
) {
  await db.query(
    "INSERT INTO confsys.export_jobs(id,kind,requester_id,requester_credential_version,idempotency_key,request_hash,purpose) SELECT $1,$2,id,credential_version,$4,$5,$6 FROM confsys.users WHERE id=$3",
    [id, kind, actor, key, hash, purpose],
  );
  return detail(db, id);
}
export async function content(db: PoolClient, id: string) {
  return (
    await db.query<{
      kind: string;
      purpose: string;
      csv: Buffer | null;
      sha256: string | null;
      valid: boolean;
    }>(
      "SELECT j.kind,j.purpose,j.csv,j.sha256,(j.status='ready' AND j.expires_at>clock_timestamp() AND e.requester_active) AS valid FROM confsys.export_jobs j JOIN confsys.export_job_eligibility e ON e.id=j.id WHERE j.id=$1",
      [id],
    )
  ).rows[0];
}
