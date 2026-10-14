import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  competitionSchema,
  competitionEntrySchema,
  competitionAssignmentSchema,
  competitionPublicSchema,
  competitionAwardDraftSchema,
  type CompetitionConfig,
  type CompetitionScore,
  type CompetitionAdmin,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export async function context(
  db: PoolClient,
  actorId: string,
  manage: boolean,
) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.competitions_manage',$2,true),set_config('app.submissions_admin',$2,true)",
    [actorId, String(manage)],
  );
}
export async function competition(db: PoolClient, id: string, lock = false) {
  const r = (
    await db.query<{
      id: string;
      version: number;
      current_rubric_id: string;
      document: unknown;
      award_draft: unknown[];
      award_reason: string;
      active_publication_id: string | null;
    }>(
      `SELECT c.*,r.document FROM confsys.competitions c JOIN confsys.competition_rubrics r ON r.id=c.current_rubric_id WHERE c.id=$1${lock ? " FOR UPDATE OF c" : ""}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("NOT_FOUND");
  return {
    value: competitionSchema.parse({
      id: r.id,
      version: r.version,
      currentRubricId: r.current_rubric_id,
      config: r.document,
    }),
    awards: r.award_draft.map((v) => competitionAwardDraftSchema.parse(v)),
    reason: r.award_reason,
    activePublicationId: r.active_publication_id,
  };
}
export async function competitions(db: PoolClient) {
  return (
    await db.query(
      'SELECT c.id,c.version,c.current_rubric_id AS "currentRubricId",r.document AS config FROM confsys.competitions c JOIN confsys.competition_rubrics r ON r.id=c.current_rubric_id ORDER BY c.id LIMIT 51',
    )
  ).rows.map((r) => competitionSchema.parse(r));
}
export async function configure(
  db: PoolClient,
  id: string,
  expectedVersion: number,
  config: CompetitionConfig,
  actorId: string,
) {
  let current;
  try {
    current = await competition(db, id, true);
  } catch (e) {
    if (!(e instanceof AuthError && e.code === "NOT_FOUND")) throw e;
  }
  if (current) {
    if (current.value.version !== expectedVersion)
      throw new AuthError("CONFLICT");
    if (
      (
        await db.query(
          "SELECT 1 FROM confsys.competition_assignments WHERE competition_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    )
      throw new AuthError("CONFLICT");
  } else {
    if (expectedVersion !== 0) throw new AuthError("NOT_FOUND");
    if ((await competitions(db)).length >= 50) throw new AuthError("CONFLICT");
    await db.query(
      "INSERT INTO confsys.competitions(id,version) VALUES($1,1)",
      [id],
    );
  }
  const rubricId = randomUUID(),
    rubricVersion = Number(
      (
        await db.query(
          "SELECT coalesce(max(version),0)+1 AS next FROM confsys.competition_rubrics WHERE competition_id=$1",
          [id],
        )
      ).rows[0].next,
    );
  await db.query(
    "INSERT INTO confsys.competition_rubrics(id,competition_id,version,document,created_by) VALUES($1,$2,$3,$4,$5)",
    [rubricId, id, rubricVersion, config, actorId],
  );
  await db.query(
    "UPDATE confsys.competitions SET current_rubric_id=$2,version=version+$3 WHERE id=$1",
    [id, rubricId, current ? 1 : 0],
  );
}
const entryFields =
  'e.id,e.competition_id AS "competitionId",e.submission_id AS "submissionId",e.revision_id AS "revisionId",e.owner_id AS "ownerId",e.version,e.state,e.title,e.presenter_name AS "presenterName",e.predecessor_id AS "predecessorId",e.replacement_reason AS "replacementReason",e.reason';
export async function entry(db: PoolClient, id: string, lock = false) {
  const r = (
    await db.query(
      `SELECT ${entryFields} FROM confsys.competition_entries e WHERE e.id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("NOT_FOUND");
  return competitionEntrySchema.parse(r);
}
export async function entries(
  db: PoolClient,
  ownerId: string | null,
  competitionId: string | null,
  offset: number,
) {
  const rows = (
    await db.query(
      `SELECT ${entryFields} FROM confsys.competition_entries e WHERE ($1::uuid IS NULL OR e.owner_id=$1) AND ($2::uuid IS NULL OR e.competition_id=$2) ORDER BY e.id LIMIT 21 OFFSET $3`,
      [ownerId, competitionId, offset],
    )
  ).rows;
  return {
    entries: rows.slice(0, 20).map((r) => competitionEntrySchema.parse(r)),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function allEntries(db: PoolClient, competitionId: string) {
  return (
    await db.query(
      `SELECT ${entryFields} FROM confsys.competition_entries e WHERE e.competition_id=$1 AND NOT EXISTS(SELECT 1 FROM confsys.competition_entries child WHERE child.predecessor_id=e.id) ORDER BY e.id`,
      [competitionId],
    )
  ).rows.map((r) => competitionEntrySchema.parse(r));
}
async function assertEntryCapacity(db: PoolClient, competitionId: string) {
  if (
    Number(
      (
        await db.query(
          "SELECT coalesce((SELECT total FROM confsys.competition_entry_counts WHERE competition_id=$1),0) AS count",
          [competitionId],
        )
      ).rows[0].count,
    ) >= 2000
  )
    throw new AuthError("CONFLICT");
}
export async function successor(db: PoolClient, predecessorId: string) {
  const result = await db.query<{ id: string }>(
    "SELECT id FROM confsys.competition_entries WHERE predecessor_id=$1",
    [predecessorId],
  );
  return result.rows[0] ? entry(db, result.rows[0].id) : null;
}
export async function replaceEntry(
  db: PoolClient,
  previous: ReturnType<typeof competitionEntrySchema.parse>,
  revisionId: string,
  title: string,
  presenter: string,
  reason: string,
) {
  await assertEntryCapacity(db, previous.competitionId);
  const id = randomUUID();
  await db.query(
    `INSERT INTO confsys.competition_entries(id,competition_id,submission_id,revision_id,owner_id,state,title,presenter_name,predecessor_id,replacement_reason)
    VALUES($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9)`,
    [
      id,
      previous.competitionId,
      previous.submissionId,
      revisionId,
      previous.ownerId,
      title,
      presenter,
      previous.id,
      reason,
    ],
  );
  return entry(db, id);
}
export async function enroll(
  db: PoolClient,
  competitionId: string,
  submissionId: string,
  revisionId: string,
  ownerId: string,
  title: string,
  presenter: string,
) {
  const prior = (
    await db.query<{ id: string }>(
      "SELECT e.id FROM confsys.competition_entries e WHERE e.competition_id=$1 AND e.submission_id=$2 AND NOT EXISTS(SELECT 1 FROM confsys.competition_entries child WHERE child.predecessor_id=e.id)",
      [competitionId, submissionId],
    )
  ).rows[0];
  if (prior) return { value: await entry(db, prior.id), created: false };
  await assertEntryCapacity(db, competitionId);
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.competition_entries(id,competition_id,submission_id,revision_id,owner_id,state,title,presenter_name) VALUES($1,$2,$3,$4,$5,'requested',$6,$7)",
    [id, competitionId, submissionId, revisionId, ownerId, title, presenter],
  );
  return { value: await entry(db, id), created: true };
}
export async function entryState(
  db: PoolClient,
  id: string,
  state: string,
  reason: string,
) {
  await db.query(
    "UPDATE confsys.competition_entries SET state=$2,reason=$3,version=version+1 WHERE id=$1",
    [id, state, reason],
  );
}
const assignmentFields =
  'a.id,a.competition_id AS "competitionId",a.entry_id AS "entryId",a.judge_id AS "judgeId",a.rubric_id AS "rubricId",a.version,a.state,a.document,r.document AS config,e.title,e.presenter_name AS "presenterName"';
export async function assignment(db: PoolClient, id: string, lock = false) {
  const r = (
    await db.query(
      `SELECT ${assignmentFields} FROM confsys.competition_assignments a JOIN confsys.competition_rubrics r ON r.id=a.rubric_id JOIN confsys.competition_entries e ON e.id=a.entry_id WHERE a.id=$1${lock ? " FOR UPDATE OF a" : ""}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("NOT_FOUND");
  return competitionAssignmentSchema.parse(r);
}
export async function assignments(
  db: PoolClient,
  judgeId: string | null,
  entryIds: string[] | null,
  offset: number,
) {
  const rows = (
    await db.query(
      `SELECT ${assignmentFields} FROM confsys.competition_assignments a JOIN confsys.competition_rubrics r ON r.id=a.rubric_id JOIN confsys.competition_entries e ON e.id=a.entry_id WHERE ($1::uuid IS NULL OR (a.judge_id=$1 AND NOT EXISTS(SELECT 1 FROM confsys.submission_author_conflicts conflict WHERE conflict.revision_id=e.revision_id AND conflict.user_id=a.judge_id))) AND ($2::uuid[] IS NULL OR a.entry_id=ANY($2::uuid[])) ORDER BY a.id LIMIT $4 OFFSET $3`,
      [judgeId, entryIds, offset, judgeId ? 21 : 401],
    )
  ).rows;
  return {
    assignments: rows
      .slice(0, judgeId ? 20 : 400)
      .map((r) => competitionAssignmentSchema.parse(r)),
    nextOffset:
      rows.length > (judgeId ? 20 : 400) ? offset + (judgeId ? 20 : 400) : null,
  };
}
export async function assign(
  db: PoolClient,
  entryId: string,
  competitionId: string,
  judgeId: string,
  rubricId: string,
) {
  const existing = (
    await db.query<{ id: string }>(
      "SELECT id FROM confsys.competition_assignments WHERE entry_id=$1 AND judge_id=$2",
      [entryId, judgeId],
    )
  ).rows[0];
  if (existing)
    return { value: await assignment(db, existing.id), created: false };
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM confsys.competition_assignments WHERE entry_id=$1",
          [entryId],
        )
      ).rows[0].count,
    ) >= 20
  )
    throw new AuthError("CONFLICT");
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.competition_assignments(id,entry_id,competition_id,judge_id,rubric_id) VALUES($1,$2,$3,$4,$5)",
    [id, entryId, competitionId, judgeId, rubricId],
  );
  return { value: await assignment(db, id), created: true };
}
export async function score(
  db: PoolClient,
  id: string,
  document: CompetitionScore,
  points: number,
  maximum: number,
  submit: boolean,
) {
  await db.query(
    "UPDATE confsys.competition_assignments SET document=$2,state=$3,version=version+1 WHERE id=$1",
    [id, document, submit ? "submitted" : "assigned"],
  );
  if (submit)
    await db.query(
      "INSERT INTO confsys.competition_scores(id,assignment_id,document,points,maximum) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), id, document, points, maximum],
    );
}
export async function cancel(db: PoolClient, id: string) {
  await db.query(
    "UPDATE confsys.competition_assignments SET state='cancelled',version=version+1 WHERE id=$1",
    [id],
  );
}
export async function conflict(
  db: PoolClient,
  id: string,
  entryId: string,
  judgeId: string,
  reason: string,
) {
  await db.query(
    "INSERT INTO confsys.competition_conflicts(entry_id,competition_id,judge_id,reason) SELECT id,competition_id,$2,$3 FROM confsys.competition_entries WHERE id=$1 ON CONFLICT DO NOTHING",
    [entryId, judgeId, reason],
  );
  await db.query(
    "UPDATE confsys.competition_assignments SET state='conflicted',version=version+1 WHERE id=$1",
    [id],
  );
}
export async function hasConflict(
  db: PoolClient,
  entryId: string,
  judgeId: string,
) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.competition_conflicts WHERE entry_id=$1 AND judge_id=$2",
      [entryId, judgeId],
    )
  ).rowCount;
}
export async function totals(
  db: PoolClient,
  entryIds: string[],
): Promise<CompetitionAdmin["totals"]> {
  const rows = (
    await db.query<{
      entryId: string;
      submitted: number;
      missing: number;
      numerator: string;
      denominator: string;
    }>(
      `SELECT a.entry_id AS "entryId",count(*) FILTER(WHERE a.state='submitted' AND s.id IS NOT NULL)::int AS submitted,count(*) FILTER(WHERE a.state='assigned' OR(a.state='submitted' AND s.id IS NULL))::int AS missing,coalesce(sum(s.points) FILTER(WHERE a.state='submitted'),0)::text AS numerator,coalesce(sum(s.maximum) FILTER(WHERE a.state='submitted'),0)::text AS denominator FROM confsys.competition_assignments a LEFT JOIN confsys.competition_scores s ON s.assignment_id=a.id WHERE a.entry_id=ANY($1::uuid[]) AND a.state IN('assigned','submitted') GROUP BY a.entry_id`,
      [entryIds],
    )
  ).rows;
  return entryIds.map((entryId) => {
    const row = rows.find((r) => r.entryId === entryId) ?? {
      entryId,
      submitted: 0,
      missing: 0,
      numerator: "0",
      denominator: "0",
    };
    return {
      ...row,
      basisPoints:
        row.denominator === "0"
          ? null
          : Math.round(
              (Number(row.numerator) * 10000) / Number(row.denominator),
            ),
    };
  });
}
export async function admin(
  db: PoolClient,
  competitionId: string | null = null,
  offset = 0,
) {
  const cs = await competitions(db),
    page = await entries(db, null, competitionId, offset),
    ids = page.entries.map((e) => e.id),
    scores = await assignments(db, null, ids, 0);
  const awardDrafts: CompetitionAdmin["awardDrafts"] = [];
  for (const c of cs) {
    const d = await competition(db, c.id);
    awardDrafts.push({
      competitionId: c.id,
      awards: d.awards,
      reason: d.reason,
    });
  }
  return {
    competitions: cs,
    ...page,
    assignments: scores.assignments,
    totals: await totals(db, ids),
    awardDrafts,
  };
}
export async function catalog(db: PoolClient, actorId: string, offset = 0) {
  return {
    competitions: await competitions(db),
    ...(await entries(db, actorId, null, offset)),
  };
}
export async function bump(db: PoolClient, competitionId: string) {
  await db.query(
    "UPDATE confsys.competitions SET version=version+1 WHERE id=$1",
    [competitionId],
  );
}
export async function awards(
  db: PoolClient,
  competitionId: string,
  awards: unknown[],
  reason: string,
) {
  await db.query(
    "UPDATE confsys.competitions SET award_draft=$2,award_reason=$3,version=version+1 WHERE id=$1",
    [competitionId, JSON.stringify(awards), reason],
  );
}
export async function publicAwards(db: Pool | PoolClient) {
  const rows = (
    await db.query<{
      id: string;
      publication_id: string;
      document: Record<string, unknown>;
      published_at: Date;
    }>(
      "SELECT c.id,p.id AS publication_id,p.document,p.published_at FROM confsys.competitions c JOIN confsys.competition_publications p ON p.id=c.active_publication_id ORDER BY c.id LIMIT 50",
    )
  ).rows;
  return competitionPublicSchema.parse({
    competitions: rows.map((r) => ({
      id: r.id,
      publicationId: r.publication_id,
      publishedAt: r.published_at.toISOString(),
      ...r.document,
    })),
  });
}
export async function publish(
  db: PoolClient,
  competitionId: string,
  version: number,
  document: unknown,
  actorId: string,
) {
  const existing = (
    await db.query<{ id: string }>(
      "SELECT id FROM confsys.competition_publications WHERE competition_id=$1 AND source_version=$2",
      [competitionId, version],
    )
  ).rows[0];
  if (existing) return { id: existing.id, created: false };
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.competition_publications(id,competition_id,source_version,document,published_by) VALUES($1,$2,$3,$4,$5)",
    [id, competitionId, version, document, actorId],
  );
  await db.query(
    "UPDATE confsys.competitions SET active_publication_id=$2 WHERE id=$1",
    [competitionId, id],
  );
  return { id, created: true };
}
export async function audit(
  db: PoolClient,
  actor: string,
  event: string,
  resourceId: string,
  requestId: string,
  reason = "Competition lifecycle",
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session',$4,$5,$6)",
    [
      randomUUID(),
      event,
      actor,
      "Competition lifecycle",
      JSON.stringify({ resourceId, reason }),
      requestId,
    ],
  );
}

export async function judgingEligible(db: PoolClient, assignmentId: string) {
  return (
    (
      await db.query<{ eligible: boolean }>(
        "SELECT eligible FROM confsys.competition_judging_eligibility WHERE id=$1",
        [assignmentId],
      )
    ).rows[0]?.eligible === true
  );
}
export async function actorEmail(db: PoolClient, userId: string) {
  const r = (
    await db.query<{ email: string; state: string; verified_at: Date | null }>(
      "SELECT email,state,verified_at FROM confsys.users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  if (!r || r.state !== "active" || !r.verified_at)
    throw new AuthError("NOT_FOUND");
  return r.email;
}
export async function registered(db: PoolClient, userId: string) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.competition_registration_eligibility WHERE user_id=$1 AND eligible",
      [userId],
    )
  ).rowCount;
}

export async function authorizedPresenterSuccessor(
  db: PoolClient,
  prior: string,
  next: string,
) {
  const r = await db.query(
    "SELECT 1 FROM confsys.competition_presenter_successors WHERE prior_revision_id=$1 AND new_revision_id=$2",
    [prior, next],
  );
  return !!r.rowCount;
}
export async function assertLatestEntry(db: PoolClient, entryId: string) {
  const r = await db.query<{ current: boolean }>(
    "SELECT current FROM confsys.competition_entry_current WHERE id=$1",
    [entryId],
  );
  if (!r.rows[0]?.current) throw new AuthError("CONFLICT");
}
