import { z } from "zod";
import { roleSchema, pageQuery } from "./access.js";
import { emailSchema } from "./auth.js";
const reason = z.string().trim().min(3).max(300).refine((v) => [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127));
export const invitationCreateInput = z.strictObject({ email: emailSchema, role: roleSchema, reason, idempotencyKey: z.uuid() });
export const invitationRevokeInput = z.strictObject({ reason });
export const invitationAcceptInput = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const invitationSchema = z.strictObject({ id: z.uuid(), email: z.email(), role: roleSchema, status: z.enum(["pending", "accepted", "revoked", "expired"]), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
export type Invitation = z.infer<typeof invitationSchema>;
export const invitationListSchema = z.strictObject({ items: z.array(invitationSchema), nextOffset: z.number().int().nullable() });
export const invitationResultSchema = z.strictObject({ changed: z.boolean() });
export const invitationEndpoints = {
  list: { method: "get", path: "/api/access/invitations", input: pageQuery, output: invitationListSchema },
  create: { method: "post", path: "/api/access/invitations", input: invitationCreateInput, output: invitationSchema },
  revoke: { method: "post", path: "/api/access/invitations/:id/revoke", input: invitationRevokeInput, output: invitationResultSchema },
  accept: { method: "post", path: "/api/access/invitations/accept", input: invitationAcceptInput, output: invitationResultSchema },
} as const;
