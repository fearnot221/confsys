import type { PoolClient } from "pg";
import { documentJob, badgeJobSnapshot } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
type Row = {
  id: string;
  kind: string;
  status: string;
  snapshot: unknown;
  attempts: number;
  result_code: string | null;
  created_at: Date;
  completed_at: Date | null;
  request_hash: string;
  pdf: Buffer | null;
  sha256: string | null;
};
const projection = (r: Row) =>
  documentJob.parse({
    id: r.id,
    kind: r.kind,
    status: r.status,
    count: badgeJobSnapshot.parse(r.snapshot).badges.length,
    attempts: r.attempts,
    resultCode: r.result_code,
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
  });
export async function byId(db: PoolClient, id: string) {
  const r = (
    await db.query<Row>("SELECT * FROM confsys.document_jobs WHERE id=$1", [id])
  ).rows[0];
  if (!r) throw new AuthError("NOT_FOUND");
  return { row: r, document: projection(r) };
}
export async function byKey(db: PoolClient, actor: string, key: string) {
  const r = (
    await db.query<Row>(
      "SELECT * FROM confsys.document_jobs WHERE requester_id=$1 AND idempotency_key=$2",
      [actor, key],
    )
  ).rows[0];
  return r ? { row: r, document: projection(r) } : null;
}
export async function list(db: PoolClient, offset: number) {
  const rows = (
    await db.query<Row>(
      "SELECT id,kind,status,snapshot,attempts,result_code,created_at,completed_at FROM confsys.document_jobs ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $1",
      [offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map(projection),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function pending(db: PoolClient) {
  return Number(
    (
      await db.query<{ count: string }>(
        "SELECT count(*) FROM confsys.document_jobs WHERE status IN('pending','processing')",
      )
    ).rows[0]!.count,
  );
}
export async function insert(
  db: PoolClient,
  id: string,
  actor: string,
  key: string,
  hash: string,
  snapshot: unknown,
) {
  await db.query(
    "INSERT INTO confsys.document_jobs(id,kind,requester_id,idempotency_key,request_hash,snapshot,requester_credential_version) SELECT $1,'badges',$2,$3,$4,$5,credential_version FROM confsys.users WHERE id=$2",
    [id, actor, key, hash, snapshot],
  );
  return (await byId(db, id)).document;
}
