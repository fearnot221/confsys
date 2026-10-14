import { z } from "zod";
const id = z.uuid(),
  version = z.number().int().min(0),
  reason = z.string().trim().min(3).max(2000);
export const competitionCriterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  label: z.string().trim().min(1).max(200),
  maximum: z.number().int().min(1).max(1000),
  weight: z.number().int().min(1).max(100),
});
export const competitionConfigSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["oral", "poster"]),
  registrationClosesAt: z.iso.datetime(),
  judgingClosesAt: z.iso.datetime(),
  requireRegistration: z.boolean(),
  minimumJudges: z.number().int().min(1).max(10),
  tiePolicy: z.enum(["shared", "manual"]),
  eligibilityNote: z.string().trim().min(1).max(2000),
  criteria: z.array(competitionCriterionSchema).min(1).max(20),
});
export type CompetitionConfig = z.infer<typeof competitionConfigSchema>;
export const competitionSchema = z.strictObject({
  id,
  version,
  currentRubricId: id,
  config: competitionConfigSchema,
});
export const competitionEntrySchema = z.strictObject({
  id,
  competitionId: id,
  submissionId: id,
  revisionId: id,
  ownerId: id,
  version,
  state: z.enum([
    "requested",
    "approved",
    "rejected",
    "withdrawn",
    "disqualified",
  ]),
  title: z.string(),
  presenterName: z.string(),
  predecessorId: id.nullable(),
  replacementReason: z.string(),
  reason: z.string(),
});
export const competitionScoreSchema = z.strictObject({
  scores: z
    .array(
      z.strictObject({
        criterionId: z.string().max(60),
        value: z.number().int().min(0).max(1000),
      }),
    )
    .max(20),
  comment: z.string().max(4000),
});
export type CompetitionScore = z.infer<typeof competitionScoreSchema>;
export const competitionAssignmentSchema = z.strictObject({
  id,
  competitionId: id,
  entryId: id,
  judgeId: id,
  version,
  state: z.enum(["assigned", "submitted", "conflicted", "cancelled"]),
  rubricId: id,
  config: competitionConfigSchema,
  title: z.string(),
  presenterName: z.string(),
  document: competitionScoreSchema,
});
export const competitionTotalSchema = z.strictObject({
  entryId: id,
  submitted: z.number().int(),
  missing: z.number().int(),
  numerator: z.string(),
  denominator: z.string(),
  basisPoints: z.number().int().nullable(),
});
export const competitionAwardDraftSchema = z.strictObject({
  entryId: id,
  label: z.string().trim().min(1).max(200),
  rank: z.number().int().min(1).max(1000),
});
export const competitionAdminSchema = z.strictObject({
  competitions: z.array(competitionSchema),
  entries: z.array(competitionEntrySchema),
  assignments: z.array(competitionAssignmentSchema),
  totals: z.array(competitionTotalSchema),
  nextOffset: z.number().int().nullable(),
  awardDrafts: z.array(
    z.strictObject({
      competitionId: id,
      awards: z.array(competitionAwardDraftSchema),
      reason: z.string(),
    }),
  ),
});
export type CompetitionAdmin = z.infer<typeof competitionAdminSchema>;
export const competitionCatalogSchema = z.strictObject({
  competitions: z.array(competitionSchema),
  entries: z.array(competitionEntrySchema),
  nextOffset: z.number().int().nullable(),
});
export const competitionJudgingSchema = z.strictObject({
  assignments: z.array(competitionAssignmentSchema),
  nextOffset: z.number().int().nullable(),
});
export const competitionPublicSchema = z.strictObject({
  competitions: z.array(
    z.strictObject({
      id,
      name: z.string(),
      publicationId: id,
      publishedAt: z.string(),
      tiePolicy: z.enum(["shared", "manual"]),
      awards: z.array(
        z.strictObject({
          label: z.string(),
          rank: z.number().int(),
          title: z.string(),
          presenterName: z.string(),
          basisPoints: z.number().int(),
        }),
      ),
    }),
  ),
});
export type CompetitionPublic = z.infer<typeof competitionPublicSchema>;
export const competitionEndpoints = {
  competitionPublic: {
    method: "get",
    path: "/api/competitions/awards",
    output: competitionPublicSchema,
  },
  competitionCatalog: {
    method: "get",
    path: "/api/competitions",
    input: z.strictObject({
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: competitionCatalogSchema,
  },
  competitionAdmin: {
    method: "get",
    path: "/api/competitions/admin",
    input: z.strictObject({
      competitionId: id.optional(),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: competitionAdminSchema,
  },
  competitionJudging: {
    method: "get",
    path: "/api/competitions/judging",
    input: z.strictObject({
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: competitionJudgingSchema,
  },
  competitionConfigure: {
    method: "post",
    path: "/api/competitions/configure",
    input: z.strictObject({
      id,
      expectedVersion: version,
      config: competitionConfigSchema,
    }),
    output: competitionAdminSchema,
  },
  competitionEnroll: {
    method: "post",
    path: "/api/competitions/enroll",
    input: z.strictObject({ competitionId: id, revisionId: id }),
    output: competitionCatalogSchema,
  },
  competitionReplaceEntry: {
    method: "post",
    path: "/api/competitions/replace-entry",
    input: z.strictObject({ predecessorId: id, expectedVersion: version, revisionId: id, reason }),
    output: competitionEntrySchema,
  },
  competitionEntry: {
    method: "post",
    path: "/api/competitions/entry",
    input: z.strictObject({
      id,
      expectedVersion: version,
      action: z.enum(["approve", "reject", "withdraw", "disqualify"]),
      reason,
    }),
    output: competitionEntrySchema,
  },
  competitionAssign: {
    method: "post",
    path: "/api/competitions/assign",
    input: z.strictObject({ entryId: id, judgeId: id }),
    output: competitionAdminSchema,
  },
  competitionRemind: {
    method: "post",
    path: "/api/competitions/remind",
    input: z.strictObject({ assignmentId: id, idempotencyKey: id, reason }),
    output: competitionAdminSchema,
  },
  competitionCancel: {
    method: "post",
    path: "/api/competitions/cancel-assignment",
    input: z.strictObject({ assignmentId: id, reason }),
    output: competitionAdminSchema,
  },
  competitionConflict: {
    method: "post",
    path: "/api/competitions/conflict",
    input: z.strictObject({ assignmentId: id, reason }),
    output: competitionJudgingSchema,
  },
  competitionScore: {
    method: "post",
    path: "/api/competitions/score",
    input: z.strictObject({
      assignmentId: id,
      expectedVersion: version,
      action: z.enum(["save", "submit"]),
      document: competitionScoreSchema,
    }),
    output: competitionJudgingSchema,
  },
  competitionAwards: {
    method: "post",
    path: "/api/competitions/awards",
    input: z.strictObject({
      competitionId: id,
      expectedVersion: version,
      awards: z.array(competitionAwardDraftSchema).min(1).max(100),
      reason,
    }),
    output: competitionAdminSchema,
  },
  competitionPublish: {
    method: "post",
    path: "/api/competitions/publish",
    input: z.strictObject({ competitionId: id, expectedVersion: version }),
    output: competitionPublicSchema,
  },
} as const;

export type CompetitionCatalog = z.infer<typeof competitionCatalogSchema>;
export type CompetitionJudging = z.infer<typeof competitionJudgingSchema>;
