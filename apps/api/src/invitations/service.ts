import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import {
  invitationCreateInput,
  invitationRevokeInput,
  invitationAcceptInput,
  pageQuery,
} from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { sessionActor, tokenHash } from "../auth/session.js";
import {
  findUser,
  lockUser,
  advanceCredentialVersion,
  revokeSessions,
} from "../auth/repository.js";
import {
  lockAccess,
  rolesFor,
  grantRole,
  recordAccess,
  accountById,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import { effectivePublicSite } from "../site/branding.js";
import {
  invitationByKey,
  invitationByHash,
  lockInvitation,
  insertInvitation,
  closeInvitation,
  invitationProjection,
  listInvitations,
  enqueueInvitation,
} from "./repository.js";
export function createInvitationService(pool: Pool, config: ApiConfig) {
  return {
    async list(raw: string | undefined, input: unknown) {
      const page = pageQuery.parse(input);
      return withIdentityTransaction(pool, async (db) => {
        const actor = await sessionActor(db, raw, config, new Date());
        requirePermission(await rolesFor(db, actor.id), "access.roles.manage");
        return listInvitations(db, page);
      });
    },
    async create(raw: string | undefined, input: unknown, requestId: string) {
      const data = invitationCreateInput.parse(input);
      return withIdentityTransaction(pool, async (db) => {
        await lockAccess(db);
        const now = new Date();
        const actor = await sessionActor(db, raw, config, now, true);
        requirePermission(await rolesFor(db, actor.id), "access.roles.manage");
        assertRecentPassword(actor.passwordVerifiedAt, now);
        const existing = await invitationByKey(
          db,
          actor.id,
          data.idempotencyKey,
        );
        if (existing) {
          if (
            existing.email !== data.email ||
            existing.role !== data.role ||
            existing.reason !== data.reason
          )
            throw new AuthError("CONFLICT");
          return invitationProjection(existing);
        }
        const found = await findUser(db, data.email);
        if (!found) throw new AuthError("NOT_FOUND");
        if (found.id === actor.id) throw new AuthError("SELF_CHANGE");
        const target = await lockUser(db, found.id);
        const issuer = await lockUser(db, actor.id);
        if (
          !target ||
          !issuer ||
          target.state !== "active" ||
          !target.password_hash ||
          !(await accountById(db, target.id)).verified
        )
          throw new AuthError("CONFLICT");
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        const row = await insertInvitation(db, {
          id: randomUUID(),
          userId: target.id,
          email: target.email,
          role: data.role,
          issuerId: actor.id,
          issuerVersion: issuer.credential_version,
          recipientVersion: target.credential_version,
          hash: tokenHash(token),
          idempotencyKey: data.idempotencyKey,
          reason: data.reason,
          expiresAt,
        });
        const brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        await enqueueInvitation(db, {
          invitationId: row.id,
          userId: target.id,
          requestId,
          expiresAt,
          conferenceName: brand.conferenceName,
          link: `${config.PUBLIC_APP_ORIGIN}/auth/invitation#token=${token}`,
          key: config.MAIL_ENCRYPTION_KEY,
          keyVersion: config.MAIL_KEY_VERSION,
        });
        await recordAccess(db, {
          action: "invitation.created",
          targetId: target.id,
          actorId: actor.id,
          source: "session",
          reason: data.reason,
          before: "null",
          after: JSON.stringify({ invitationId: row.id, role: row.role }),
          requestId,
        });
        return invitationProjection(row);
      });
    },
    async revoke(
      raw: string | undefined,
      id: string,
      input: unknown,
      requestId: string,
    ) {
      z.uuid().parse(id);
      const data = invitationRevokeInput.parse(input);
      return withIdentityTransaction(pool, async (db) => {
        await lockAccess(db);
        const now = new Date();
        const actor = await sessionActor(db, raw, config, now, true);
        requirePermission(await rolesFor(db, actor.id), "access.roles.manage");
        assertRecentPassword(actor.passwordVerifiedAt, now);
        const row = await lockInvitation(db, id);
        if (!row) throw new AuthError("NOT_FOUND");
        if (row.accepted_at) throw new AuthError("CONFLICT");
        const changed = await closeInvitation(db, id, false, now);
        if (changed)
          await recordAccess(db, {
            action: "invitation.revoked",
            targetId: row.user_id,
            actorId: actor.id,
            source: "session",
            reason: data.reason,
            before: JSON.stringify({ invitationId: id, status: "pending" }),
            after: JSON.stringify({ invitationId: id, status: "revoked" }),
            requestId,
          });
        return { changed };
      });
    },
    async accept(raw: string | undefined, input: unknown, requestId: string) {
      const data = invitationAcceptInput.parse(input);
      return withIdentityTransaction(pool, async (db) => {
        // Same control lock as direct role writes; issuer authority is rechecked at acceptance.
        await lockAccess(db);
        const now = new Date();
        const actor = await sessionActor(db, raw, config, now, true);
        assertRecentPassword(actor.passwordVerifiedAt, now);
        const initial = await invitationByHash(db, tokenHash(data.token));
        if (
          !initial ||
          initial.user_id !== actor.id ||
          initial.email !== actor.email
        )
          throw new AuthError("INVALID_TOKEN");
        const issuer = await lockUser(db, initial.issuer_id);
        const recipient = await lockUser(db, actor.id);
        const row = await lockInvitation(db, initial.id);
        if (
          !row ||
          row.accepted_at ||
          row.revoked_at ||
          row.expires_at <= now ||
          !issuer ||
          issuer.state !== "active" ||
          issuer.credential_version !== row.issuer_credential_version ||
          !recipient ||
          recipient.credential_version !== row.recipient_credential_version
        )
          throw new AuthError("INVALID_TOKEN");
        try {
          requirePermission(
            await rolesFor(db, issuer.id),
            "access.roles.manage",
          );
        } catch (error) {
          if (error instanceof AuthError && error.code === "FORBIDDEN")
            throw new AuthError("INVALID_TOKEN");
          throw error;
        }
        const before = await rolesFor(db, actor.id);
        await grantRole(db, actor.id, row.role);
        if (!(await closeInvitation(db, row.id, true, now)))
          throw new AuthError("INVALID_TOKEN");
        await advanceCredentialVersion(db, actor.id);
        await revokeSessions(db, actor.id, now);
        await recordAccess(db, {
          action: "invitation.accepted",
          targetId: actor.id,
          actorId: actor.id,
          source: "session",
          reason: "Explicit local role invitation acceptance",
          before: JSON.stringify({ roles: before }),
          after: JSON.stringify({
            invitationId: row.id,
            roles: await rolesFor(db, actor.id),
          }),
          requestId,
        });
        return { changed: true };
      });
    },
  };
}
