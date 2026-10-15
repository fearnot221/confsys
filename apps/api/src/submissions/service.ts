import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { effectivePublicSite } from "../site/branding.js";
import {
  submissionEndpoints,
  submissionSaveInput,
  submissionTransitionInput,
  submissionConfigInput,
  type SubmissionDocument,
  type Submission,
} from "@confsys/contracts";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { requirePermission } from "../access/policy.js";
import * as repo from "./repository.js";
import {
  assertSubmissionConfig,
  assertSubmissionDocument,
  assertSubmissionVersion,
  assertSubmissionWindow,
} from "./policy.js";
export type SubmissionDependencies = {
  isRegistered: (db: PoolClient, actorId: string) => Promise<boolean>;
  assertFiles: (
    db: PoolClient,
    actorId: string,
    document: SubmissionDocument,
    requireFullPaper?: boolean,
  ) => Promise<void>;
  activeRevisionRequest: (
    db: PoolClient,
    submission: Submission,
  ) => Promise<string | null>;
  fulfillRevisionRequest: (
    db: PoolClient,
    requestId: string,
    revisionId: string,
  ) => Promise<void>;
  referenceFiles: (
    db: PoolClient,
    document: SubmissionDocument,
    revisionId: string,
  ) => Promise<void>;
};
export function createSubmissionService(
  pool: Pool,
  config: ApiConfig,
  dependencies: SubmissionDependencies,
) {
  const authenticated = <T>(
    raw: string | undefined,
    permission: string | undefined,
    work: (db: PoolClient, actorId: string, actorEmail: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // Fence authorization changes, then lock the actor before domain rows. No external I/O under locks.
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (permission)
        requirePermission(await rolesFor(db, actor.id), permission);
      await repo.context(db, actor.id, !!permission);
      return work(db, actor.id, actor.email);
    });
  const required = async (
    db: PoolClient,
    id: string,
    lock = false,
    ownerId?: string,
  ) => {
    const row = await repo.one(db, id, lock);
    if (!row || (ownerId && row.ownerId !== ownerId))
      throw new AuthError("NOT_FOUND");
    return row;
  };
  return {
    registrationReminder: (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const data =
        submissionEndpoints.submissionRegistrationReminder.input.parse(input);
      return authenticated(raw, "submissions.manage", async (db, actor) => {
        const submission = await required(db, data.id);
        if (submission.state !== "submitted" || !submission.currentRevisionId)
          throw new AuthError("CONFLICT");
        const requirement = await repo.registrationRequirement(
          db,
          submission.currentRevisionId,
        );
        if (!requirement || !["pending", "overdue"].includes(requirement.state))
          throw new AuthError("CONFLICT");
        const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        await enqueueBusinessNotification(
          db,
          { CONFERENCE_NAME: brand.conferenceName },
          {
            userId: submission.ownerId,
            eventKey: `submission-registration-reminder:${submission.currentRevisionId}:${data.idempotencyKey}`,
            subject: "錄取後報名提醒",
            text: `請登入研討會系統查看您的報名待辦與期限：${config.PUBLIC_APP_ORIGIN}/submissions`,
            requestId,
          },
        );
        await repo.audit(
          db,
          actor,
          "submission.registration_reminder",
          requestId,
          submission.id,
          submission.version,
        );
        return { queued: true as const };
      });
    },
    config: (raw: string | undefined) =>
      authenticated(raw, undefined, (db) => repo.configuration(db)),
    configure: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = submissionConfigInput.parse(input);
      assertSubmissionConfig(data);
      return authenticated(raw, "submissions.manage", async (db, actor) => {
        await repo.configuration(db, true);
        const saved = await repo.configure(db, data);
        await repo.audit(
          db,
          actor,
          "submissions.configured",
          requestId,
          "config",
          saved.version,
        );
        return saved;
      });
    },
    list: (raw: string | undefined, scope: "own" | "admin", offset: number) =>
      authenticated(
        raw,
        scope === "admin" ? "submissions.read_all" : undefined,
        (db, actor) => repo.list(db, actor, scope === "admin", offset),
      ),
    detail: (
      raw: string | undefined,
      id: string,
      scope: "own" | "admin",
      revisionOffset = 0,
    ) =>
      authenticated(
        raw,
        scope === "admin" ? "submissions.read_all" : undefined,
        async (db, actor) => {
          const submission = await required(
            db,
            id,
            false,
            scope === "own" ? actor : undefined,
          );
          return {
            submission,
            registrationRequirement: submission.currentRevisionId
              ? await repo.registrationRequirement(
                  db,
                  submission.currentRevisionId,
                )
              : null,
            ...(await repo.revisions(db, id, revisionOffset)),
          };
        },
      ),
    save: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = submissionSaveInput.parse(input);
      return authenticated(raw, undefined, async (db, actor) => {
        const settings = await repo.configuration(db, "share");
        assertSubmissionDocument(data.document, settings, false);
        const before = await repo.one(db, data.id, true);
        if (before && before.ownerId !== actor)
          throw new AuthError("NOT_FOUND");
        const request = before
          ? await dependencies.activeRevisionRequest(db, before)
          : null;
        if (!request) assertSubmissionWindow(settings, new Date());
        if (!before) {
          if (data.expectedVersion !== 0) throw new AuthError("NOT_FOUND");
          await dependencies.assertFiles(db, actor, data.document);
          await repo.create(db, data.id, actor, data.document);
        } else {
          assertSubmissionVersion(before, data.expectedVersion);
          if (before.state === "withdrawn") throw new AuthError("CONFLICT");
          await repo.assertPresenterUnchanged(
            db,
            before.currentRevisionId,
            data.document,
          );
          await dependencies.assertFiles(db, actor, data.document);
          await repo.save(db, data.id, data.document);
        }
        const saved = await required(db, data.id);
        await repo.audit(
          db,
          actor,
          "submission.draft_saved",
          requestId,
          data.id,
          saved.version,
        );
        return saved;
      });
    },
    transition: (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const data = submissionTransitionInput.parse(input);
      return authenticated(raw, undefined, async (db, actor, actorEmail) => {
        const settings = await repo.configuration(db, "share"),
          before = await required(db, data.id, true, actor);
        assertSubmissionVersion(before, data.expectedVersion);
        if (data.action === "withdraw") {
          if (before.state === "withdrawn") return before;
          await repo.withdraw(db, data.id);
        } else {
          if (before.state === "withdrawn") throw new AuthError("CONFLICT");
          if (
            before.state === "submitted" &&
            before.submittedVersion === before.version
          )
            return before;
          const request = await dependencies.activeRevisionRequest(db, before);
          if (!request) assertSubmissionWindow(settings, new Date());
          assertSubmissionDocument(before.document, settings, true);
          await repo.assertPresenterUnchanged(
            db,
            before.currentRevisionId,
            before.document,
          );
          if (
            settings.requireRegistration &&
            !(await dependencies.isRegistered(db, actor))
          )
            throw new AuthError("CONFLICT");
          if (
            settings.presenterMustBeSubmitter &&
            before.document.authors[before.document.presenterIndex]?.email
              .trim()
              .toLowerCase() !== actorEmail
          )
            throw new AuthError("INVALID_REQUEST");
          await dependencies.assertFiles(
            db,
            actor,
            before.document,
            settings.mode === "full_paper",
          );
          const revisionId = await repo.submit(
            db,
            data.id,
            actor,
            before.version,
            before.document,
            settings,
          );
          await dependencies.referenceFiles(db, before.document, revisionId);
          if (request)
            await dependencies.fulfillRevisionRequest(db, request, revisionId);
        }
        const result = await required(db, data.id);
        const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        await enqueueBusinessNotification(
          db,
          { CONFERENCE_NAME: brand.conferenceName },
          {
            userId: actor,
            eventKey: `submission:${data.id}:${data.action}:${result.version}`,
            subject: data.action === "submit" ? "投稿已提交" : "投稿已撤回",
            text: `您的投稿狀態已更新。請登入作者工作台查看：${config.PUBLIC_APP_ORIGIN}/submissions`,
            requestId,
          },
        );
        await repo.audit(
          db,
          actor,
          `submission.${data.action}`,
          requestId,
          data.id,
          result.version,
        );
        return result;
      });
    },
  };
}
