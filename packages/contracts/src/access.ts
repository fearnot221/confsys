import { z } from "zod";
export const roleSchema = z.enum(["conference_staff", "conference_admin", "finance", "chair", "reviewer"]);
export const permissionSchema = z.enum([
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
  "finance.read",
  "finance.reconcile",
  "finance.refund",
  "finance.receipt",
  "reviews.manage",
  "reviews.assigned",
  "reviews.decide",
]);
export type Role = z.infer<typeof roleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export const directoryAccountSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  state: z.enum(["pending", "active", "disabled"]),
  verified: z.boolean(),
  roles: z.array(roleSchema),
});
export type DirectoryAccount = z.infer<typeof directoryAccountSchema>;
export const directoryQuery = z.strictObject({
  search: z.string().trim().max(100).default(""),
  state: z.enum(["pending", "active", "disabled"]).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const pageQuery = directoryQuery.pick({ offset: true, limit: true });
export const directorySchema = z.strictObject({
  items: z.array(directoryAccountSchema),
  nextOffset: z.number().int().nullable(),
});
export const roleCatalogSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      role: roleSchema,
      permissions: z.array(permissionSchema),
    }),
  ),
});
export const auditEntrySchema = z.strictObject({
  id: z.uuid(),
  event: z.string(),
  targetId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  source: z.enum(["session", "operator_cli", "authentication"]),
  reason: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  requestId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const auditPageSchema = z.strictObject({
  items: z.array(auditEntrySchema),
  nextOffset: z.number().int().nullable(),
});
const reason = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .refine((v) =>
    [...v].every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    ),
  );
export const accessMutationInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("grant"), role: roleSchema, reason }),
  z.strictObject({ action: z.literal("revoke"), role: roleSchema, reason }),
  z.strictObject({ action: z.literal("disable"), reason }),
  z.strictObject({ action: z.literal("restore"), reason }),
  z.strictObject({ action: z.literal("revoke_sessions"), reason }),
]);
export type AccessMutation = z.infer<typeof accessMutationInput>;
export const accessResultSchema = z.strictObject({ changed: z.boolean() });
export const reauthenticateInput = z.strictObject({
  password: z.string().min(1).max(512),
});
export const bootstrapInput = z.strictObject({
  targetId: z.uuid(),
  apply: z.boolean().default(false),
  reason: reason.optional(),
  confirmOrigin: z.string().optional(),
});
export const accessEndpoints = {
  directory: {
    method: "get",
    path: "/api/access/accounts",
    input: directoryQuery,
    output: directorySchema,
  },
  detail: {
    method: "get",
    path: "/api/access/accounts/:id",
    output: directoryAccountSchema,
  },
  roles: {
    method: "get",
    path: "/api/access/roles",
    output: roleCatalogSchema,
  },
  audit: {
    method: "get",
    path: "/api/access/audit",
    input: pageQuery,
    output: auditPageSchema,
  },
  mutate: {
    method: "post",
    path: "/api/access/accounts/:id/actions",
    input: accessMutationInput,
    output: accessResultSchema,
  },
} as const;
