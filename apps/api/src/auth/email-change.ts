import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { ApiConfig } from "@confsys/config";
import { emailSchema, emailChangeConfirmInput } from "@confsys/contracts";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueIdentityMail } from "@confsys/notifications";
import { sessionActor, tokenHash } from "./session.js";
import {
  audit,
  findUser,
  lockUser,
  revokeTokens,
  revokeSessions,
} from "./repository.js";
import { lockAccessShared } from "../access/repository.js";
import { assertRecentPassword } from "../access/policy.js";
import { effectivePublicSite } from "../site/branding.js";
import { AuthError } from "./errors.js";
import * as repo from "./email-change-repository.js";
export function createEmailChangeService(pool: Pool, config: ApiConfig) {
  return {
    async requestEmailChange(
      raw: string | undefined,
      email: string,
      requestId: string,
    ) {
      const target = emailSchema.parse(email);
      await withIdentityTransaction(pool, async (db) => {
        await lockAccessShared(db);
        const actor = await sessionActor(db, raw, config, new Date(), true);
        assertRecentPassword(actor.passwordVerifiedAt, new Date());
        const user = (await lockUser(db, actor.id))!;
        // Identical public response for an occupied address; never merge local accounts.
        if (target === user.email || (await findUser(db, target))) {
          await audit(db, "email_change_requested", user.id, requestId);
          return;
        }
        await revokeTokens(db, user.id, "email_change", new Date());
        const token = randomBytes(32).toString("base64url"),
          row = await repo.createEmailChangeToken(
            db,
            user.id,
            user.email,
            target,
            user.credential_version,
            tokenHash(token),
          );
        await enqueueIdentityMail(db, {
          conferenceName: (
            await effectivePublicSite(db, config.CONFERENCE_NAME)
          ).conferenceName,
          userId: user.id,
          tokenId: row.id,
          kind: "email_change",
          requestId,
          expiresAt: row.expiresAt,
          link: `${config.PUBLIC_APP_ORIGIN}/auth/email-change#token=${token}`,
          key: config.MAIL_ENCRYPTION_KEY,
          keyVersion: config.MAIL_KEY_VERSION,
        });
        await audit(db, "email_change_requested", user.id, requestId);
      });
    },
    async confirmEmailChange(
      raw: string | undefined,
      input: unknown,
      requestId: string,
    ) {
      const { token } = emailChangeConfirmInput.parse(input);
      try {
        await withIdentityTransaction(pool, async (db) => {
          await lockAccessShared(db);
          const actor = await sessionActor(db, raw, config, new Date(), true);
          assertRecentPassword(actor.passwordVerifiedAt, new Date());
          const user = (await lockUser(db, actor.id))!,
            change = await repo.emailChangeToken(db, tokenHash(token));
          if (
            !change ||
            !change.eligible ||
            change.user_id !== actor.id ||
            change.source_email !== user.email ||
            change.credential_version !== user.credential_version
          )
            throw new AuthError("INVALID_TOKEN");
          if (await findUser(db, change.email)) throw new AuthError("CONFLICT");
          await db.query("SELECT set_config('app.actor_id',$1,true)", [
            actor.id,
          ]);
          if (
            !(await repo.consumeConfirmedEmail(db, actor.id, tokenHash(token)))
          )
            throw new AuthError("INVALID_TOKEN");
          for (const purpose of ["verify", "reset", "email_change"])
            await revokeTokens(db, actor.id, purpose, new Date());
          await revokeSessions(db, actor.id, new Date());
          await audit(db, "email_changed", actor.id, requestId);
          await audit(db, "sessions_revoked", actor.id, requestId);
        });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        )
          throw new AuthError("CONFLICT");
        throw error;
      }
    },
  };
}
