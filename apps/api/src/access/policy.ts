import type { Role, Permission, AccessMutation } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
// Explicit grants: adding a future permission never implicitly grants it to admins.
export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  conference_staff: ["accounts.directory.read"],
  conference_admin: [
    "accounts.directory.read",
    "access.roles.manage",
    "accounts.status.manage",
    "accounts.sessions.revoke",
    "security_audit.read",
    "site.draft.read",
    "site.draft.write",
    "site.publish",
  ],
};
export function permissionsFor(roles: readonly string[]): Permission[] {
  return [
    ...new Set(
      roles.flatMap((role) =>
        Object.hasOwn(rolePermissions, role)
          ? rolePermissions[role as Role]
          : [],
      ),
    ),
  ];
}
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
