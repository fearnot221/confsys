import { z } from "zod";
import { submissionRegistrationRequirementSchema } from "./submissions.js";
const text = (max: number) => z.string().trim().max(max);
export const reviewCriterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  label: text(200).min(1),
  max: z.number().int().min(1).max(100),
});
export const reviewFormDocumentSchema = z
  .strictObject({
    name: text(200).min(1),
    mode: z.enum(["single_blind", "double_blind"]),
    closesAt: z.iso.datetime(),
    criteria: z.array(reviewCriterionSchema).min(1).max(20),
    requireScreening: z.boolean().default(false),
  })
  .refine(
    (v) => new Set(v.criteria.map((c) => c.id)).size === v.criteria.length,
  );
export type ReviewFormDocument = z.infer<typeof reviewFormDocumentSchema>;
export const reviewFormSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int(),
  document: reviewFormDocumentSchema,
});
export const reviewScoreDocumentSchema = z.strictObject({
  scores: z
    .array(
      z.strictObject({
        criterionId: z.string().max(60),
        value: z.number().min(0).max(100),
      }),
    )
    .max(20),
  authorComment: text(10000),
  privateComment: text(10000),
});
export type ReviewScoreDocument = z.infer<typeof reviewScoreDocumentSchema>;
export const reviewPaperSchema = z.strictObject({
  title: z.string(),
  abstract: z.string(),
  trackId: z.string(),
  topicIds: z.array(z.string()),
  attachmentIds: z.array(z.uuid()),
  authors: z.array(
    z.strictObject({ name: z.string(), affiliation: z.string() }),
  ),
});
export const reviewAssignmentSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  state: z.enum(["invited", "accepted", "declined", "conflicted", "submitted"]),
  version: z.number().int(),
  paper: reviewPaperSchema,
  form: reviewFormSchema,
  screening: z.enum(["unchecked", "ready", "needs_correction", "ineligible"]),
  document: reviewScoreDocumentSchema,
});
export type ReviewAssignment = z.infer<typeof reviewAssignmentSchema>;
export const reviewDecisionSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  version: z.number().int(),
  outcome: z.enum([
    "accept_oral",
    "accept_poster",
    "reject",
    "revision_requested",
  ]),
  authorMessage: z.string(),
  internalReason: z.string(),
  revisionDeadline: z.string().nullable(),
  published: z.boolean(),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export const reviewScreeningSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  version: z.number().int().min(1),
  outcome: z.enum(["ready", "needs_correction", "ineligible"]),
  reason: text(2000).min(3),
  createdBy: z.uuid(),
  createdAt: z.string(),
});
export type ReviewScreening = z.infer<typeof reviewScreeningSchema>;
export const reviewScreenInput = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  outcome: z.enum(["ready", "needs_correction", "ineligible"]),
  reason: text(2000).min(3),
});
export const reviewBoardSchema = z.strictObject({
  screenings: z.array(reviewScreeningSchema),
  workload: z.array(
    z.strictObject({
      reviewerId: z.uuid(),
      invited: z.number().int(),
      accepted: z.number().int(),
      submitted: z.number().int(),
      overdue: z.number().int(),
    }),
  ),
  papers: z.array(
    z.strictObject({
      submissionId: z.uuid(),
      revisionId: z.uuid(),
      title: z.string(),
      trackId: z.string(),
    }),
  ),
  reviewers: z.array(z.strictObject({ id: z.uuid(), email: z.email() })),
  forms: z.array(reviewFormSchema),
  scopes: z.array(z.strictObject({ userId: z.uuid(), trackId: z.string() })),
  assignments: z.array(reviewAssignmentSchema.extend({ reviewerId: z.uuid() })),
  decisions: z.array(reviewDecisionSchema),
  nextOffset: z.number().int().nullable(),
});
export const reviewAssignInput = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  reviewerId: z.uuid(),
  formId: z.uuid(),
  anonymousConfirmed: z.boolean(),
});
export const reviewAssignmentActionInput = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().min(1),
  action: z.enum(["accept", "decline", "conflict", "save", "submit"]),
  reason: text(1000).default(""),
  document: reviewScoreDocumentSchema.optional(),
});
export const reviewDecisionInput = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  outcome: z.enum([
    "accept_oral",
    "accept_poster",
    "reject",
    "revision_requested",
  ]),
  authorMessage: text(4000).min(1),
  internalReason: text(4000).min(3),
  revisionDeadline: z.iso.datetime().nullable(),
});
export const reviewAuthorResultSchema = z.strictObject({
  submissionId: z.uuid(),
  registrationRequirement: submissionRegistrationRequirementSchema.nullable(),
  outcome: z.enum([
    "accept_oral",
    "accept_poster",
    "reject",
    "revision_requested",
  ]),
  authorMessage: z.string(),
  revisionDeadline: z.string().nullable(),
  publishedAt: z.string(),
  authorComments: z.array(z.string()),
});
export const reviewPageInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const reviewEndpoints = {
  reviewScreen: {
    method: "post",
    path: "/api/reviews/screen",
    input: reviewScreenInput,
    output: reviewScreeningSchema,
  },
  reviewRemind: {
    method: "post",
    path: "/api/reviews/remind",
    input: z.strictObject({
      assignmentId: z.uuid(),
      idempotencyKey: z.uuid(),
      reason: text(2000).min(3),
    }),
    output: z.strictObject({ queued: z.literal(true) }),
  },
  reviewConflict: {
    method: "post",
    path: "/api/reviews/conflict",
    input: z.strictObject({
      submissionId: z.uuid(),
      reason: text(1000).min(3),
    }),
    output: z.strictObject({ changed: z.boolean() }),
  },
  reviewBoard: {
    method: "get",
    path: "/api/reviews/board",
    input: reviewPageInput,
    output: reviewBoardSchema,
  },
  reviewAssigned: {
    method: "get",
    path: "/api/reviews/assigned",
    input: reviewPageInput,
    output: z.strictObject({
      items: z.array(reviewAssignmentSchema),
      nextOffset: z.number().int().nullable(),
    }),
  },
  reviewForm: {
    method: "post",
    path: "/api/reviews/forms",
    input: reviewFormDocumentSchema,
    output: reviewFormSchema,
  },
  reviewScope: {
    method: "post",
    path: "/api/reviews/chair-scope",
    input: z.strictObject({
      userId: z.uuid(),
      trackId: z.string().max(80).min(1),
      remove: z.boolean(),
    }),
    output: z.strictObject({ changed: z.boolean() }),
  },
  reviewAssign: {
    method: "post",
    path: "/api/reviews/assign",
    input: reviewAssignInput,
    output: reviewAssignmentSchema,
  },
  reviewAction: {
    method: "post",
    path: "/api/reviews/action",
    input: reviewAssignmentActionInput,
    output: reviewAssignmentSchema,
  },
  reviewDecide: {
    method: "post",
    path: "/api/reviews/decide",
    input: reviewDecisionInput,
    output: reviewDecisionSchema,
  },
  reviewPublish: {
    method: "post",
    path: "/api/reviews/publish",
    input: z.strictObject({ id: z.uuid() }),
    output: reviewDecisionSchema,
  },
  reviewAuthorResults: {
    method: "get",
    path: "/api/reviews/results",
    input: reviewPageInput,
    output: z.strictObject({
      items: z.array(reviewAuthorResultSchema),
      nextOffset: z.number().int().nullable(),
    }),
  },
} as const;
export type ReviewBoard = z.infer<typeof reviewBoardSchema>;
export type ReviewAuthorResult = z.infer<typeof reviewAuthorResultSchema>;
