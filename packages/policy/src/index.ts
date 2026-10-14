import type {Role,Permission} from "@confsys/contracts";
// Explicit grants: adding a future permission never implicitly grants it to admins.
export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  onsite: ["onsite.read", "onsite.checkin", "onsite.redeem"],
  competition_judge: ["competitions.score"],
  finance: ["finance.read", "finance.reconcile", "finance.refund", "finance.receipt"],
  chair: ["reviews.manage", "reviews.decide"],
  reviewer: ["reviews.assigned"],
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
    "files.media.manage",
    "registration.configure",
    "registration.manage",
    "submissions.manage",
    "submissions.read_all",
    "reviews.manage",
    "program.manage",
    "program.publish",
    "onsite.read",
    "onsite.checkin",
    "onsite.redeem",
    "onsite.undo",
  "documents.template.manage",
    "competitions.manage",
  "reporting.read",
  "reporting.export",
  "authors.preview",
  "notifications.manage",
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
