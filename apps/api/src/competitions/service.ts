import { isRevisionAuthorAccount } from "../auth/conflicts.js";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import {
  competitionEndpoints,
  type CompetitionConfig,
} from "@confsys/contracts";
import { enqueueBusinessNotification } from "@confsys/notifications";
import {
  lockAccess,
  lockAccessShared,
  rolesFor,
} from "../access/repository.js";
import {
  requirePermission,
  assertRecentPassword,
  permissionsFor,
} from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import { publishedAcceptedRevision } from "../submissions/repository.js";
import * as repo from "./repository.js";
import {
  validateCompetition,
  scoreDocument,
  beforeDeadline,
  equalTotal,
} from "./policy.js";
export function createCompetitionService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    permission: "competitions.manage" | "competitions.score" | undefined,
    exclusive: boolean,
    work: (db: PoolClient, actorId: string, proof: Date | null) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      if (exclusive) await lockAccess(db);
      else await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (permission)
        requirePermission(await rolesFor(db, actor.id), permission);
      await repo.context(db, actor.id, permission === "competitions.manage");
      return work(db, actor.id, actor.passwordVerifiedAt);
    });
  const notify = async (
    db: PoolClient,
    userId: string,
    eventKey: string,
    subject: string,
    requestId: string,
  ) => {
    const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
    await enqueueBusinessNotification(
      db,
      { CONFERENCE_NAME: brand.conferenceName },
      {
        userId,
        eventKey,
        subject,
        text: `競賽狀態已更新，請登入研討會系統查看：${config.PUBLIC_APP_ORIGIN}/competitions`,
        requestId,
      },
    );
  };
  const eligible = async (
    db: PoolClient,
    revisionId: string,
    c: CompetitionConfig,
  ) => {
    const r = await publishedAcceptedRevision(db, revisionId);
    if (
      r.presentation !== c.kind ||
      !r.document.competition ||
      (c.requireRegistration && !(await repo.registered(db, r.ownerId)))
    )
      throw new AuthError("CONFLICT");
    const presenter = r.document.authors[r.document.presenterIndex];
    if (!presenter) throw new AuthError("CONFLICT");
    return { ...r, presenter };
  };
  const ownAssignment = async (
    db: PoolClient,
    assignmentId: string,
    actorId: string,
  ) => {
    const a = await repo.assignment(db, assignmentId, true);
    if (a.judgeId !== actorId) throw new AuthError("NOT_FOUND");
    return a;
  };
  const verifyVersion = (actual: number, expected: number) => {
    if (actual !== expected) throw new AuthError("CONFLICT");
  };
  return {
    public: () => repo.publicAwards(pool),
    catalog: (raw: string | undefined, offset = 0) =>
      authorized(raw, undefined, false, (db, actor) =>
        repo.catalog(db, actor, offset),
      ),
    admin: (
      raw: string | undefined,
      competitionId: string | null = null,
      offset = 0,
    ) =>
      authorized(raw, "competitions.manage", false, (db) =>
        repo.admin(db, competitionId, offset),
      ),
    judging: (raw: string | undefined, offset = 0) =>
      authorized(raw, "competitions.score", false, (db, actor) =>
        repo.assignments(db, actor, null, offset),
      ),
    configure: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionConfigure.input.parse(input);
      validateCompetition(d.config);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        await repo.configure(db, d.id, d.expectedVersion, d.config, actor);
        await repo.audit(db, actor, "competition.configured", d.id, requestId);
        return repo.admin(db);
      });
    },
    enroll: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionEnroll.input.parse(input);
      return authorized(raw, undefined, true, async (db, actor) => {
        const c = await repo.catalogCompetition(db, d.competitionId);
        beforeDeadline(c.value.config.registrationClosesAt);
        const r = await eligible(db, d.revisionId, c.value.config);
        if (r.ownerId !== actor) throw new AuthError("NOT_FOUND");
        const result = await repo.enroll(
          db,
          d.competitionId,
          r.submissionId,
          d.revisionId,
          actor,
          r.document.title,
          r.presenter.name,
        );
        if (
          result.value.state === "withdrawn" ||
          result.value.state === "disqualified" ||
          result.value.revisionId !== d.revisionId
        )
          throw new AuthError("CONFLICT");
        if (result.created) {
          await repo.bump(db, d.competitionId, result.value.id);
          await repo.audit(
            db,
            actor,
            "competition.entry_requested",
            result.value.id,
            requestId,
          );
        }
        return repo.catalog(db, actor);
      });
    },
    replaceEntry: (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const d = competitionEndpoints.competitionReplaceEntry.input.parse(input);
      return authorized(raw, undefined, true, async (db, actor) => {
        const manager = permissionsFor(await rolesFor(db, actor)).includes(
          "competitions.manage",
        );
        await repo.context(db, actor, manager);
        const previous = await repo.entry(db, d.predecessorId, true);
        if (!manager && previous.ownerId !== actor)
          throw new AuthError("NOT_FOUND");
        const existing = await repo.successor(db, previous.id);
        if (existing) {
          if (
            existing.revisionId !== d.revisionId ||
            existing.replacementReason !== d.reason
          )
            throw new AuthError("CONFLICT");
          return existing;
        }
        verifyVersion(previous.version, d.expectedVersion);
        const c = await repo.catalogCompetition(db, previous.competitionId);
        beforeDeadline(c.value.config.registrationClosesAt);
        const accepted = await eligible(db, d.revisionId, c.value.config);
        if (
          accepted.submissionId !== previous.submissionId ||
          accepted.ownerId !== previous.ownerId
        )
          throw new AuthError("CONFLICT");
        if (
          !(await repo.authorizedPresenterSuccessor(
            db,
            previous.revisionId,
            d.revisionId,
          ))
        )
          throw new AuthError("CONFLICT");
        const result = await repo.replaceEntry(
          db,
          previous,
          d.revisionId,
          accepted.document.title,
          accepted.presenter.name,
          d.reason,
        );
        await repo.bump(db, previous.competitionId, result.id);
        await repo.audit(
          db,
          actor,
          "competition.entry_replaced",
          result.id,
          requestId,
          d.reason,
        );
        await notify(
          db,
          previous.ownerId,
          `competition-successor:${result.id}`,
          "報告者更換後競賽資格重新申請",
          requestId,
        );
        return result;
      });
    },
    entry: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionEntry.input.parse(input);
      return authorized(
        raw,
        d.action === "withdraw" ? undefined : "competitions.manage",
        true,
        async (db, actor) => {
          const e = await repo.entry(db, d.id, true);
          if (d.action === "withdraw" && e.ownerId !== actor)
            throw new AuthError("NOT_FOUND");
          await repo.assertLatestEntry(db, e.id);
          verifyVersion(e.version, d.expectedVersion);
          if (!["requested", "approved"].includes(e.state))
            throw new AuthError("CONFLICT");
          if (d.action === "approve") {
            if (e.state !== "requested") throw new AuthError("CONFLICT");
            await eligible(
              db,
              e.revisionId,
              (await repo.competition(db, e.competitionId, true)).value.config,
            );
          }
          if (d.action === "reject" && e.state !== "requested")
            throw new AuthError("CONFLICT");
          if (d.action === "disqualify" && e.state !== "approved")
            throw new AuthError("CONFLICT");
          await repo.entryState(
            db,
            e.id,
            d.action === "approve"
              ? "approved"
              : d.action === "reject"
                ? "rejected"
                : d.action === "withdraw"
                  ? "withdrawn"
                  : "disqualified",
            d.reason,
          );
          await repo.bump(db, e.competitionId, e.id);
          await repo.audit(
            db,
            actor,
            `competition.entry_${d.action}`,
            e.id,
            requestId,
            d.reason,
          );
          await notify(
            db,
            e.ownerId,
            `competition-entry:${e.id}:${e.version + 1}`,
            "競賽資格狀態更新",
            requestId,
          );
          return repo.entry(db, e.id);
        },
      );
    },
    assign: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionAssign.input.parse(input);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        const e = await repo.entry(db, d.entryId, true),
          c = await repo.competition(db, e.competitionId, true);
        if (e.state !== "approved") throw new AuthError("CONFLICT");
        const r = await eligible(db, e.revisionId, c.value.config);
        await repo.actorEmail(db, d.judgeId);
        requirePermission(await rolesFor(db, d.judgeId), "competitions.score");
        if (
          r.ownerId === d.judgeId ||
          (await isRevisionAuthorAccount(db, e.revisionId, d.judgeId)) ||
          (await repo.hasConflict(db, e.id, d.judgeId))
        )
          throw new AuthError("FORBIDDEN");
        const result = await repo.assign(
          db,
          e.id,
          e.competitionId,
          d.judgeId,
          c.value.currentRubricId,
        );
        if (result.created) {
          await repo.bump(db, e.competitionId, e.id);
          await repo.audit(
            db,
            actor,
            "competition.judge_assigned",
            result.value.id,
            requestId,
          );
          await notify(
            db,
            d.judgeId,
            `competition-assignment:${result.value.id}`,
            "競賽評審指派",
            requestId,
          );
        }
        return repo.admin(db);
      });
    },
    extendDeadline: (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const d =
        competitionEndpoints.competitionExtendDeadline.input.parse(input);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        const a = await repo.assignment(db, d.assignmentId, true);
        await repo.assertLatestEntry(db, a.entryId);
        const prior = await repo.extensionById(db, d.id);
        if (prior) {
          if (
            prior.assignment_id !== a.id ||
            prior.assignment_version !== d.expectedVersion + 1 ||
            prior.deadline.toISOString() !== d.deadline ||
            prior.reason !== d.reason
          )
            throw new AuthError("CONFLICT");
          return a;
        }
        verifyVersion(a.version, d.expectedVersion);
        if (
          a.state !== "assigned" ||
          a.deadlineHistory.length >= 50 ||
          Date.parse(d.deadline) <= Date.parse(a.effectiveDeadline) ||
          !(await repo.deadlineExtensionAllowed(db, d.deadline))
        )
          throw new AuthError("CONFLICT");
        const e = await repo.entry(db, a.entryId);
        if (e.state !== "approved" || !(await repo.judgingEligible(db, a.id)))
          throw new AuthError("CONFLICT");
        await eligible(db, e.revisionId, a.config);
        await repo.actorEmail(db, a.judgeId);
        requirePermission(await rolesFor(db, a.judgeId), "competitions.score");
        await repo.extendDeadline(db, d, a.effectiveDeadline, actor);
        await repo.bump(db, a.competitionId, a.entryId, a.id);
        await repo.audit(
          db,
          actor,
          "competition.deadline_extended",
          d.id,
          requestId,
          d.reason,
        );
        await notify(
          db,
          a.judgeId,
          `competition-deadline:${d.id}`,
          "競賽評分期限已展延",
          requestId,
        );
        return repo.assignment(db, a.id);
      });
    },
    remind: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionRemind.input.parse(input);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        const a = await repo.assignment(db, d.assignmentId, true);
        if (a.state !== "assigned") throw new AuthError("CONFLICT");
        const e = await repo.entry(db, a.entryId);
        if (e.state !== "approved") throw new AuthError("CONFLICT");
        await eligible(db, e.revisionId, a.config);
        beforeDeadline(a.effectiveDeadline);
        requirePermission(await rolesFor(db, a.judgeId), "competitions.score");
        await notify(
          db,
          a.judgeId,
          `competition-reminder:${a.id}:${d.idempotencyKey}`,
          "競賽待評分提醒",
          requestId,
        );
        await repo.audit(
          db,
          actor,
          "competition.score_reminder",
          a.id,
          requestId,
          d.reason,
        );
        return repo.admin(db);
      });
    },
    cancel: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionCancel.input.parse(input);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        const a = await repo.assignment(db, d.assignmentId, true);
        await repo.assertLatestEntry(db, a.entryId);
        if (a.state !== "cancelled") {
          await repo.cancel(db, a.id);
          await repo.bump(db, a.competitionId, a.entryId, a.id);
          await repo.audit(
            db,
            actor,
            "competition.assignment_cancelled",
            a.id,
            requestId,
            d.reason,
          );
        }
        return repo.admin(db);
      });
    },
    conflict: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionConflict.input.parse(input);
      return authorized(raw, "competitions.score", false, async (db, actor) => {
        const a = await ownAssignment(db, d.assignmentId, actor);
        await repo.assertLatestEntry(db, a.entryId);
        if (a.state === "cancelled") throw new AuthError("CONFLICT");
        if (a.state !== "conflicted") {
          await repo.conflict(db, a.id, a.entryId, actor, d.reason);
          await repo.bump(db, a.competitionId, a.entryId, a.id);
          await repo.audit(
            db,
            actor,
            "competition.conflict_declared",
            a.id,
            requestId,
            d.reason,
          );
        }
        return repo.assignments(db, actor, null, 0);
      });
    },
    score: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionScore.input.parse(input);
      return authorized(raw, "competitions.score", true, async (db, actor) => {
        const a = await ownAssignment(db, d.assignmentId, actor),
          score = scoreDocument(a.config, d.document, d.action === "submit");
        if (
          a.state === "submitted" &&
          d.action === "submit" &&
          JSON.stringify(score.document) === JSON.stringify(a.document)
        )
          return repo.assignments(db, actor, null, 0);
        verifyVersion(a.version, d.expectedVersion);
        if (a.state !== "assigned" || !(await repo.judgingEligible(db, a.id)))
          throw new AuthError("FORBIDDEN");
        beforeDeadline(a.effectiveDeadline);
        await repo.score(
          db,
          a.id,
          score.document,
          score.points,
          score.maximum,
          d.action === "submit",
        );
        if (d.action === "submit")
          await repo.bump(db, a.competitionId, a.entryId, a.id);
        await repo.audit(
          db,
          actor,
          `competition.score_${d.action}`,
          a.id,
          requestId,
        );
        return repo.assignments(db, actor, null, 0);
      });
    },
    awards: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionAwards.input.parse(input);
      return authorized(raw, "competitions.manage", true, async (db, actor) => {
        const c = await repo.competition(db, d.competitionId, true);
        verifyVersion(c.value.version, d.expectedVersion);
        if (new Set(d.awards.map((a) => a.entryId)).size !== d.awards.length)
          throw new AuthError("INVALID_REQUEST");
        for (const award of d.awards) {
          const e = await repo.entry(db, award.entryId);
          if (e.competitionId !== d.competitionId || e.state !== "approved")
            throw new AuthError("CONFLICT");
        }
        await repo.awards(db, d.competitionId, d.awards, d.reason);
        await repo.audit(
          db,
          actor,
          "competition.awards_saved",
          d.competitionId,
          requestId,
          d.reason,
        );
        return repo.admin(db);
      });
    },
    publish: (raw: string | undefined, input: unknown, requestId: string) => {
      const d = competitionEndpoints.competitionPublish.input.parse(input);
      return authorized(
        raw,
        "competitions.manage",
        true,
        async (db, actor, proof) => {
          assertRecentPassword(proof, new Date());
          const c = await repo.competition(db, d.competitionId, true);
          verifyVersion(c.value.version, d.expectedVersion);
          if (
            !c.awards.length ||
            Date.now() < Date.parse(c.value.config.registrationClosesAt)
          )
            throw new AuthError("CONFLICT");
          const entries = await repo.allEntries(db, d.competitionId);
          if (entries.some((e) => e.state === "requested"))
            throw new AuthError("CONFLICT");
          const approved = entries.filter((e) => e.state === "approved"),
            totals = await repo.totals(
              db,
              approved.map((e) => e.id),
            );
          for (const e of approved) {
            await eligible(db, e.revisionId, c.value.config);
            const t = totals.find((t) => t.entryId === e.id)!;
            if (
              t.submitted < c.value.config.minimumJudges ||
              t.missing ||
              t.basisPoints === null
            )
              throw new AuthError("CONFLICT");
          }
          const winners = c.awards.map((award) => {
            const e = approved.find((e) => e.id === award.entryId),
              t = totals.find((t) => t.entryId === award.entryId);
            if (!e || !t || t.basisPoints === null)
              throw new AuthError("CONFLICT");
            if (
              c.value.config.tiePolicy === "shared" &&
              totals.some(
                (other) =>
                  equalTotal(t, other) &&
                  !c.awards.some(
                    (a) => a.entryId === other.entryId && a.rank === award.rank,
                  ),
              )
            )
              throw new AuthError("CONFLICT");
            for (const other of c.awards.filter((a) => a.rank === award.rank)) {
              const ot = totals.find((t) => t.entryId === other.entryId);
              if (!ot || !equalTotal(t, ot)) throw new AuthError("CONFLICT");
            }
            return {
              label: award.label,
              rank: award.rank,
              title: e.title,
              presenterName: e.presenterName,
              basisPoints: t.basisPoints,
            };
          });
          const result = await repo.publish(
            db,
            d.competitionId,
            c.value.version,
            {
              name: c.value.config.name,
              tiePolicy: c.value.config.tiePolicy,
              awards: winners,
            },
            actor,
          );
          if (result.created) {
            await repo.audit(
              db,
              actor,
              "competition.awards_published",
              result.id,
              requestId,
              c.reason,
            );
            for (const ownerId of new Set(approved.map((e) => e.ownerId)))
              await notify(
                db,
                ownerId,
                `competition-awards:${result.id}:${ownerId}`,
                "競賽得獎名單已發布",
                requestId,
              );
          }
          return repo.publicAwards(db);
        },
      );
    },
  };
}
