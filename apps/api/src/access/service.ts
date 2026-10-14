import type { Pool } from "pg";
import { withIdentityTransaction } from "@confsys/db";
import type { ApiConfig } from "@confsys/config";
import {
  accessMutationInput,
  directoryQuery,
  pageQuery,
  type Permission,
} from "@confsys/contracts";
import { z } from "zod";
import { sessionActor } from "../auth/session.js";
import {
  lockUser,
  revokeSessions,
  revokeTokens,
  advanceCredentialVersion,
} from "../auth/repository.js";
import { AuthError } from "../auth/errors.js";
import {
  rolesFor,
  lockAccess,
  accountById,
  directory,
  recordAccess,
  auditPage,
  assertAdministratorRemains,
  grantRole,
  removeRole,
  changeAccountState,
} from "./repository.js";
import {
  requirePermission,
  mutationPermission,
  assertRecentPassword,
  rolePermissions,
} from "./policy.js";
export function createAccessService(pool: Pool, config: ApiConfig) {
  const read = <T>(
    raw: string | undefined,
    permission: Permission,
    work: (db: import("pg").PoolClient) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      const actor = await sessionActor(db, raw, config, new Date());
      requirePermission(await rolesFor(db, actor.id), permission);
      return work(db);
    });
  return {
    directory: (raw: string | undefined, input: unknown) =>
      read(raw, "accounts.directory.read", (db) =>
        directory(db, directoryQuery.parse(input)),
      ),
    detail: (raw: string | undefined, id: string) =>
      read(raw, "accounts.directory.read", (db) =>
        accountById(db, z.uuid().parse(id)),
      ),
    roles: (raw: string | undefined) =>
      read(raw, "accounts.directory.read", async () => ({
        items: Object.entries(rolePermissions).map(([role, permissions]) => ({
          role,
          permissions,
        })),
      })),
    audit: (raw: string | undefined, input: unknown) =>
      read(raw, "security_audit.read", (db) =>
        auditPage(db, pageQuery.parse(input)),
      ),
    async mutate(
      raw: string | undefined,
      targetId: string,
      input: unknown,
      requestId: string,
    ) {
      const action = accessMutationInput.parse(input);
      z.uuid().parse(targetId);
      return withIdentityTransaction(pool, async (db) => {
        // Lock order: control singleton -> actor user -> target user -> sessions/tokens.
        // All management writers serialize here; auth only locks its own user first.
        const control = await lockAccess(db);
        const actor = await sessionActor(db, raw, config, new Date(), true);
        requirePermission(
          await rolesFor(db, actor.id),
          mutationPermission(action.action),
        );
        assertRecentPassword(actor.passwordVerifiedAt, new Date());
        if (actor.id === targetId && action.action !== "revoke_sessions")
          throw new AuthError("SELF_CHANGE");
        const target = await lockUser(db, targetId);
        if (!target) throw new AuthError("NOT_FOUND");
        const before = await accountById(db, targetId);
        if (
          !before.verified ||
          !target.password_hash ||
          (action.action === "grant" && target.state !== "active")
        )
          throw new AuthError("CONFLICT");
        let changed = false;
        switch (action.action) {
          case "grant":
            changed = await grantRole(db, targetId, action.role);
            break;
          case "revoke":
            changed = await removeRole(db, targetId, action.role);
            break;
          case "disable":
          case "restore": {
            const state = action.action === "disable" ? "disabled" : "active";
            changed = await changeAccountState(db, targetId, state);
            break;
          }
          // Explicit force logout also fences a login currently verifying its password.
          case "revoke_sessions":
            changed = true;
            break;
        }
        if (!changed) return { changed: false };
        if (control.initialized_user_id) await assertAdministratorRemains(db);
        // Reuse the credential epoch: a password checked before this commit cannot mint a new session afterward.
        await advanceCredentialVersion(db, targetId);
        await revokeSessions(db, targetId, new Date());
        if (action.action === "disable")
          for (const purpose of ["verify", "reset"])
            await revokeTokens(db, targetId, purpose, new Date());
        const after = await accountById(db, targetId);
        await recordAccess(db, {
          action: `access.${action.action}`,
          targetId,
          actorId: actor.id,
          source: "session",
          reason: action.reason,
          before: JSON.stringify({ state: before.state, roles: before.roles }),
          after: JSON.stringify({ state: after.state, roles: after.roles }),
          requestId,
        });
        return { changed: true };
      });
    },
  };
}
