import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { reportingEndpoints } from "@confsys/contracts";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
  accountById,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import * as repo from "./repository.js";
export function createReportingService(pool: Pool, config: ApiConfig) {
  async function transaction<T>(
    raw: string | undefined,
    permission: string | null,
    fresh: boolean,
    work: (db: PoolClient, actor: { id: string }) => Promise<T>,
  ) {
    return withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      if (permission)
        requirePermission(await rolesFor(db, actor.id), permission);
      if (fresh) assertRecentPassword(actor.passwordVerifiedAt, new Date());
      await repo.context(db, actor.id, permission !== null);
      return work(db, actor);
    });
  }
  async function audit(
    db: PoolClient,
    actorId: string,
    action: string,
    requestId: string,
    details: object,
    targetId = actorId,
    reason = "Explicit administrative data access",
  ) {
    await recordAccess(db, {
      actorId,
      targetId,
      action,
      requestId,
      source: "session",
      reason,
      before: "null",
      after: JSON.stringify(details),
    });
  }
  return {
    list: (raw: string | undefined, input: unknown) =>
      transaction(raw, null, false, (db) =>
        repo.notifications(
          db,
          reportingEndpoints.notificationList.input.parse(input).offset,
        ),
      ),
    read: (raw: string | undefined, input: unknown) =>
      transaction(raw, null, false, async (db, actor) => {
        const { id } = reportingEndpoints.notificationRead.input.parse(input);
        if (!(await repo.markRead(db, actor.id, id)))
          throw new AuthError("NOT_FOUND");
        return { read: true as const };
      }),
    stats: (raw: string | undefined) =>
      transaction(raw, "reporting.read", false, (db) => repo.stats(db)),
    export: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, "reporting.export", true, async (db, actor) => {
        const { kind, offset } =
            reportingEndpoints.reportingExport.input.parse(input),
          result = await repo.exportRows(db, kind, offset);
        await audit(db, actor.id, "reporting.export", requestId, {
          kind,
          offset,
          rows: result.rows,
        });
        return result;
      }),
    preview: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, "authors.preview", true, async (db, actor) => {
        const { userId, reason } =
            reportingEndpoints.authorPreview.input.parse(input),
          user = await accountById(db, userId);
        if (!user) throw new AuthError("NOT_FOUND");
        const result = await repo.preview(db, userId, user.email);
        await audit(
          db,
          actor.id,
          "authors.preview",
          requestId,
          { readOnly: true },
          userId,
          reason,
        );
        return result;
      }),
  };
}
