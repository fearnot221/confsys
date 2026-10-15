import { registrationRequirement } from "../submissions/repository.js";
import type { PoolClient } from "pg";
import {
  reviewFormSchema,
  reviewScreeningSchema,
  type ReviewScreening,
  reviewScoreDocumentSchema,
  submissionDocumentSchema,
  type ReviewFormDocument,
  type ReviewScoreDocument,
  type ReviewDecision,
} from "@confsys/contracts";
export type PaperRow = {
  id: string;
  submission_id: string;
  owner_id: string;
  document: unknown;
  state: string;
  current_revision_id: string | null;
};
export type AssignmentRow = {
  round: number;
  id: string;
  submission_id: string;
  revision_id: string;
  reviewer_id: string;
  form_id: string;
  state:
    | "invited"
    | "accepted"
    | "declined"
    | "conflicted"
    | "submitted"
    | "revoked";
  version: number;
  anonymous_confirmed: boolean;
  document: unknown;
};
export type DecisionRow = {
  round: number;
  id: string;
  submission_id: string;
  revision_id: string;
  version: number;
  outcome: ReviewDecision["outcome"];
  author_message: string;
  internal_reason: string;
  revision_deadline: Date | null;
  published: boolean;
};
export async function context(db: PoolClient, actorId: string, manage = false) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.submissions_admin',$2,true),set_config('app.reviews_manage',$2,true)",
    [actorId, manage ? "true" : "false"],
  );
}
export async function paper(db: PoolClient, revisionId: string) {
  return (
    await db.query<PaperRow>(
      `SELECT r.id,r.submission_id,r.owner_id,r.document,s.state,s.current_revision_id FROM confsys.submission_revisions r JOIN confsys.submissions s ON s.id=r.submission_id WHERE r.id=$1`,
      [revisionId],
    )
  ).rows[0];
}
// Caller holds the exclusive access-control lock; submission writers hold its shared lock.
// This read is fenced against submit/withdraw without widening the owner-only UPDATE RLS.
export async function submissionForReview(db: PoolClient, id: string) {
  return (
    await db.query<{
      id: string;
      owner_id: string;
      state: string;
      current_revision_id: string | null;
    }>(
      "SELECT id,owner_id,state,current_revision_id FROM confsys.submissions WHERE id=$1",
      [id],
    )
  ).rows[0];
}
export async function form(db: PoolClient, id: string) {
  const row = (
    await db.query(
      "SELECT id,version,document FROM confsys.review_forms WHERE id=$1",
      [id],
    )
  ).rows[0];
  return row ? reviewFormSchema.parse(row) : null;
}
export async function createForm(
  db: PoolClient,
  id: string,
  actorId: string,
  document: ReviewFormDocument,
) {
  const row = (
    await db.query(
      "INSERT INTO confsys.review_forms(id,version,document,created_by) SELECT $1,COALESCE(max(version),0)+1,$2,$3 FROM confsys.review_forms RETURNING id,version,document",
      [id, document, actorId],
    )
  ).rows[0];
  return reviewFormSchema.parse(row);
}
export async function forms(db: PoolClient, offset: number) {
  return (
    await db.query(
      "SELECT id,version,document FROM confsys.review_forms ORDER BY version DESC LIMIT 21 OFFSET $1",
      [offset],
    )
  ).rows.map((row) => reviewFormSchema.parse(row));
}
export async function hasScope(
  db: PoolClient,
  userId: string,
  trackId: string,
) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.review_chair_scopes WHERE user_id=$1 AND track_id=$2",
      [userId, trackId],
    )
  ).rowCount;
}
export async function scopes(
  db: PoolClient,
  offset: number,
  userId: string | null,
) {
  return (
    await db.query<{ userId: string; trackId: string }>(
      `SELECT user_id AS "userId",track_id AS "trackId" FROM confsys.review_chair_scopes WHERE ($2::uuid IS NULL OR user_id=$2) ORDER BY user_id,track_id LIMIT 21 OFFSET $1`,
      [offset, userId],
    )
  ).rows;
}
export async function setScope(
  db: PoolClient,
  userId: string,
  trackId: string,
  remove: boolean,
) {
  return !!(
    await db.query(
      remove
        ? "DELETE FROM confsys.review_chair_scopes WHERE user_id=$1 AND track_id=$2"
        : "INSERT INTO confsys.review_chair_scopes(user_id,track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [userId, trackId],
    )
  ).rowCount;
}
export async function hasConflict(
  db: PoolClient,
  submissionId: string,
  userId: string,
) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.review_conflicts WHERE submission_id=$1 AND user_id=$2",
      [submissionId, userId],
    )
  ).rowCount;
}
export async function declareConflict(
  db: PoolClient,
  submissionId: string,
  userId: string,
  reason: string,
) {
  await db.query(
    "INSERT INTO confsys.review_conflicts(submission_id,user_id,reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    [submissionId, userId, reason],
  );
  await db.query(
    "UPDATE confsys.review_assignments SET state='conflicted',version=version+1,updated_at=now() WHERE submission_id=$1 AND reviewer_id=$2 AND state<>'conflicted'",
    [submissionId, userId],
  );
}
export async function assignment(db: PoolClient, id: string, lock = false) {
  return (
    await db.query<AssignmentRow>(
      `SELECT * FROM confsys.review_assignments WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
}
export async function assignmentRows(
  db: PoolClient,
  offset: number,
  reviewerId: string | null,
  chairId: string | null,
) {
  return (
    await db.query<AssignmentRow>(
      `SELECT a.* FROM confsys.review_assignments a JOIN confsys.submission_revisions r ON r.id=a.revision_id WHERE ($2::uuid IS NULL OR a.reviewer_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM confsys.review_chair_scopes c WHERE c.user_id=$3 AND c.track_id=r.document->>'trackId')) ORDER BY a.created_at DESC,a.id DESC LIMIT 21 OFFSET $1`,
      [offset, reviewerId, chairId],
    )
  ).rows;
}
export async function createAssignment(
  db: PoolClient,
  input: {
    id: string;
    submissionId: string;
    revisionId: string;
    reviewerId: string;
    formId: string;
    anonymousConfirmed: boolean;
    round: number;
  },
  actorId: string,
) {
  await db.query(
    `INSERT INTO confsys.review_assignments(id,submission_id,revision_id,reviewer_id,form_id,state,anonymous_confirmed,created_by,round) VALUES ($1,$2,$3,$4,$5,'invited',$6,$7,$8)`,
    [
      input.id,
      input.submissionId,
      input.revisionId,
      input.reviewerId,
      input.formId,
      input.anonymousConfirmed,
      actorId,
      input.round,
    ],
  );
}
export async function updateAssignment(
  db: PoolClient,
  id: string,
  state: AssignmentRow["state"],
  document: ReviewScoreDocument,
) {
  await db.query(
    "UPDATE confsys.review_assignments SET state=$2,document=$3,version=version+1,updated_at=now() WHERE id=$1",
    [id, state, document],
  );
}
export function paperDocument(row: PaperRow) {
  return submissionDocumentSchema.parse(row.document);
}
export function scoreDocument(row: AssignmentRow) {
  return reviewScoreDocumentSchema.parse(row.document);
}
const decisionProjection = `d.*, EXISTS(SELECT 1 FROM confsys.review_publications p WHERE p.decision_id=d.id) AS published`;
export async function decision(db: PoolClient, id: string) {
  return (
    await db.query<DecisionRow>(
      `SELECT ${decisionProjection} FROM confsys.review_decisions d WHERE d.id=$1`,
      [id],
    )
  ).rows[0];
}
export function decisionDto(row: DecisionRow): ReviewDecision {
  return {
    id: row.id,
    round: row.round,
    submissionId: row.submission_id,
    revisionId: row.revision_id,
    version: row.version,
    outcome: row.outcome,
    authorMessage: row.author_message,
    internalReason: row.internal_reason,
    revisionDeadline: row.revision_deadline?.toISOString() ?? null,
    published: row.published,
  };
}
export async function decisions(
  db: PoolClient,
  offset: number,
  chairId: string | null,
) {
  return (
    await db.query<DecisionRow>(
      `SELECT ${decisionProjection} FROM confsys.review_decisions d JOIN confsys.submission_revisions r ON r.id=d.revision_id WHERE ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM confsys.review_chair_scopes c WHERE c.user_id=$2 AND c.track_id=r.document->>'trackId')) ORDER BY d.created_at DESC,d.id DESC LIMIT 21 OFFSET $1`,
      [offset, chairId],
    )
  ).rows;
}
export async function decisionVersion(db: PoolClient, submissionId: string) {
  return Number(
    (
      await db.query(
        "SELECT COALESCE(max(version),0) AS version FROM confsys.review_decisions WHERE submission_id=$1",
        [submissionId],
      )
    ).rows[0].version,
  );
}
export async function createDecision(
  db: PoolClient,
  input: {
    id: string;
    submissionId: string;
    revisionId: string;
    expectedVersion: number;
    outcome: ReviewDecision["outcome"];
    authorMessage: string;
    internalReason: string;
    revisionDeadline: string | null;
    round: number;
  },
  actorId: string,
) {
  await db.query(
    `INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,revision_deadline,decided_by,round) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.id,
      input.submissionId,
      input.revisionId,
      input.expectedVersion + 1,
      input.outcome,
      input.authorMessage,
      input.internalReason,
      input.revisionDeadline,
      actorId,
      input.round,
    ],
  );
}
export async function publishDecision(
  db: PoolClient,
  row: DecisionRow,
  actorId: string,
) {
  await db.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES ($1,$2,$3) ON CONFLICT(submission_id) DO UPDATE SET decision_id=EXCLUDED.decision_id,published_by=EXCLUDED.published_by,published_at=now()",
    [row.submission_id, row.id, actorId],
  );
}
export async function authorResults(
  db: PoolClient,
  _actorId: string,
  offset: number,
) {
  const rows = (
    await db.query<{
      submissionId: string;
      revisionId: string;
      round: number;
      outcome: ReviewDecision["outcome"];
      authorMessage: string;
      revisionDeadline: Date | null;
      publishedAt: Date;
      authorComments: string[];
    }>(
      `SELECT round,revision_id AS "revisionId",submission_id AS "submissionId",outcome,author_message AS "authorMessage",revision_deadline AS "revisionDeadline",published_at AS "publishedAt",author_comments AS "authorComments" FROM confsys.review_author_results ORDER BY published_at DESC,submission_id LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
  const items = [];
  for (const { revisionId, ...r } of rows.slice(0, 20))
    items.push({
      ...r,
      registrationRequirement: await registrationRequirement(db, revisionId),
      revisionDeadline: r.revisionDeadline?.toISOString() ?? null,
      publishedAt: r.publishedAt.toISOString(),
    });
  return { items, nextOffset: rows.length > 20 ? offset + 20 : null };
}

export async function candidates(
  db: PoolClient,
  offset: number,
  actor: { id: string; email: string },
  chairId: string | null,
) {
  return (
    await db.query<{
      submissionId: string;
      revisionId: string;
      title: string;
      trackId: string;
    }>(
      `SELECT s.id AS "submissionId",r.id AS "revisionId",r.document->>'title' AS title,r.document->>'trackId' AS "trackId" FROM confsys.submissions s JOIN confsys.submission_revisions r ON r.id=s.current_revision_id WHERE s.state='submitted' AND s.owner_id<>$2 AND NOT EXISTS(SELECT 1 FROM confsys.submission_author_conflicts conflict WHERE conflict.revision_id=r.id AND conflict.user_id=$2) AND NOT EXISTS(SELECT 1 FROM confsys.review_conflicts c WHERE c.submission_id=s.id AND c.user_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM confsys.review_chair_scopes c WHERE c.user_id=$3 AND c.track_id=r.document->>'trackId')) ORDER BY s.updated_at DESC,s.id LIMIT 21 OFFSET $1`,
      [offset, actor.id, chairId],
    )
  ).rows;
}
export async function reviewers(db: PoolClient, offset: number) {
  return (
    await db.query<{ id: string; email: string }>(
      `SELECT u.id,u.email FROM confsys.users u JOIN confsys.user_roles r ON r.user_id=u.id WHERE u.state='active' AND u.verified_at IS NOT NULL AND r.role='reviewer' ORDER BY u.email,u.id LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
}

export async function screening(db: PoolClient, revisionId: string) {
  const r = (
    await db.query(
      'SELECT id,submission_id AS "submissionId",revision_id AS "revisionId",version,outcome,reason,created_by AS "createdBy",created_at AS "createdAt" FROM confsys.review_screenings WHERE revision_id=$1 ORDER BY version DESC LIMIT 1',
      [revisionId],
    )
  ).rows[0];
  return r
    ? reviewScreeningSchema.parse({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })
    : null;
}
export async function screeningById(db: PoolClient, id: string) {
  const r = (
    await db.query(
      'SELECT id,submission_id AS "submissionId",revision_id AS "revisionId",version,outcome,reason,created_by AS "createdBy",created_at AS "createdAt" FROM confsys.review_screenings WHERE id=$1',
      [id],
    )
  ).rows[0];
  return r
    ? reviewScreeningSchema.parse({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })
    : null;
}
export async function screeningStatus(db: PoolClient, revisionId: string) {
  const r = (
    await db.query<{ outcome: ReviewScreening["outcome"] }>(
      "SELECT outcome FROM confsys.review_screening_status WHERE revision_id=$1",
      [revisionId],
    )
  ).rows[0];
  return r?.outcome ?? ("unchecked" as const);
}
export async function createScreening(
  db: PoolClient,
  data: {
    id: string;
    submissionId: string;
    revisionId: string;
    expectedVersion: number;
    outcome: ReviewScreening["outcome"];
    reason: string;
  },
  actor: string,
) {
  await db.query(
    "INSERT INTO confsys.review_screenings(id,submission_id,revision_id,version,outcome,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      data.id,
      data.submissionId,
      data.revisionId,
      data.expectedVersion + 1,
      data.outcome,
      data.reason,
      actor,
    ],
  );
}
export async function requiresScreening(db: PoolClient, revisionId: string) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.review_assignments a JOIN confsys.review_forms f ON f.id=a.form_id WHERE a.revision_id=$1 AND coalesce((f.document->>'requireScreening')::boolean,false) LIMIT 1",
      [revisionId],
    )
  ).rowCount;
}
export async function screeningRecipients(db: PoolClient, revisionId: string) {
  return (
    await db.query<{ reviewer_id: string }>(
      "SELECT DISTINCT reviewer_id FROM confsys.review_assignments WHERE revision_id=$1 AND state IN('invited','accepted')",
      [revisionId],
    )
  ).rows.map((r) => r.reviewer_id);
}
export async function workload(
  db: PoolClient,
  reviewerIds: string[],
  actor: { id: string; email: string },
  chairId: string | null,
) {
  return (
    await db.query<{
      reviewerId: string;
      invited: number;
      accepted: number;
      submitted: number;
      overdue: number;
    }>(
      `SELECT a.reviewer_id AS "reviewerId",count(*) FILTER(WHERE a.state='invited')::int AS invited,count(*) FILTER(WHERE a.state='accepted')::int AS accepted,count(*) FILTER(WHERE a.state='submitted')::int AS submitted,count(*) FILTER(WHERE a.state IN('invited','accepted') AND coalesce((SELECT x.deadline FROM confsys.review_deadline_extensions x WHERE x.assignment_id=a.id ORDER BY x.assignment_version DESC LIMIT 1),(f.document->>'closesAt')::timestamptz)<=now())::int AS overdue FROM confsys.review_assignments a JOIN confsys.submission_revisions r ON r.id=a.revision_id JOIN confsys.submissions s ON s.id=a.submission_id JOIN confsys.review_forms f ON f.id=a.form_id WHERE a.reviewer_id=ANY($1::uuid[]) AND s.state<>'withdrawn' AND s.owner_id<>$2 AND NOT EXISTS(SELECT 1 FROM confsys.submission_author_conflicts conflict WHERE conflict.revision_id=r.id AND conflict.user_id=$2) AND NOT EXISTS(SELECT 1 FROM confsys.review_conflicts c WHERE c.submission_id=s.id AND c.user_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM confsys.review_chair_scopes scope WHERE scope.user_id=$3 AND scope.track_id=r.document->>'trackId')) GROUP BY a.reviewer_id`,
      [reviewerIds, actor.id, chairId],
    )
  ).rows;
}

