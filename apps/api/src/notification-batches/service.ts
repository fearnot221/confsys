import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { notificationBatchEndpoints } from "@confsys/contracts";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import { effectivePublicSite } from "../site/branding.js";
import * as repo from "./repository.js";
export function createNotificationBatchService(pool: Pool, config: ApiConfig) {
  async function transaction<T>(
    raw: string | undefined,
    write: boolean,
    work: (db: PoolClient, actorId: string) => Promise<T>,
  ) {
    return withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(await rolesFor(db, actor.id), "notifications.manage");
      if (write) assertRecentPassword(actor.passwordVerifiedAt, new Date());
      await repo.context(db, actor.id);
      return work(db, actor.id);
    });
  }
  async function audit(
    db: PoolClient,
    actorId: string,
    event: string,
    id: string,
    requestId: string,
  ) {
    await recordAccess(db, {
      actorId,
      targetId: actorId,
      action: event,
      requestId,
      source: "session",
      reason: "Explicit bounded notification batch action",
      before: "null",
      after: JSON.stringify({ batchId: id }),
    });
  }
  return {
    list: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) =>
        repo.list(
          db,
          notificationBatchEndpoints.notificationBatchList.input.parse(input)
            .offset,
        ),
      ),
    create: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actorId) => {
        const parsed =
            notificationBatchEndpoints.notificationBatchCreate.input.parse(
              input,
            ),
          data = { ...parsed, recipientIds: [...parsed.recipientIds].sort() };
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              subject: data.subject,
              text: data.text,
              recipientIds: data.recipientIds,
            }),
          )
          .digest("hex");
        await repo.lockKey(db, data.idempotencyKey);
        const old = await repo.prior(db, data.idempotencyKey);
        if (old) {
          if (old.request_hash !== hash) throw new AuthError("CONFLICT");
          return (await repo.detail(db, old.id))!;
        }
        if (!(await repo.eligibleRecipients(db, data.recipientIds)))
          throw new AuthError("CONFLICT");
        const id = await repo.create(db, actorId, data, hash),
          brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        for (const userId of data.recipientIds)
          await enqueueBusinessNotification(
            db,
            { CONFERENCE_NAME: brand.conferenceName },
            {
              userId,
              eventKey: `batch:${id}:${userId}`,
              subject: data.subject,
              text: data.text,
              requestId,
              batchId: id,
            },
          );
        await audit(db, actorId, "notification_batch.create", id, requestId);
        return (await repo.detail(db, id))!;
      }),
    cancel: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actorId) => {
        const { id } =
            notificationBatchEndpoints.notificationBatchCancel.input.parse(
              input,
            ),
          result = await repo.cancel(db, id);
        if (!result) throw new AuthError("NOT_FOUND");
        await audit(db, actorId, "notification_batch.cancel", id, requestId);
        return result;
      }),
  };
}
