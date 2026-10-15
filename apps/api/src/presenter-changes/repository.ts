import type { PoolClient } from "pg";
import {
  presenterChangeSchema,
  submissionDocumentSchema,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
const fields = `id,submission_id AS "submissionId",source_revision_id AS "sourceRevisionId",new_revision_id AS "newRevisionId",requester_id AS "requesterId",target_user_id AS "targetUserId",target_author_index AS "targetAuthorIndex",expected_submission_version AS "expectedSubmissionVersion",config_version AS "configVersion",projection,reason,state,version,response_reason AS "responseReason",decision_reason AS "decisionReason",created_at,expires_at,consented_at,decided_at`;
export function decode(row: Record<string, unknown>) {
  const { created_at, expires_at, consented_at, decided_at, ...rest } = row;
  const date = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  return presenterChangeSchema.parse({
    ...rest,
    createdAt: date(created_at),
    expiresAt: date(expires_at),
    consentedAt: date(consented_at),
    decidedAt: date(decided_at),
  });
}
export async function one(db: PoolClient, id: string, lock = false) {
  const row = (
    await db.query(
      `SELECT ${fields} FROM confsys.presenter_change_requests WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return decode(row);
}
export async function list(
  db: PoolClient,
  actor: string,
  scope: "own" | "incoming" | "admin",
  offset: number,
) {
  const rows = (
    await db.query(
      `SELECT ${fields} FROM confsys.presenter_change_requests WHERE ($1='admin' OR ($1='own' AND requester_id=$2) OR ($1='incoming' AND target_user_id=$2)) ORDER BY created_at DESC,id LIMIT 21 OFFSET $3`,
      [scope, actor, offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map(decode),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function source(db: PoolClient, id: string) {
  const row = (
    await db.query<{ document: unknown }>(
      "SELECT document FROM confsys.submission_revisions WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("CONFLICT");
  return submissionDocumentSchema.parse(row.document);
}
export async function target(db: PoolClient, email: string) {
  const row = (
    await db.query<{ id: string; credential_version: number }>(
      "SELECT id,credential_version FROM confsys.users WHERE email=$1 AND state='active' AND verified_at IS NOT NULL",
      [email],
    )
  ).rows[0];
  if (!row) throw new AuthError("INVALID_REQUEST");
  return row;
}
export async function consentVersion(db: PoolClient, id: string) {
  return (
    await db.query<{ consent_credential_version: number }>(
      "SELECT consent_credential_version FROM confsys.presenter_change_requests WHERE id=$1",
      [id],
    )
  ).rows[0]?.consent_credential_version;
}
