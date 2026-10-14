import { z } from "zod";
const reason = z.string().trim().min(3).max(300);
export const presenterChangeState = z.enum([
  "requested",
  "accepted",
  "declined",
  "cancelled",
  "approved",
  "rejected",
  "expired",
]);
export const presenterChangeProjection = z.strictObject({
  number: z.string(),
  title: z.string(),
  previousName: z.string(),
  previousEmail: z.email(),
  targetName: z.string(),
  targetEmail: z.email(),
});
export const presenterChangeSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  sourceRevisionId: z.uuid(),
  newRevisionId: z.uuid().nullable(),
  requesterId: z.uuid(),
  targetUserId: z.uuid(),
  targetAuthorIndex: z.number().int().min(0),
  expectedSubmissionVersion: z.number().int().positive(),
  configVersion: z.number().int().min(0),
  projection: presenterChangeProjection,
  reason,
  state: presenterChangeState,
  version: z.number().int().positive(),
  responseReason: z.string().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  consentedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type PresenterChange = z.infer<typeof presenterChangeSchema>;
export const presenterChangeCreate = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  sourceRevisionId: z.uuid(),
  expectedSubmissionVersion: z.number().int().positive(),
  targetAuthorIndex: z.number().int().min(0).max(99),
  reason,
});
const actionBase = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason,
});
export const presenterChangeRespond = actionBase.extend({
  action: z.enum(["accept", "decline"]),
});
export const presenterChangeDecide = actionBase.extend({
  action: z.enum(["approve", "reject"]),
});
export const presenterChangeCancel = actionBase;
export const presenterChangeEndpoints = {
  presenterChanges: {
    method: "get",
    path: "/api/presenter-changes",
    input: z.strictObject({
      scope: z.enum(["own", "incoming", "admin"]).default("own"),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: z.strictObject({
      items: z.array(presenterChangeSchema),
      nextOffset: z.number().int().nullable(),
    }),
  },
  presenterChangeCreate: {
    method: "post",
    path: "/api/presenter-changes",
    input: presenterChangeCreate,
    output: presenterChangeSchema,
  },
  presenterChangeRespond: {
    method: "post",
    path: "/api/presenter-changes/respond",
    input: presenterChangeRespond,
    output: presenterChangeSchema,
  },
  presenterChangeCancel: {
    method: "post",
    path: "/api/presenter-changes/cancel",
    input: presenterChangeCancel,
    output: presenterChangeSchema,
  },
  presenterChangeDecide: {
    method: "post",
    path: "/api/presenter-changes/decide",
    input: presenterChangeDecide,
    output: presenterChangeSchema,
  },
} as const;
