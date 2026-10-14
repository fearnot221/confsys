import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { effectivePublicSite } from "../site/branding.js";
import {
  submissionSaveInput,
  submissionTransitionInput,
  submissionConfigInput,
  type SubmissionDocument,
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
    work: (db: PoolClient, actorId: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // Fence authorization changes, then lock the actor before domain rows. No external I/O under locks.
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (permission)
        requirePermission(await rolesFor(db, actor.id), permission);
      await repo.context(db, actor.id, !!permission);
      return work(db, actor.id);
    });
  const required = async (db: PoolClient, id: string, lock = false) => {
    const row = await repo.one(db, id, lock);
    if (!row) throw new AuthError("NOT_FOUND");
    return row;
  };
  return {
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
        async (db) => ({
          submission: await required(db, id),
          ...(await repo.revisions(db, id, revisionOffset)),
        }),
      ),
    save: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = submissionSaveInput.parse(input);
      return authenticated(raw, undefined, async (db, actor) => {
        const settings = await repo.configuration(db, "share");
        assertSubmissionWindow(settings, new Date());
        assertSubmissionDocument(data.document, settings, false);
        const before = await repo.one(db, data.id, true);
        if (!before) {
          if (data.expectedVersion !== 0) throw new AuthError("NOT_FOUND");
          await dependencies.assertFiles(db, actor, data.document);
          await repo.create(db, data.id, actor, data.document);
        } else {
          assertSubmissionVersion(before, data.expectedVersion);
          if (before.state === "withdrawn") throw new AuthError("CONFLICT");
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
      return authenticated(raw, undefined, async (db, actor) => {
        const settings = await repo.configuration(db, "share"),
          before = await required(db, data.id, true);
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
          assertSubmissionWindow(settings, new Date());
          assertSubmissionDocument(before.document, settings, true);
          if (
            settings.requireRegistration &&
            !(await dependencies.isRegistered(db, actor))
          )
            throw new AuthError("CONFLICT");
          await dependencies.assertFiles(db, actor, before.document);
          const revisionId = await repo.submit(
            db,
            data.id,
            actor,
            before.version,
            before.document,
            settings,
          );
          await dependencies.referenceFiles(db, before.document, revisionId);
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
