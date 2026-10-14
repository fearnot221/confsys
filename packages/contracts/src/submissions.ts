import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
export const submissionAuthorSchema = z.strictObject({
  name: text(200),
  email: z.union([z.email(), z.literal("")]),
  affiliation: text(300),
});
export const submissionDocumentSchema = z.strictObject({
  title: text(500),
  abstract: text(20000),
  keywords: z.array(text(100)).max(20).default([]),
  correspondingAuthorIndex: z
    .number()
    .int()
    .min(0)
    .max(29)
    .nullable()
    .default(null),
  trackId: z.string().max(80),
  topicIds: z.array(z.string().max(80)).max(20),
  authors: z.array(submissionAuthorSchema).max(30),
  presenterIndex: z.number().int().min(0).max(29),
  presentationPreference: z.enum(["oral", "poster", "either"]),
  competition: z.boolean(),
  attachmentIds: z.array(z.uuid()).max(10),
  slidesFileId: z.uuid().nullable(),
  videoUrl: z.string().max(2000),
});
export type SubmissionDocument = z.infer<typeof submissionDocumentSchema>;
export const submissionTrackSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,80}$/),
  name: text(200).min(1),
  topics: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]{1,80}$/),
        name: text(200).min(1),
      }),
    )
    .max(100),
});
export const submissionConfigSchema = z.strictObject({
  version: z.number().int().min(0),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  requireRegistration: z.boolean(),
  requireAttachment: z.boolean(),
  mode: z.enum(["abstract", "full_paper"]).default("abstract"),
  presenterMustBeSubmitter: z.boolean().default(false),
  tracks: z.array(submissionTrackSchema).max(100),
});
export type SubmissionConfig = z.infer<typeof submissionConfigSchema>;
export const submissionSchema = z.strictObject({
  id: z.uuid(),
  number: z.string().regex(/^[1-9][0-9]*$/),
  ownerId: z.uuid(),
  state: z.enum(["draft", "submitted", "withdrawn"]),
  version: z.number().int().min(1),
  submittedVersion: z.number().int().nullable(),
  currentRevisionId: z.uuid().nullable(),
  document: submissionDocumentSchema,
  updatedAt: z.string(),
});
export type Submission = z.infer<typeof submissionSchema>;
export const submissionRevisionSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  version: z.number().int(),
  document: submissionDocumentSchema,
  submittedAt: z.string(),
});
export const submissionDetailSchema = z.strictObject({
  submission: submissionSchema,
  revisions: z.array(submissionRevisionSchema),
  nextRevisionOffset: z.number().int().nullable(),
});
export const submissionListInput = z.strictObject({
  scope: z.enum(["own", "admin"]).default("own"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const submissionListSchema = z.strictObject({
  items: z.array(submissionSchema),
  nextOffset: z.number().int().nullable(),
});
export const submissionSaveInput = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().min(0),
  document: submissionDocumentSchema,
});
export const submissionTransitionInput = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().min(1),
  action: z.enum(["submit", "withdraw"]),
});
export const submissionConfigInput = submissionConfigSchema;
export const submissionEndpoints = {
  submissionConfig: {
    method: "get",
    path: "/api/submissions/config",
    output: submissionConfigSchema,
  },
  submissionConfigure: {
    method: "post",
    path: "/api/submissions/config",
    input: submissionConfigInput,
    output: submissionConfigSchema,
  },
  submissionList: {
    method: "get",
    path: "/api/submissions",
    input: submissionListInput,
    output: submissionListSchema,
  },
  submissionDetail: {
    method: "get",
    path: "/api/submissions/detail",
    input: z.strictObject({
      id: z.uuid(),
      scope: z.enum(["own", "admin"]).default("own"),
      revisionOffset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: submissionDetailSchema,
  },
  submissionSave: {
    method: "post",
    path: "/api/submissions/save",
    input: submissionSaveInput,
    output: submissionSchema,
  },
  submissionTransition: {
    method: "post",
    path: "/api/submissions/transition",
    input: submissionTransitionInput,
    output: submissionSchema,
  },
} as const;
