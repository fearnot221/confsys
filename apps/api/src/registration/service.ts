import { enqueueBusinessNotification } from "@confsys/notifications";
import { effectivePublicSite } from "../site/branding.js";
import type { Pool } from "pg";
import type { ApiConfig } from "@confsys/config";
import { createHash } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import {
  registrationConfigInput,
  registrationInput,
  registrationCancel,
  registrationEdit,
  registrationPromote,
  type Permission,
} from "@confsys/contracts";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
} from "../access/repository.js";
import {
  permissionsFor,
  requirePermission,
  assertRecentPassword,
} from "../access/policy.js";
import * as repo from "./repository.js";
import {
  validateRegistrationConfig,
  validateAnswers,
  registrationPrice,
} from "./rules.js";
export function createRegistrationService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    permission: Permission | null,
    work: (db: import("pg").PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // Existing access fence preserves revocation lock order; all work here is bounded DB work.
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      const roles = await rolesFor(db, actor.id);
      if (permission) {
        requirePermission(roles, permission);
        if (permission === "registration.configure")
          assertRecentPassword(actor.passwordVerifiedAt, new Date());
      }
      await repo.context(
        db,
        actor.id,
        permissionsFor(roles).includes("registration.manage"),
      );
      return work(db, actor.id);
    });
  const audit = (
    db: import("pg").PoolClient,
    actor: string,
    event: string,
    id: string,
    requestId: string,
    reason = "Participant registration action",
  ) =>
    recordAccess(db, {
      action: event,
      targetId: actor,
      actorId: actor,
      source: "session",
      reason,
      before: "",
      after: id,
      requestId,
    });
  return {
    history: (raw: string | undefined, id: string, offset = 0) =>
      authorized(raw, null, (db) => repo.history(db, id, offset)),
    edit: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = registrationEdit.parse(input);
      return authorized(raw, null, async (db, actor) => {
        await repo.lockConfiguration(db);
        const before = await repo.detail(db, data.id),
          bound = await repo.boundConfiguration(db, data.id);
        if (
          before.version !== data.expectedVersion ||
          before.state === "cancelled"
        )
          throw new AuthError("CONFLICT");
        const admin = permissionsFor(await rolesFor(db, actor)).includes(
          "registration.manage",
        );
        if (!admin && Date.now() >= Date.parse(bound.document.closesAt))
          throw new AuthError("CONFLICT");
        validateAnswers(bound.document, data.answers);
        const after = await repo.edit(db, data.id, data);
        await repo.recordChange(db, actor, before, after, data.reason);
        await audit(
          db,
          actor,
          "registration.edited",
          data.id,
          requestId,
          data.reason,
        );
        return after;
      });
    },
    promote: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = registrationPromote.parse(input);
      return authorized(raw, "registration.manage", async (db, actor) => {
        await repo.lockConfiguration(db);
        const before = await repo.detail(db, data.id),
          bound = await repo.boundConfiguration(db, data.id);
        if (
          before.state !== "waitlisted" ||
          before.version !== data.expectedVersion
        )
          throw new AuthError("CONFLICT");
        const configNow = await repo.configuration(db),
          ticket = configNow.document?.tickets.find(
            (t) => t.id === bound.ticket_id,
          );
        if (
          !ticket ||
          (await repo.capacity(db, bound.ticket_id)) >= ticket.capacity ||
          (await repo.firstWaiting(db, bound.ticket_id)) !== data.id
        )
          throw new AuthError("CONFLICT");
        const after = await repo.promote(db, data.id);
        await repo.recordChange(db, actor, before, after, data.reason);
        await audit(
          db,
          actor,
          "registration.promoted",
          data.id,
          requestId,
          data.reason,
        );
        await enqueueBusinessNotification(
          db,
          {
            CONFERENCE_NAME: (
              await effectivePublicSite(db, config.CONFERENCE_NAME)
            ).conferenceName,
          },
          {
            userId: bound.user_id,
            eventKey: `registration-promoted:${data.id}`,
            subject: "候補已遞補 / Registration promoted",
            text: `請登入查看遞補與原報名費率訂單。\n${config.PUBLIC_APP_ORIGIN}/registration`,
            requestId,
          },
        );
        return after;
      });
    },
    configuration: () => repo.configuration(pool),
    configure: async (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const data = registrationConfigInput.parse(input);
      validateRegistrationConfig(data.document);
      return authorized(raw, "registration.configure", async (db, actor) => {
        await repo.lockConfiguration(db);
        const current = await repo.configuration(db);
        if (current.version !== data.expectedVersion)
          throw new AuthError("CONFLICT");
        // Preserve ticket identity and never reduce capacity below existing attendance.
        for (const ticket of data.document.tickets)
          if ((await repo.capacity(db, ticket.id)) > ticket.capacity)
            throw new AuthError("CONFLICT");
        if (
          current.document?.tickets.some(
            (t) => !data.document.tickets.some((n) => n.id === t.id),
          )
        )
          throw new AuthError("CONFLICT");
        await repo.saveConfiguration(
          db,
          data.document,
          current.version + 1,
          actor,
        );
        await audit(
          db,
          actor,
          "registration.configured",
          String(current.version + 1),
          requestId,
        );
        return repo.configuration(db);
      });
    },
    mine: (raw: string | undefined, offset: number) =>
      authorized(raw, null, (db, actor) => repo.list(db, offset, actor)),
    admin: (raw: string | undefined, offset: number) =>
      authorized(raw, "registration.manage", (db) => repo.list(db, offset)),
    create: async (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const data = registrationInput.parse(input);
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            ...data,
            answers: Object.fromEntries(
              Object.entries(data.answers).sort(([a], [b]) =>
                a.localeCompare(b),
              ),
            ),
          }),
        )
        .digest("hex");
      return authorized(raw, null, async (db, actor) => {
        await repo.lockConfiguration(db);
        const previous = await repo.prior(db, actor, data.idempotencyKey);
        if (previous) {
          if (previous.request_hash !== hash) throw new AuthError("CONFLICT");
          return repo.detail(db, previous.id);
        }
        if (await repo.hasActive(db, actor)) throw new AuthError("CONFLICT");
        const cfg = await repo.configuration(db);
        if (cfg.version !== data.configVersion || !cfg.document)
          throw new AuthError("CONFLICT");
        const { ticket, amount } = registrationPrice(
          cfg.document,
          data.ticketId,
          new Date(),
        );
        validateAnswers(cfg.document, data.answers);
        const full = (await repo.capacity(db, ticket.id)) >= ticket.capacity;
        if (full && !ticket.waitlist) throw new AuthError("CONFLICT");
        const result = await repo.create(
          db,
          actor,
          data,
          cfg.document,
          ticket,
          amount,
          full ? "waitlisted" : "confirmed",
          hash,
        );
        await audit(db, actor, "registration.created", result.id, requestId);
        await enqueueBusinessNotification(
          db,
          {
            CONFERENCE_NAME: (
              await effectivePublicSite(db, config.CONFERENCE_NAME)
            ).conferenceName,
          },
          {
            userId: actor,
            eventKey: `registration:${result.id}`,
            subject: "報名紀錄已建立 / Registration recorded",
            text: `請登入查看報名、候補與付款狀態。\n${config.PUBLIC_APP_ORIGIN}/registration`,
            requestId,
          },
        );
        return result;
      });
    },
    cancel: async (
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) => {
      const data = registrationCancel.parse(input);
      return authorized(raw, null, async (db, actor) => {
        await repo.lockConfiguration(db);
        const current = await repo.detail(db, data.id);
        if (current.state === "cancelled") return current;
        const result = await repo.cancel(db, data.id);
        await repo.recordChange(db, actor, current, result, data.reason);
        await audit(
          db,
          actor,
          "registration.cancelled",
          result.id,
          requestId,
          data.reason,
        );
        return result;
      });
    },
  };
}
