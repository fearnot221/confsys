import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { financeReminderEndpoints } from "@confsys/contracts";
import { enqueueBusinessNotification } from "@confsys/notifications";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import * as batches from "../notification-batches/repository.js";
import * as repo from "./repository.js";
export function createFinanceReminderService(pool: Pool, config: ApiConfig) {
  const transaction = <T>(
    raw: string | undefined,
    write: boolean,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(await rolesFor(db, actor.id), "finance.reconcile");
      if (write) assertRecentPassword(actor.passwordVerifiedAt, new Date());
      await repo.context(db, actor.id);
      return work(db, actor.id);
    });
  const audit = (
    db: PoolClient,
    actor: string,
    id: string,
    action: string,
    reason: string,
    requestId: string,
  ) =>
    recordAccess(db, {
      actorId: actor,
      targetId: actor,
      action,
      reason,
      requestId,
      source: "session",
      before: "",
      after: id,
    });
  return {
    preview: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) =>
        repo.audience(
          db,
          financeReminderEndpoints.financeReminderPreview.input.parse(input)
            .offset,
        ),
      ),
    list: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) =>
        batches.list(
          db,
          financeReminderEndpoints.financeReminderList.input.parse(input)
            .offset,
        ),
      ),
    create: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actor) => {
        const parsed =
            financeReminderEndpoints.financeReminderCreate.input.parse(input),
          data = { ...parsed, recipientIds: [...parsed.recipientIds].sort() };
        const hash = createHash("sha256")
          .update(JSON.stringify({ kind: "payment_reminder", ...data }))
          .digest("hex");
        await batches.lockKey(db, data.idempotencyKey);
        const prior = await batches.prior(db, data.idempotencyKey);
        if (prior) {
          if (prior.request_hash !== hash) throw new AuthError("CONFLICT");
          return (await batches.detail(db, prior.id))!;
        }
        await db.query(
          "SELECT singleton FROM confsys.registration_state FOR SHARE",
        );
        if (
          (await repo.eligible(db, data.recipientIds)).length !==
          data.recipientIds.length
        )
          throw new AuthError("CONFLICT");
        const subject = "付款狀態提醒 / Payment status reminder",
          text = `本研討會仍有未繳足的訂單。請登入查看目前金額與人工核帳狀態；若已匯款，請依頁面提交付款參考資訊。\n${config.PUBLIC_APP_ORIGIN}/finance`;
        const id = await batches.create(
            db,
            actor,
            { ...data, kind: "payment_reminder", subject, text },
            hash,
          ),
          brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        for (const userId of data.recipientIds)
          await enqueueBusinessNotification(
            db,
            { CONFERENCE_NAME: brand.conferenceName },
            {
              userId,
              eventKey: `batch:${id}:${userId}`,
              subject,
              text,
              requestId,
              batchId: id,
            },
          );
        await audit(
          db,
          actor,
          id,
          "finance.reminder_created",
          data.reason,
          requestId,
        );
        return (await batches.detail(db, id))!;
      }),
    cancel: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actor) => {
        const data =
            financeReminderEndpoints.financeReminderCancel.input.parse(input),
          old = await batches.detail(db, data.id);
        if (!old || old.kind !== "payment_reminder")
          throw new AuthError("NOT_FOUND");
        const result = await batches.cancel(db, data.id);
        await audit(
          db,
          actor,
          data.id,
          "finance.reminder_cancelled",
          data.reason,
          requestId,
        );
        return result!;
      }),
  };
}
