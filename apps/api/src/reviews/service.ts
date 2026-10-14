import { isRevisionAuthorAccount } from "../auth/conflicts.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import {
  reviewFormDocumentSchema,
  reviewScreenInput,
  reviewAssignInput,
  reviewAssignmentActionInput,
  reviewDecisionInput,
  reviewEndpoints,
  reviewPageInput,
  type ReviewAssignment,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
import { sessionActor } from "../auth/session.js";
import {
  lockAccess,
  lockAccessShared,
  rolesFor,
  recordAccess,
  accountById,
} from "../access/repository.js";
import {
  requirePermission,
  assertRecentPassword,
  permissionsFor,
} from "../access/policy.js";
import { effectivePublicSite } from "../site/branding.js";
import * as repo from "./repository.js";
import { validateReviewScores } from "./policy.js";
type Actor = { id: string; email: string };
async function noConflict(db: PoolClient, paper: repo.PaperRow, actor: Actor) {
  if (
    paper.owner_id === actor.id ||
    (await isRevisionAuthorAccount(db,paper.id,actor.id)) ||
    (await repo.hasConflict(db, paper.submission_id, actor.id))
  )
    throw new AuthError("FORBIDDEN");
}
async function manageTrack(
  db: PoolClient,
  actorId: string,
  track: string,
  decide = false,
) {
  const roles = await rolesFor(db, actorId);
  requirePermission(roles, decide ? "reviews.decide" : "reviews.manage");
  if (!decide && roles.includes("conference_admin")) return;
  if (!(await repo.hasScope(db, actorId, track)))
    throw new AuthError("FORBIDDEN");
}
async function assertScreening(
  db: PoolClient,
  revisionId: string,
  required = false,
) {
  const state = await repo.screeningStatus(db, revisionId);
  if (state !== "ready" && (required || state !== "unchecked"))
    throw new AuthError("CONFLICT");
}
async function projection(
  db: PoolClient,
  row: repo.AssignmentRow,
  actor: Actor,
  manager = false,
): Promise<ReviewAssignment> {
  const form = await repo.form(db, row.form_id);
  if (!form) throw new AuthError("CONFLICT");
  const masked = {
    id: row.id,
    submissionId: row.submission_id,
    revisionId: row.revision_id,
    state: row.state,
    version: row.version,
    paper: {
      title: "",
      abstract: "",
      trackId: "",
      topicIds: [],
      attachmentIds: [],
      authors: [],
    },
    form,
    screening: await repo.screeningStatus(db, row.revision_id),
    document: { scores: [], authorComment: "", privateComment: "" },
  };
  if (!manager && (row.state === "conflicted" || row.state === "declined"))
    return masked;
  const paper = await repo.paper(db, row.revision_id);
  if (!paper || paper.state === "withdrawn") throw new AuthError("FORBIDDEN");
  if (manager)
    await manageTrack(db, actor.id, repo.paperDocument(paper).trackId);
  else if (row.reviewer_id !== actor.id) throw new AuthError("FORBIDDEN");
  await noConflict(db, paper, actor);
  const doc = repo.paperDocument(paper);
  if (form.document.mode === "double_blind" && !row.anonymous_confirmed)
    throw new AuthError("FORBIDDEN");
  return {
    ...masked,
    paper: {
      title: doc.title,
      abstract: doc.abstract,
      trackId: doc.trackId,
      topicIds: doc.topicIds,
      attachmentIds: doc.attachmentIds,
      authors:
        form.document.mode === "single_blind"
          ? doc.authors.map((a) => ({
              name: a.name,
              affiliation: a.affiliation,
            }))
          : [],
    },
    document: repo.scoreDocument(row),
  };
}
async function safeAudit(
  db: PoolClient,
  actor: Actor,
  event: string,
  subject: string,
  requestId: string,
) {
  await recordAccess(db, {
    action: event,
    targetId: actor.id,
    actorId: actor.id,
    source: "session",
    reason: "Explicit review workflow action",
    before: "null",
    after: JSON.stringify({ resourceId: subject }),
    requestId,
  });
}
export function createReviewService(pool: Pool, config: ApiConfig) {
  async function transaction<T>(
    raw: string | undefined,
    permission: string | null,
    write: boolean,
    work: (db: PoolClient, actor: Actor) => Promise<T>,
  ) {
    return withIdentityTransaction(pool, async (db) => {
      if (write) await lockAccess(db);
      else await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (write && permission === "access.roles.manage")
        assertRecentPassword(actor.passwordVerifiedAt, new Date());
      const roles = await rolesFor(db, actor.id);
      if (permission) requirePermission(roles, permission);
      await repo.context(
        db,
        actor.id,
        permission === "reviews.manage" ||
          permission === "reviews.decide" ||
          permission === "access.roles.manage",
      );
      return work(db, actor);
    });
  }
  async function notify(
    db: PoolClient,
    userId: string,
    eventKey: string,
    subject: string,
    requestId: string,
  ) {
    const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
    await enqueueBusinessNotification(
      db,
      { CONFERENCE_NAME: brand.conferenceName },
      {
        userId,
        eventKey,
        subject,
        text: `請登入本研討會工作台查看更新 / Sign in to your conference dashboard: ${config.PUBLIC_APP_ORIGIN}/reviews`,
        requestId,
      },
    );
  }
  return {
    async board(raw: string | undefined, input: unknown) {
      const { offset } = reviewPageInput.parse(input);
      return transaction(raw, "reviews.manage", false, async (db, actor) => {
        const roles = await rolesFor(db, actor.id),
          chairId = roles.includes("conference_admin") ? null : actor.id;
        // One transaction owns one pg connection; queries must not overlap on it.
        const forms = await repo.forms(db, offset);
        const scopes = await repo.scopes(db, offset, chairId);
        const assignments = await repo.assignmentRows(
          db,
          offset,
          null,
          chairId,
        );
        const decisions = await repo.decisions(db, offset, chairId);
        const papers = await repo.candidates(db, offset, actor, chairId);
        const reviewers = await repo.reviewers(db, offset);
        const items = [];
        for (const row of assignments.slice(0, 20)) {
          try {
            items.push({
              ...(await projection(db, row, actor, true)),
              reviewerId: row.reviewer_id,
            });
          } catch (e) {
            if (!(e instanceof AuthError && e.code === "FORBIDDEN")) throw e;
          }
        }
        const visibleDecisions = [];
        for (const row of decisions.slice(0, 20)) {
          const paper = await repo.paper(db, row.revision_id);
          if (!paper) continue;
          try {
            await noConflict(db, paper, actor);
            visibleDecisions.push(repo.decisionDto(row));
          } catch (e) {
            if (!(e instanceof AuthError && e.code === "FORBIDDEN")) throw e;
          }
        }
        const screenings = [];
        for (const revisionId of new Set([
          ...papers.slice(0, 20).map((p) => p.revisionId),
          ...items.map((a) => a.revisionId),
        ])) {
          const latest = await repo.screening(db, revisionId);
          if (latest) screenings.push(latest);
        }
        return {
          screenings,
          workload: await repo.workload(
            db,
            reviewers.slice(0, 20).map((r) => r.id),
            actor,
            chairId,
          ),
          papers: papers.slice(0, 20),
          reviewers: reviewers.slice(0, 20),
          forms: forms.slice(0, 20),
          scopes: scopes.slice(0, 20),
          assignments: items,
          decisions: visibleDecisions,
          nextOffset: [
            forms,
            scopes,
            assignments,
            decisions,
            papers,
            reviewers,
          ].some((rows) => rows.length > 20)
            ? offset + 20
            : null,
        };
      });
    },
    async assigned(raw: string | undefined, input: unknown) {
      const { offset } = reviewPageInput.parse(input);
      return transaction(raw, "reviews.assigned", false, async (db, actor) => {
        const rows = await repo.assignmentRows(db, offset, actor.id, null),
          items = [];
        for (const row of rows.slice(0, 20)) {
          try {
            items.push(await projection(db, row, actor));
          } catch (e) {
            if (!(e instanceof AuthError && e.code === "FORBIDDEN")) throw e;
          }
        }
        return { items, nextOffset: rows.length > 20 ? offset + 20 : null };
      });
    },
    async configure(
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) {
      const document = reviewFormDocumentSchema.parse(input);
      return transaction(
        raw,
        "access.roles.manage",
        true,
        async (db, actor) => {
          if (new Date(document.closesAt) <= new Date())
            throw new AuthError("INVALID_REQUEST");
          const form = await repo.createForm(
            db,
            randomUUID(),
            actor.id,
            document,
          );
          await safeAudit(db, actor, "review.form_created", form.id, requestId);
          return form;
        },
      );
    },
    async scope(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewEndpoints.reviewScope.input.parse(input);
      return transaction(
        raw,
        "access.roles.manage",
        true,
        async (db, actor) => {
          const account = await accountById(db, data.userId);
          if (
            account.state !== "active" ||
            !account.verified ||
            !permissionsFor(account.roles).includes("reviews.decide")
          )
            throw new AuthError("CONFLICT");
          const configRow = (
            await db.query<{ document: { tracks: { id: string }[] } }>(
              "SELECT document FROM confsys.submission_config WHERE singleton=true",
            )
          ).rows[0];
          if (!configRow?.document.tracks.some((t) => t.id === data.trackId))
            throw new AuthError("INVALID_REQUEST");
          const changed = await repo.setScope(
            db,
            data.userId,
            data.trackId,
            data.remove,
          );
          if (changed)
            await safeAudit(
              db,
              actor,
              "review.scope_changed",
              data.userId,
              requestId,
            );
          return { changed };
        },
      );
    },
    async conflict(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewEndpoints.reviewConflict.input.parse(input);
      return transaction(raw, "reviews.manage", true, async (db, actor) => {
        const submission = await repo.submissionForReview(
          db,
          data.submissionId,
        );
        if (!submission?.current_revision_id) throw new AuthError("NOT_FOUND");
        const paper = await repo.paper(db, submission.current_revision_id);
        if (!paper) throw new AuthError("NOT_FOUND");
        await manageTrack(db, actor.id, repo.paperDocument(paper).trackId);
        if (await repo.hasConflict(db, data.submissionId, actor.id))
          return { changed: false };
        await repo.declareConflict(
          db,
          data.submissionId,
          actor.id,
          data.reason,
        );
        await safeAudit(
          db,
          actor,
          "review.chair_conflict",
          data.submissionId,
          requestId,
        );
        return { changed: true };
      });
    },
    async screen(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewScreenInput.parse(input);
      return transaction(raw, "reviews.manage", true, async (db, actor) => {
        const paper = await repo.paper(db, data.revisionId);
        if (
          !paper ||
          paper.submission_id !== data.submissionId ||
          paper.state !== "submitted" ||
          paper.current_revision_id !== data.revisionId
        )
          throw new AuthError("CONFLICT");
        await manageTrack(db, actor.id, repo.paperDocument(paper).trackId);
        await noConflict(db, paper, actor);
        const existing = await repo.screeningById(db, data.id);
        if (existing) {
          if (
            existing.revisionId !== data.revisionId ||
            existing.submissionId !== data.submissionId ||
            existing.version !== data.expectedVersion + 1 ||
            existing.outcome !== data.outcome ||
            existing.reason !== data.reason
          )
            throw new AuthError("CONFLICT");
          return existing;
        }
        const current = await repo.screening(db, data.revisionId);
        if ((current?.version ?? 0) !== data.expectedVersion)
          throw new AuthError("CONFLICT");
        await repo.createScreening(db, data, actor.id);
        await safeAudit(
          db,
          actor,
          "review.initial_screening",
          data.id,
          requestId,
        );
        for (const reviewerId of await repo.screeningRecipients(
          db,
          data.revisionId,
        ))
          await notify(
            db,
            reviewerId,
            `review-screening:${data.id}:${reviewerId}`,
            "審查初檢狀態更新 / Review screening updated",
            requestId,
          );
        const saved = await repo.screeningById(db, data.id);
        if (!saved) throw new Error("Missing screening");
        return saved;
      });
    },
    async remind(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewEndpoints.reviewRemind.input.parse(input);
      return transaction(raw, "reviews.manage", true, async (db, actor) => {
        const row = await repo.assignment(db, data.assignmentId, true);
        if (!row) throw new AuthError("NOT_FOUND");
        if (!["invited", "accepted"].includes(row.state))
          throw new AuthError("CONFLICT");
        const view = await projection(db, row, actor, true);
        await assertScreening(
          db,
          row.revision_id,
          view.form.document.requireScreening,
        );
        if (Date.parse(view.form.document.closesAt) <= Date.now())
          throw new AuthError("CONFLICT");
        const reviewer = await accountById(db, row.reviewer_id);
        if (
          reviewer.state !== "active" ||
          !reviewer.verified ||
          !permissionsFor(reviewer.roles).includes("reviews.assigned")
        )
          throw new AuthError("CONFLICT");
        const paper = await repo.paper(db, row.revision_id);
        if (!paper) throw new AuthError("NOT_FOUND");
        await noConflict(db, paper, { id: reviewer.id, email: reviewer.email });
        await notify(
          db,
          reviewer.id,
          `review-reminder:${row.id}:${data.idempotencyKey}`,
          "待完成審查提醒 / Pending review reminder",
          requestId,
        );
        await recordAccess(db, {
          action: "review.reminder",
          targetId: actor.id,
          actorId: actor.id,
          source: "session",
          reason: "Explicit review reminder",
          before: "null",
          after: JSON.stringify({ assignmentId: row.id, reason: data.reason }),
          requestId,
        });
        return { queued: true as const };
      });
    },
    async assign(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewAssignInput.parse(input);
      return transaction(raw, "reviews.manage", true, async (db, actor) => {
        const submission = await repo.submissionForReview(
          db,
          data.submissionId,
        );
        if (
          !submission ||
          submission.state !== "submitted" ||
          submission.current_revision_id !== data.revisionId
        )
          throw new AuthError("CONFLICT");
        const paper = await repo.paper(db, data.revisionId);
        if (!paper) throw new AuthError("NOT_FOUND");
        await manageTrack(db, actor.id, repo.paperDocument(paper).trackId);
        await noConflict(db, paper, actor);
        const target = await accountById(db, data.reviewerId);
        if (
          target.state !== "active" ||
          !target.verified ||
          !permissionsFor(target.roles).includes("reviews.assigned")
        )
          throw new AuthError("CONFLICT");
        await noConflict(db, paper, { id: target.id, email: target.email });
        const form = await repo.form(db, data.formId);
        if (!form || new Date(form.document.closesAt) <= new Date())
          throw new AuthError("CONFLICT");
        await assertScreening(
          db,
          data.revisionId,
          form.document.requireScreening,
        );
        if (form.document.mode === "double_blind" && !data.anonymousConfirmed)
          throw new AuthError("INVALID_REQUEST");
        const existing = await repo.assignment(db, data.id);
        if (existing) {
          if (
            existing.submission_id !== data.submissionId ||
            existing.revision_id !== data.revisionId ||
            existing.reviewer_id !== data.reviewerId ||
            existing.form_id !== data.formId
          )
            throw new AuthError("CONFLICT");
          return projection(db, existing, actor, true);
        }
        const duplicate = await db.query(
          "SELECT 1 FROM confsys.review_assignments WHERE revision_id=$1 AND reviewer_id=$2",
          [data.revisionId, data.reviewerId],
        );
        if (duplicate.rowCount) throw new AuthError("CONFLICT");
        await repo.createAssignment(db, data, actor.id);
        const row = await repo.assignment(db, data.id);
        if (!row) throw new Error("Missing assignment");
        await safeAudit(db, actor, "review.assigned", row.id, requestId);
        await notify(
          db,
          target.id,
          `review-assigned:${row.id}`,
          "審查工作指派 / Review assignment",
          requestId,
        );
        return projection(db, row, actor, true);
      });
    },
    async action(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewAssignmentActionInput.parse(input);
      return transaction(raw, "reviews.assigned", true, async (db, actor) => {
        const row = await repo.assignment(db, data.id, true);
        if (!row || row.reviewer_id !== actor.id)
          throw new AuthError("NOT_FOUND");
        if (row.version !== data.expectedVersion)
          throw new AuthError("CONFLICT");
        if (data.action === "conflict") {
          if (data.reason.trim().length < 3)
            throw new AuthError("INVALID_REQUEST");
          await repo.declareConflict(
            db,
            row.submission_id,
            actor.id,
            data.reason,
          );
          await safeAudit(db, actor, "review.conflict", row.id, requestId);
        } else {
          const detail = await projection(db, row, actor);
          if (data.action !== "decline")
            await assertScreening(
              db,
              row.revision_id,
              detail.form.document.requireScreening,
            );
          if (
            row.state === "declined" ||
            row.state === "conflicted" ||
            row.state === "submitted"
          )
            throw new AuthError("CONFLICT");
          if (new Date(detail.form.document.closesAt) <= new Date())
            throw new AuthError("CONFLICT");
          if (data.action === "accept" || data.action === "decline") {
            if (row.state !== "invited") throw new AuthError("CONFLICT");
            await repo.updateAssignment(
              db,
              row.id,
              data.action === "accept" ? "accepted" : "declined",
              repo.scoreDocument(row),
            );
          } else {
            if (row.state !== "accepted" || !data.document)
              throw new AuthError("CONFLICT");
            validateReviewScores(
              data.document,
              detail.form.document,
              data.action === "submit",
            );
            await repo.updateAssignment(
              db,
              row.id,
              data.action === "submit" ? "submitted" : "accepted",
              data.document,
            );
          }
          await safeAudit(
            db,
            actor,
            `review.${data.action}`,
            row.id,
            requestId,
          );
        }
        const updated = await repo.assignment(db, row.id);
        if (!updated) throw new Error("Missing assignment");
        return projection(db, updated, actor);
      });
    },
    async decide(raw: string | undefined, input: unknown, requestId: string) {
      const data = reviewDecisionInput.parse(input);
      return transaction(raw, "reviews.decide", true, async (db, actor) => {
        const submission = await repo.submissionForReview(
          db,
          data.submissionId,
        );
        if (
          !submission ||
          submission.state !== "submitted" ||
          submission.current_revision_id !== data.revisionId
        )
          throw new AuthError("CONFLICT");
        const paper = await repo.paper(db, data.revisionId);
        if (!paper) throw new AuthError("NOT_FOUND");
        await manageTrack(
          db,
          actor.id,
          repo.paperDocument(paper).trackId,
          true,
        );
        await noConflict(db, paper, actor);
        if (
          (data.outcome === "revision_requested") !==
            (data.revisionDeadline !== null) ||
          (data.revisionDeadline &&
            new Date(data.revisionDeadline) <= new Date())
        )
          throw new AuthError("INVALID_REQUEST");
        if (data.outcome === "accept_oral" || data.outcome === "accept_poster")
          await assertScreening(
            db,
            data.revisionId,
            await repo.requiresScreening(db, data.revisionId),
          );
        const prior = await repo.decision(db, data.id);
        if (prior) {
          if (
            prior.submission_id !== data.submissionId ||
            prior.revision_id !== data.revisionId ||
            prior.outcome !== data.outcome ||
            prior.author_message !== data.authorMessage ||
            prior.internal_reason !== data.internalReason ||
            prior.revision_deadline?.toISOString() !==
              (data.revisionDeadline ?? undefined)
          )
            throw new AuthError("CONFLICT");
          return repo.decisionDto(prior);
        }
        if (
          (await repo.decisionVersion(db, data.submissionId)) !==
          data.expectedVersion
        )
          throw new AuthError("CONFLICT");
        await repo.createDecision(db, data, actor.id);
        await safeAudit(db, actor, "review.decision_saved", data.id, requestId);
        const result = await repo.decision(db, data.id);
        if (!result) throw new Error("Missing decision");
        return repo.decisionDto(result);
      });
    },
    async publish(raw: string | undefined, input: unknown, requestId: string) {
      const { id } = reviewEndpoints.reviewPublish.input.parse(input);
      return transaction(raw, "reviews.decide", true, async (db, actor) => {
        const row = await repo.decision(db, id);
        if (!row) throw new AuthError("NOT_FOUND");
        const submission = await repo.submissionForReview(
          db,
          row.submission_id,
        );
        if (
          !submission ||
          submission.state !== "submitted" ||
          submission.current_revision_id !== row.revision_id ||
          (await repo.decisionVersion(db, row.submission_id)) !== row.version
        )
          throw new AuthError("CONFLICT");
        const paper = await repo.paper(db, row.revision_id);
        if (!paper) throw new AuthError("NOT_FOUND");
        await manageTrack(
          db,
          actor.id,
          repo.paperDocument(paper).trackId,
          true,
        );
        await noConflict(db, paper, actor);
        if (row.outcome === "accept_oral" || row.outcome === "accept_poster")
          await assertScreening(
            db,
            row.revision_id,
            await repo.requiresScreening(db, row.revision_id),
          );
        if (row.published) return repo.decisionDto(row);
        if (row.revision_deadline && row.revision_deadline <= new Date())
          throw new AuthError("CONFLICT");
        await db.query(
          `INSERT INTO confsys.review_publication_snapshots(decision_id,author_comments) SELECT $1,coalesce(jsonb_agg(a.document->>'authorComment' ORDER BY a.id),'[]'::jsonb) FROM confsys.review_assignments a WHERE a.revision_id=$2 AND a.state='submitted' ON CONFLICT(decision_id) DO NOTHING`,
          [row.id, row.revision_id],
        );
        await repo.publishDecision(db, row, actor.id);
        if (row.outcome === "revision_requested")
          await db.query(
            "INSERT INTO confsys.submission_revision_requests(id,submission_id,revision_id,decision_id,deadline) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(decision_id) DO NOTHING",
            [
              randomUUID(),
              row.submission_id,
              row.revision_id,
              row.id,
              row.revision_deadline,
            ],
          );
        await notify(
          db,
          submission.owner_id,
          `review-result:${row.id}`,
          "投稿結果已發布 / Submission result published",
          requestId,
        );
        await safeAudit(
          db,
          actor,
          "review.result_published",
          row.id,
          requestId,
        );
        return repo.decisionDto({ ...row, published: true });
      });
    },
    async authorResults(raw: string | undefined, input: unknown) {
      const { offset } = reviewPageInput.parse(input);
      return transaction(raw, null, false, (db, actor) =>
        repo.authorResults(db, actor.id, offset),
      );
    },
  };
}
// Called only by the private file service before and after I/O with a revalidated actor.
export async function authorizeReviewFile(
  db: PoolClient,
  actorId: string,
  assignmentId: string,
  fileId: string,
) {
  requirePermission(await rolesFor(db, actorId), "reviews.assigned");
  await repo.context(db, actorId, false);
  const row = await repo.assignment(db, assignmentId);
  if (
    !row ||
    row.reviewer_id !== actorId ||
    !["accepted", "submitted"].includes(row.state)
  )
    throw new AuthError("FORBIDDEN");
  const actor = await accountById(db, actorId);
  const detail = await projection(db, row, {
    id: actor.id,
    email: actor.email,
  });
  if (!detail.paper.attachmentIds.includes(fileId))
    throw new AuthError("FORBIDDEN");
}