// One deadline projection per domain keeps scoring, reminders and assignment views aligned.
export async function deadlineHistory(
  db: PoolClient,
  assignmentId: string,
  original: string,
) {
  const rows = (
    await db.query<{
      id: string;
      previous_deadline: Date;
      deadline: Date;
      reason: string;
      created_at: Date;
    }>(
      "SELECT id,previous_deadline,deadline,reason,created_at FROM confsys.review_deadline_extensions WHERE assignment_id=$1 ORDER BY assignment_version LIMIT 50",
      [assignmentId],
    )
  ).rows;
  const deadlineHistory = rows.map((r) => ({
    id: r.id,
    previousDeadline: r.previous_deadline.toISOString(),
    deadline: r.deadline.toISOString(),
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
  return {
    effectiveDeadline: deadlineHistory.at(-1)?.deadline ?? original,
    deadlineHistory,
  };
}
export async function extensionById(db: PoolClient, id: string) {
  return (
    await db.query<{
      assignment_id: string;
      assignment_version: number;
      deadline: Date;
      reason: string;
    }>(
      "SELECT assignment_id,assignment_version,deadline,reason FROM confsys.review_deadline_extensions WHERE id=$1",
      [id],
    )
  ).rows[0];
}
export async function extendDeadline(
  db: PoolClient,
  input: {
    id: string;
    assignmentId: string;
    expectedVersion: number;
    deadline: string;
    reason: string;
  },
  previous: string,
  actorId: string,
) {
  await db.query(
    "INSERT INTO confsys.review_deadline_extensions(id,assignment_id,assignment_version,previous_deadline,deadline,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      input.id,
      input.assignmentId,
      input.expectedVersion + 1,
      previous,
      input.deadline,
      input.reason,
      actorId,
    ],
  );
  await db.query(
    "UPDATE confsys.review_assignments SET version=version+1 WHERE id=$1",
    [input.assignmentId],
  );
}
export async function deadlineExtensionAllowed(
  db: PoolClient,
  deadline: string,
) {
  return (
    (
      await db.query<{ allowed: boolean }>(
        "SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz<=clock_timestamp()+interval '365 days' AS allowed",
        [deadline],
      )
    ).rows[0]?.allowed === true
  );
}

export async function roundProgress(db: PoolClient, revisionIds: string[]) {
  return (
    await db.query<{
      revisionId: string;
      round: number;
      pending: number;
      submitted: number;
      closed: number;
    }>(
      `SELECT revision_id AS "revisionId",round,count(*) FILTER(WHERE state IN('invited','accepted'))::int AS pending,count(*) FILTER(WHERE state='submitted')::int AS submitted,count(*) FILTER(WHERE state IN('declined','conflicted','revoked'))::int AS closed FROM confsys.review_assignments WHERE revision_id=ANY($1::uuid[]) GROUP BY revision_id,round ORDER BY revision_id,round`,
      [revisionIds],
    )
  ).rows;
}

export async function revocation(db: PoolClient, assignmentId: string) {
  const r = (
    await db.query<{
      id: string;
      reason: string;
      created_at: Date;
      assignment_version: number;
    }>(
      "SELECT id,reason,created_at,assignment_version FROM confsys.review_assignment_revocations WHERE assignment_id=$1",
      [assignmentId],
    )
  ).rows[0];
  return r
    ? {
        id: r.id,
        reason: r.reason,
        createdAt: r.created_at.toISOString(),
        version: r.assignment_version,
      }
    : null;
}
export async function revoke(
  db: PoolClient,
  input: {
    id: string;
    assignmentId: string;
    expectedVersion: number;
    reason: string;
  },
  previous: string,
  actorId: string,
) {
  await db.query(
    "INSERT INTO confsys.review_assignment_revocations(id,assignment_id,assignment_version,previous_state,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [
      input.id,
      input.assignmentId,
      input.expectedVersion + 1,
      previous,
      input.reason,
      actorId,
    ],
  );
  await db.query(
    "UPDATE confsys.review_assignments SET state='revoked',version=version+1,updated_at=now() WHERE id=$1",
    [input.assignmentId],
  );
}

export async function revocationAssignment(db: PoolClient, id: string) {
  return (
    (
      await db.query<{ assignment_id: string }>(
        "SELECT assignment_id FROM confsys.review_assignment_revocations WHERE id=$1",
        [id],
      )
    ).rows[0]?.assignment_id ?? null
  );
}

export async function savePublicationSnapshot(
  db: PoolClient,
  row: DecisionRow,
) {
  await db.query(
    `INSERT INTO confsys.review_publication_snapshots(decision_id,author_comments) SELECT $1,coalesce(jsonb_agg(a.document->>'authorComment' ORDER BY a.id),'[]'::jsonb) FROM confsys.review_assignments a WHERE a.revision_id=$2 AND a.round=$3 AND a.state='submitted' ON CONFLICT(decision_id) DO NOTHING`,
    [row.id, row.revision_id, row.round],
  );
}
export async function saveRevisionRequest(
  db: PoolClient,
  id: string,
  row: DecisionRow,
) {
  await db.query(
    "INSERT INTO confsys.submission_revision_requests(id,submission_id,revision_id,decision_id,deadline) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(decision_id) DO NOTHING",
    [id, row.submission_id, row.revision_id, row.id, row.revision_deadline],
  );
}
