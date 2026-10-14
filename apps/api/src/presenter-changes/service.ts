import type { Pool, PoolClient } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import {
  presenterChangeCreate,
  presenterChangeRespond,
  presenterChangeCancel,
  presenterChangeDecide,
  type PresenterChange,
} from "@confsys/contracts";
import { lockAccess, rolesFor } from "../access/repository.js";
import { requirePermission } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import * as submissions from "../submissions/repository.js";
import type { SubmissionDependencies } from "../submissions/service.js";
import * as repo from "./repository.js";
export function createPresenterChangesService(
  pool: Pool,
  config: ApiConfig,
  dependencies: SubmissionDependencies,
) {
  const transaction = <T>(
    raw: string | undefined,
    admin: boolean,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // One global ordering fence serializes identity/role changes with both people and domain locks.
      await lockAccess(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (admin)
        requirePermission(await rolesFor(db, actor.id), "submissions.manage");
      await submissions.context(db, actor.id, admin);
      await db.query("SELECT set_config('app.presenter_admin',$1,true)", [
        String(admin),
      ]);
      return work(db, actor.id);
    });
  const notify = async (
    db: PoolClient,
    row: PresenterChange,
    actor: string,
    event: string,
    requestId: string,
  ) => {
    const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
    for (const userId of new Set([row.requesterId, row.targetUserId]))
      await enqueueBusinessNotification(
        db,
        { CONFERENCE_NAME: brand.conferenceName },
        {
          userId,
          eventKey: `presenter-change:${row.id}:${row.version}:${userId}`,
          subject: "報告者變更申請狀態更新",
          text: `請登入研討會系統查看報告者變更申請：${config.PUBLIC_APP_ORIGIN}/presenter-changes`,
          requestId,
        },
      );
    await submissions.audit(
      db,
      actor,
      `presenter_change.${event}`,
      requestId,
      row.id,
      row.version,
    );
    return row;
  };
  const active = (row: PresenterChange, version: number) => {
    if (
      row.version !== version ||
      !["requested", "accepted"].includes(row.state) ||
      Date.parse(row.expiresAt) <= Date.now()
    )
      throw new AuthError("CONFLICT");
  };
  return {
    list: (
      raw: string | undefined,
      scope: "own" | "incoming" | "admin",
      offset: number,
    ) =>
      transaction(raw, scope === "admin", (db, actor) =>
        repo.list(db, actor, scope, offset),
      ),
    create(raw: string | undefined, input: unknown, requestId: string) {
      const data = presenterChangeCreate.parse(input);
      return transaction(raw, false, async (db, actor) => {
        const settings = await submissions.configuration(db, "share"),
          submission = await submissions.one(db, data.submissionId, true);
        if (!submission || submission.ownerId !== actor)
          throw new AuthError("NOT_FOUND");
        if (
          submission.state !== "submitted" ||
          submission.currentRevisionId !== data.sourceRevisionId ||
          submission.version !== data.expectedSubmissionVersion
        )
          throw new AuthError("CONFLICT");
        const document = await repo.source(db, data.sourceRevisionId),
          previous = document.authors[document.presenterIndex],
          target = document.authors[data.targetAuthorIndex];
        if (
          !isDeepStrictEqual(document, submission.document) ||
          !previous ||
          !target ||
          previous.email.trim().toLowerCase() ===
            target.email.trim().toLowerCase()
        )
          throw new AuthError("INVALID_REQUEST");
        const email = target.email.trim().toLowerCase(),
          user = await repo.target(db, email);
        if (settings.presenterMustBeSubmitter && user.id !== actor)
          throw new AuthError("INVALID_REQUEST");
        const existing = (
          await db.query(
            "SELECT id FROM confsys.presenter_change_requests WHERE id=$1",
            [data.id],
          )
        ).rows[0];
        if (existing) {
          const row = await repo.one(db, data.id);
          if (
            row.submissionId !== data.submissionId ||
            row.sourceRevisionId !== data.sourceRevisionId ||
            row.targetAuthorIndex !== data.targetAuthorIndex ||
            row.reason !== data.reason
          )
            throw new AuthError("CONFLICT");
          return row;
        }
        await db.query(
          "UPDATE confsys.presenter_change_requests SET state='expired',version=version+1 WHERE submission_id=$1 AND state IN('requested','accepted') AND expires_at<=clock_timestamp()",
          [submission.id],
        );
        if (
          (
            await db.query(
              "SELECT 1 FROM confsys.presenter_change_requests WHERE submission_id=$1 AND state IN('requested','accepted')",
              [submission.id],
            )
          ).rowCount
        )
          throw new AuthError("CONFLICT");
        await db.query(
          `INSERT INTO confsys.presenter_change_requests(id,submission_id,source_revision_id,expected_submission_version,config_version,requester_id,target_user_id,target_author_index,target_email,projection,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()+interval '7 days')`,
          [
            data.id,
            submission.id,
            data.sourceRevisionId,
            submission.version,
            settings.version,
            actor,
            user.id,
            data.targetAuthorIndex,
            email,
            {
              number: submission.number,
              title: document.title,
              previousName: previous.name,
              previousEmail: previous.email,
              targetName: target.name,
              targetEmail: email,
            },
            data.reason,
          ],
        );
        return notify(
          db,
          await repo.one(db, data.id),
          actor,
          "requested",
          requestId,
        );
      });
    },
    respond(raw: string | undefined, input: unknown, requestId: string) {
      const data = presenterChangeRespond.parse(input);
      return transaction(raw, false, async (db, actor) => {
        const row = await repo.one(db, data.id);
        if (row.targetUserId !== actor) throw new AuthError("NOT_FOUND");
        const state = data.action === "accept" ? "accepted" : "declined";
        if (
          row.state === state &&
          row.version === data.expectedVersion + 1 &&
          row.responseReason === data.reason
        )
          return row;
        active(row, data.expectedVersion);
        if (row.state !== "requested") throw new AuthError("CONFLICT");
        const user = await repo.target(db, row.projection.targetEmail);
        if (user.id !== actor) throw new AuthError("CONFLICT");
        await db.query(
          "UPDATE confsys.presenter_change_requests SET state=$2,version=version+1,consent_credential_version=$3,consented_at=clock_timestamp(),response_reason=$4 WHERE id=$1",
          [row.id, state, user.credential_version, data.reason],
        );
        return notify(db, await repo.one(db, row.id), actor, state, requestId);
      });
    },
    cancel(raw: string | undefined, input: unknown, requestId: string) {
      const data = presenterChangeCancel.parse(input);
      return transaction(raw, false, async (db, actor) => {
        const row = await repo.one(db, data.id);
        if (row.requesterId !== actor) throw new AuthError("NOT_FOUND");
        if (
          row.state === "cancelled" &&
          row.version === data.expectedVersion + 1 &&
          row.decisionReason === data.reason
        )
          return row;
        active(row, data.expectedVersion);
        await db.query(
          "UPDATE confsys.presenter_change_requests SET state='cancelled',version=version+1,decision_actor=$2,decision_reason=$3,decided_at=clock_timestamp() WHERE id=$1",
          [row.id, actor, data.reason],
        );
        return notify(
          db,
          await repo.one(db, row.id),
          actor,
          "cancelled",
          requestId,
        );
      });
    },
    decide(raw: string | undefined, input: unknown, requestId: string) {
      const data = presenterChangeDecide.parse(input);
      return transaction(raw, true, async (db, actor) => {
        // Exclusive access fence serializes domain writes; FOR UPDATE would apply owner-only UPDATE RLS to admin reads.
        const settings = await submissions.configuration(db, "share"),
          initial = await repo.one(db, data.id),
          submission = await submissions.one(db, initial.submissionId),
          row = await repo.one(db, data.id);
        const state = data.action === "approve" ? "approved" : "rejected";
        if (
          row.state === state &&
          row.version === data.expectedVersion + 1 &&
          row.decisionReason === data.reason
        )
          return row;
        active(row, data.expectedVersion);
        let revisionId: string | null = null;
        if (data.action === "approve") {
          if (
            row.state !== "accepted" ||
            !submission ||
            submission.state !== "submitted" ||
            submission.currentRevisionId !== row.sourceRevisionId ||
            submission.version !== row.expectedSubmissionVersion ||
            settings.version !== row.configVersion
          )
            throw new AuthError("CONFLICT");
          const document = await repo.source(db, row.sourceRevisionId),
            user = await repo.target(db, row.projection.targetEmail);
          if (
            user.id !== row.targetUserId ||
            user.credential_version !==
              (await repo.consentVersion(db, row.id)) ||
            !isDeepStrictEqual(document, submission.document) ||
            (settings.presenterMustBeSubmitter && user.id !== row.requesterId)
          )
            throw new AuthError("CONFLICT");
          const replacement = {
            ...document,
            presenterIndex: row.targetAuthorIndex,
          };
          // Clone trusted immutable attachments; file access remains owner-scoped, with fresh references only.
          await db.query("SELECT set_config('app.actor_id',$1,true)", [
            row.requesterId,
          ]);
          try {
            await submissions.save(db, submission.id, replacement);
            revisionId = await submissions.submit(
              db,
              submission.id,
              row.requesterId,
              submission.version + 1,
              replacement,
              settings,
            );
            await dependencies.referenceFiles(db, replacement, revisionId);
          } finally {
            await db.query("SELECT set_config('app.actor_id',$1,true)", [
              actor,
            ]);
          }
        }
        await db.query(
          "UPDATE confsys.presenter_change_requests SET state=$2,version=version+1,new_revision_id=$3,decision_actor=$4,decision_reason=$5,decided_at=clock_timestamp() WHERE id=$1",
          [row.id, state, revisionId, actor, data.reason],
        );
        return notify(db, await repo.one(db, row.id), actor, state, requestId);
      });
    },
  };
}
