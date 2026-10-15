import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { notificationBatchEndpoints } from "@confsys/contracts";
import {
  notificationBatchPermission,
  enqueueBusinessNotification,
} from "@confsys/notifications";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
} from "../access/repository.js";
import {
  requirePermission,
  assertRecentPassword,
  permissionsFor,
} from "../access/policy.js";
import { effectivePublicSite } from "../site/branding.js";
import * as repo from "./repository.js";
import { eligible as unpaidRecipients } from "../finance-reminders/repository.js";
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
      await db.query("SELECT set_config('app.finance_admin',$1,true)", [
        String(
          permissionsFor(await rolesFor(db, actor.id)).includes(
            "finance.reconcile",
          ),
        ),
      ]);
      return work(db, actor.id);
    });
  }
  async function requireBatch(db: PoolClient, actorId: string, id: string) {
    const batch = await repo.detail(db, id);
    if (!batch) throw new AuthError("NOT_FOUND");
    requirePermission(
      await rolesFor(db, actorId),
      notificationBatchPermission(batch.kind),
    );
    return batch;
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
    preview: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) => {
        const { offset, ...filters } =
          notificationBatchEndpoints.notificationAudiencePreview.input.parse(
            input,
          );
        return repo.audience(db, filters, offset);
      }),
    templates: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) =>
        repo.templates(
          db,
          notificationBatchEndpoints.notificationTemplateList.input.parse(input)
            .offset,
        ),
      ),
    saveTemplate: (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) =>
      transaction(raw, true, async (db, actorId) => {
        const data =
          notificationBatchEndpoints.notificationTemplateSave.input.parse(
            input,
          );
        const latest = await repo.latestTemplateVersion(db, data.key);
        const old = await repo.templateById(db, data.id);
        if (old) {
          if (
            old.key !== data.key ||
            old.version !== data.expectedVersion + 1 ||
            old.name !== data.name ||
            old.subject !== data.subject ||
            old.text !== data.text
          )
            throw new AuthError("CONFLICT");
          return old;
        }
        if (latest !== data.expectedVersion) throw new AuthError("CONFLICT");
        const saved = await repo.saveTemplate(db, actorId, data);
        if (!saved) throw new Error("Missing saved notification template");
        await recordAccess(db, {
          actorId,
          targetId: actorId,
          action: "notification_template.version_created",
          requestId,
          source: "session",
          reason: "Explicit immutable notification template version",
          before: "null",
          after: JSON.stringify({
            templateVersionId: saved.id,
            key: saved.key,
            version: saved.version,
          }),
        });
        return saved;
      }),
    deliveries: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, async (db, actorId) => {
        const data =
          notificationBatchEndpoints.notificationBatchDeliveries.input.parse(
            input,
          );
        await requireBatch(db, actorId, data.id);
        return repo.deliveries(db, data.id, data.offset);
      }),
    list: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, async (db, actorId) =>
        repo.list(
          db,
          notificationBatchEndpoints.notificationBatchList.input.parse(input)
            .offset,
          permissionsFor(await rolesFor(db, actorId)).includes(
            "finance.reconcile",
          ),
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
              ...(data.audience || data.templateVersionId || data.scheduledAt
                ? {
                    audience: data.audience,
                    templateVersionId: data.templateVersionId,
                    scheduledAt: data.scheduledAt,
                  }
                : {}),
            }),
          )
          .digest("hex");
        await repo.lockKey(db, data.idempotencyKey);
        const old = await repo.prior(db, data.idempotencyKey);
        if (old) {
          if (old.request_hash !== hash) throw new AuthError("CONFLICT");
          return (await repo.detail(db, old.id))!;
        }
        if (data.scheduledAt) {
          const now = (await repo.databaseTime(db)).getTime();
          const scheduled = Date.parse(data.scheduledAt);
          if (scheduled < now || scheduled > now + 30 * 86400000)
            throw new AuthError("INVALID_REQUEST");
        }
        if (data.templateVersionId) {
          const template = await repo.templateById(db, data.templateVersionId);
          if (
            !template ||
            template.subject !== data.subject ||
            template.text !== data.text
          )
            throw new AuthError("CONFLICT");
        }
        if (
          data.audience &&
          !(await repo.matchesAudience(db, data.audience, data.recipientIds))
        )
          throw new AuthError("CONFLICT");
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
              ...(data.scheduledAt ? { notBefore: data.scheduledAt } : {}),
            },
          );
        await audit(db, actorId, "notification_batch.create", id, requestId);
        return (await repo.detail(db, id))!;
      }),
    retry: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actorId) => {
        const data =
          notificationBatchEndpoints.notificationBatchRetry.input.parse(input);
        const hash = createHash("sha256")
          .update(JSON.stringify({ retryOf: data.id, reason: data.reason }))
          .digest("hex");
        await repo.lockKey(db, data.idempotencyKey);
        const source = await repo.retrySource(db, data.id);
        if (!source) throw new AuthError("NOT_FOUND");
        requirePermission(
          await rolesFor(db, actorId),
          notificationBatchPermission(source.row.kind),
        );
        if (
          !source.row.issuer_active ||
          !permissionsFor(await rolesFor(db, source.row.created_by)).includes(
            notificationBatchPermission(source.row.kind),
          )
        )
          throw new AuthError("CONFLICT");
        if (source.row.cancelled_at || !source.row.in_window)
          throw new AuthError("CONFLICT");
        if (source.child) {
          if (
            source.child.idempotency_key !== data.idempotencyKey ||
            source.child.request_hash !== hash
          )
            throw new AuthError("CONFLICT");
          return (await repo.detail(db, source.child.id))!;
        }
        if (await repo.prior(db, data.idempotencyKey))
          throw new AuthError("CONFLICT");
        if (
          source.deliveries.some(
            (n) => n.status === "pending" || n.status === "processing",
          )
        )
          throw new AuthError("CONFLICT");
        let recipients = source.deliveries
          .filter(
            (n) =>
              n.status === "failed" &&
              n.result_code === "CONNECT_FAILED" &&
              n.recipient_eligible,
          )
          .map((n) => n.user_id);
        if (source.row.kind === "payment_reminder") {
          await db.query(
            "SELECT singleton FROM confsys.registration_state FOR SHARE",
          );
          recipients = await unpaidRecipients(db, recipients);
        }
        if (!recipients.length) throw new AuthError("CONFLICT");
        const id = await repo.create(
          db,
          actorId,
          {
            idempotencyKey: data.idempotencyKey,
            recipientIds: recipients,
            kind: source.row.kind,
            subject: source.row.subject,
            text: source.row.message_text,
            audience: source.row.audience,
            templateVersionId: source.row.template_version_id,
          },
          hash,
          data.id,
        );
        const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        for (const userId of recipients)
          await enqueueBusinessNotification(
            db,
            { CONFERENCE_NAME: brand.conferenceName },
            {
              userId,
              eventKey: `batch:${id}:${userId}`,
              subject: source.row.subject,
              text: source.row.message_text,
              requestId,
              batchId: id,
            },
          );
        await recordAccess(db, {
          actorId,
          targetId: actorId,
          action: "notification_batch.retry",
          requestId,
          source: "session",
          reason: data.reason,
          before: JSON.stringify({ batchId: data.id }),
          after: JSON.stringify({
            batchId: id,
            recipientCount: recipients.length,
          }),
        });
        return (await repo.detail(db, id))!;
      }),
    cancel: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actorId) => {
        const { id } =
          notificationBatchEndpoints.notificationBatchCancel.input.parse(input);
        await requireBatch(db, actorId, id);
        const result = await repo.cancel(db, id);
        if (!result) throw new AuthError("NOT_FOUND");
        await audit(db, actorId, "notification_batch.cancel", id, requestId);
        return result;
      }),
  };
}
