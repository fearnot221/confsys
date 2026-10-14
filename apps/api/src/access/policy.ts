import type {AccessMutation,Permission} from "@confsys/contracts";
import {permissionsFor} from "@confsys/policy";
export {permissionsFor,rolePermissions} from "@confsys/policy";
import {AuthError} from "../auth/errors.js";
export function requirePermission(
  roles: readonly string[] | undefined,
  permission: string,
) {
  if (!roles || !permissionsFor(roles).some((value) => value === permission))
    throw new AuthError("FORBIDDEN");
}
export function mutationPermission(
  action: AccessMutation["action"],
): Permission {
  switch (action) {
    case "grant":
    case "revoke":
      return "access.roles.manage";
    case "disable":
    case "restore":
      return "accounts.status.manage";
    case "revoke_sessions":
      return "accounts.sessions.revoke";
  }
}
export function assertRecentPassword(at: Date | null, now: Date) {
  if (!at || at > now || now.getTime() - at.getTime() >= 300000)
    throw new AuthError("REAUTH_REQUIRED");
}
