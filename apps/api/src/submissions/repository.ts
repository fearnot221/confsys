import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  submissionSchema,
  submissionDocumentSchema,
  submissionRevisionSchema,
  submissionConfigSchema,
  type SubmissionDocument,
  type SubmissionConfig,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export async function context(db: PoolClient, actorId: string, admin: boolean) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.submissions_admin',$2,true)",
    [actorId, String(admin)],
  );
}
export async function configuration(
  db: PoolClient,
  lock: boolean | "share" = false,
) {
  const row = (
    await db.query<{ version: number; document: object }>(
      `SELECT version,document FROM confsys.submission_config WHERE singleton=true${lock === "share" ? " FOR SHARE" : lock ? " FOR UPDATE" : ""}`,
    )
  ).rows[0];
  if (!row) throw new Error("Submission migration required");
  return submissionConfigSchema.parse({
    ...row.document,
    version: row.version,
  });
}
export async function configure(db: PoolClient, config: SubmissionConfig) {
  const { version, ...document } = config;
  const r = await db.query(
    "UPDATE confsys.submission_config SET version=version+1,document=$1 WHERE singleton=true AND version=$2",
    [document, version],
  );
  if (!r.rowCount) throw new AuthError("CONFLICT");
  return configuration(db);
}
const fields = `id,number::text AS number,owner_id AS "ownerId",state,version,submitted_version AS "submittedVersion",current_revision_id AS "currentRevisionId",document,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
export async function one(db: PoolClient, id: string, lock = false) {
  const row = (
    await db.query(
      `SELECT ${fields} FROM confsys.submissions WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  return row ? submissionSchema.parse(row) : null;
}
export async function list(
  db: PoolClient,
  actorId: string,
  admin: boolean,
  offset: number,
) {
  const rows = (
    await db.query(
      `SELECT ${fields} FROM confsys.submissions WHERE ($1::boolean OR owner_id=$2) ORDER BY updated_at DESC,id LIMIT 21 OFFSET $3`,
      [admin, actorId, offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map((r) => submissionSchema.parse(r)),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function revisions(db: PoolClient, id: string, offset: number) {
  const rows = (
    await db.query(
      `SELECT id,submission_id AS "submissionId",version,document,to_char(submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt" FROM confsys.submission_revisions WHERE submission_id=$1 ORDER BY version DESC LIMIT 21 OFFSET $2`,
      [id, offset],
    )
  ).rows;
  return {
    revisions: rows.slice(0, 20).map((r) => submissionRevisionSchema.parse(r)),
    nextRevisionOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function create(
  db: PoolClient,
  id: string,
  ownerId: string,
  document: SubmissionDocument,
) {
  const r = await db.query(
    "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,$3) ON CONFLICT(id) DO NOTHING",
    [id, ownerId, document],
  );
  if (!r.rowCount) throw new AuthError("CONFLICT");
}
export async function save(
  db: PoolClient,
  id: string,
  document: SubmissionDocument,
) {
  await db.query(
    "UPDATE confsys.submissions SET document=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
    [id, document],
  );
}
export async function submit(
  db: PoolClient,
  id: string,
  actorId: string,
  version: number,
  document: SubmissionDocument,
  config: SubmissionConfig,
) {
  const revisionId = randomUUID();
  await db.query(
    "INSERT INTO confsys.submission_revisions(id,submission_id,owner_id,version,document,config_snapshot) VALUES($1,$2,$3,$4,$5,$6)",
    [revisionId, id, actorId, version, document, config],
  );
  await db.query(
    "UPDATE confsys.submissions SET state='submitted',submitted_version=version,current_revision_id=$2,updated_at=clock_timestamp() WHERE id=$1",
    [id, revisionId],
  );
  return revisionId;
}
export async function withdraw(db: PoolClient, id: string) {
  await db.query(
    "UPDATE confsys.submissions SET state='withdrawn',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
    [id],
  );
}
export async function audit(
  db: PoolClient,
  actorId: string,
  event: string,
  requestId: string,
  resourceId: string,
  version: number,
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session','Submission lifecycle',$4,$5)",
    [
      randomUUID(),
      event,
      actorId,
      JSON.stringify({ resourceId, version }),
      requestId,
    ],
  );
}

// Caller holds the shared/exclusive access fence and establishes trusted resource context.
// Both agenda and competition use this projection; draft decisions never qualify.
export async function publishedAcceptedRevision(db: PoolClient, id: string) {
  const row = (
    await db.query<{
      submission_id: string;
      owner_id: string;
      document: unknown;
      outcome: string;
    }>(
      "SELECT r.submission_id,r.owner_id,r.document,a.outcome FROM confsys.submission_revisions r JOIN confsys.published_acceptances a ON a.revision_id=r.id JOIN confsys.submissions s ON s.id=r.submission_id WHERE r.id=$1 AND s.state<>'withdrawn'",
      [id],
    )
  ).rows[0];
  if (!row || !["accept_oral", "accept_poster"].includes(row.outcome))
    throw new AuthError("CONFLICT");
  return {
    id,
    submissionId: row.submission_id,
    ownerId: row.owner_id,
    document: submissionDocumentSchema.parse(row.document),
    presentation:
      row.outcome === "accept_oral" ? ("oral" as const) : ("poster" as const),
  };
}
