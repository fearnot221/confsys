import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueIdentityMail } from "@confsys/notifications";
import { emailSchema, type Account } from "@confsys/contracts";
import {
  assertPassword,
  dummyHash,
  hashPassword,
  verifyPassword,
} from "./password.js";
import { AuthError } from "./errors.js";
import {
  audit,
  insertToken,
  markTokenUsed,
  replaceCredential,
  insertSession,
  touchValidSession,
  revokeSession,
  ensurePendingUser,
  findToken,
  findUser,
  lockUser,
  revokeSessions,
  revokeTokens,
  recordPasswordProof,
} from "./repository.js";
import { tokenHash, sessionActor } from "./session.js";
export { tokenHash } from "./session.js";
import { rolesFor } from "../access/repository.js";
import { permissionsFor } from "../access/policy.js";
import type { Role } from "@confsys/contracts";
const secret = () => randomBytes(32).toString("base64url");
const projection = (
  user: { id: string; email: string },
  roles: Role[],
): Account => ({
  user: {
    id: user.id,
    email: user.email,
    verified: true,
    roles,
    permissions: permissionsFor(roles),
  },
});
export function createAuthService(
  pool: Pool,
  config: ApiConfig,
  options: { now?: () => Date; verify?: typeof verifyPassword } = {},
) {
  const clock = options.now ?? (() => new Date());
  const verify = options.verify ?? verifyPassword;
  const mailSettings = {
    key: config.MAIL_ENCRYPTION_KEY,
    keyVersion: config.MAIL_KEY_VERSION,
  };
  return {
    async requestMail(
      action: "register" | "resend" | "forgot",
      inputEmail: string,
      requestId: string,
    ) {
      const email = emailSchema.parse(inputEmail);
      // Same bounded expensive path for every anonymous outcome, including existing accounts.
      await verifyPassword(await dummyHash, "anonymous-mail-request");
      await withIdentityTransaction(pool, async (db) => {
        const initial =
          action === "register"
            ? await ensurePendingUser(db, email)
            : await findUser(db, email);
        const user = initial && (await lockUser(db, initial.id));
        const purpose = action === "forgot" ? "reset" : "verify";
        if (
          !user ||
          user.state !== (purpose === "verify" ? "pending" : "active")
        ) {
          await audit(db, "mail_request_accepted", null, requestId);
          return;
        }
        const now = clock();
        // Reissuing does not revoke older links: unauthenticated resend must not invalidate
        // a link already in the owner's inbox. Successful consumption revokes all siblings.
        const raw = secret(),
          tokenId = randomUUID();
        const expiresAt = new Date(
          now.getTime() +
            1000 *
              (purpose === "verify"
                ? config.VERIFICATION_TTL_SECONDS
                : config.RESET_TTL_SECONDS),
        );
        await insertToken(db, {
          id: tokenId,
          userId: user.id,
          email,
          purpose,
          hash: tokenHash(raw),
          expiresAt,
        });
        await enqueueIdentityMail(db, {
          ...mailSettings,
          userId: user.id,
          tokenId,
          kind: purpose,
          requestId,
          expiresAt,
          // Fragment is not sent in HTTP requests or referrers; only POST consumes it.
          link: `${config.PUBLIC_APP_ORIGIN}/auth/${purpose}#token=${raw}`,
        });
        await audit(db, "mail_request_accepted", user.id, requestId);
      });
    },
    async consume(
      purpose: "verify" | "reset",
      raw: string,
      password: string,
      requestId: string,
    ) {
      assertPassword(password);
      const hash = await hashPassword(password);
      await withIdentityTransaction(pool, async (db) => {
        const initial = await findToken(db, tokenHash(raw));
        if (!initial) throw new AuthError("INVALID_TOKEN");
        // All credential mutations acquire user lock before token/session changes.
        const user = await lockUser(db, initial.user_id);
        const token = await findToken(db, tokenHash(raw));
        const now = clock();
        if (
          !user ||
          !token ||
          token.purpose !== purpose ||
          token.email !== user.email ||
          token.used_at ||
          token.revoked_at ||
          token.expires_at <= now ||
          user.state !== (purpose === "verify" ? "pending" : "active")
        )
          throw new AuthError("INVALID_TOKEN");
        assertPassword(password, user.email);
        await markTokenUsed(db, token.id, now);
        await revokeTokens(db, user.id, purpose, now);
        await replaceCredential(db, user.id, hash, now);
        await revokeSessions(db, user.id, now);
        await audit(
          db,
          purpose === "verify" ? "registration_confirmed" : "password_reset",
          user.id,
          requestId,
        );
        await audit(db, "sessions_revoked", user.id, requestId);
        if (purpose === "reset")
          await enqueueIdentityMail(db, {
            ...mailSettings,
            userId: user.id,
            tokenId: null,
            kind: "password_changed",
            requestId,
            expiresAt: new Date(now.getTime() + 86400000),
            link: `${config.PUBLIC_APP_ORIGIN}/auth/login`,
          });
      });
    },
    async login(email: string, password: string, requestId: string) {
      const initial = await findUser(pool, emailSchema.parse(email));
      const valid = await verify(
        initial?.password_hash ?? (await dummyHash),
        password,
      );
      // Return the failure outcome after COMMIT so failed-login audit is durable.
      const result = await withIdentityTransaction(pool, async (db) => {
        const user = initial && (await lockUser(db, initial.id));
        if (
          !valid ||
          !user ||
          user.state !== "active" ||
          user.credential_version !== initial?.credential_version
        ) {
          await audit(db, "login_failed", user?.id ?? null, requestId);
          return null;
        }
        const raw = secret(),
          now = clock();
        await insertSession(db, {
          userId: user.id,
          hash: tokenHash(raw),
          version: user.credential_version,
          now,
          expiresAt: new Date(
            now.getTime() + config.SESSION_ABSOLUTE_SECONDS * 1000,
          ),
        });
        await audit(db, "login_succeeded", user.id, requestId);
        return { raw, account: projection(user, await rolesFor(db, user.id)) };
      });
      if (!result) throw new AuthError("INVALID_CREDENTIALS");
      return result;
    },
    async me(raw: string | undefined) {
      if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw))
        throw new AuthError("SESSION_EXPIRED");
      const now = clock();
      const user = await touchValidSession(
        pool,
        tokenHash(raw),
        now,
        new Date(now.getTime() - config.SESSION_IDLE_SECONDS * 1000),
      );
      if (!user) throw new AuthError("SESSION_EXPIRED");
      return projection(user, await rolesFor(pool, user.id));
    },
    async reauthenticate(
      raw: string | undefined,
      password: string,
      requestId: string,
    ) {
      const initial = await withIdentityTransaction(pool, (db) =>
        sessionActor(db, raw, config, clock()),
      );
      const user = await findUser(pool, initial.email);
      const valid = await verify(
        user?.password_hash ?? (await dummyHash),
        password,
      );
      const accepted = await withIdentityTransaction(pool, async (db) => {
        const actor = await sessionActor(db, raw, config, clock(), true);
        const current = await lockUser(db, actor.id);
        if (
          !valid ||
          !current ||
          current.credential_version !== user?.credential_version
        ) {
          await audit(db, "reauthentication_failed", actor.id, requestId);
          return false;
        }
        await recordPasswordProof(db, actor.hash, clock());
        await audit(db, "reauthentication_succeeded", actor.id, requestId);
        return true;
      });
      if (!accepted) throw new AuthError("INVALID_CREDENTIALS");
    },
    async logout(raw: string | undefined, requestId: string) {
      await withIdentityTransaction(pool, async (db) => {
        const userId = await revokeSession(db, tokenHash(raw ?? ""), clock());
        await audit(db, "logout", userId, requestId);
      });
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
