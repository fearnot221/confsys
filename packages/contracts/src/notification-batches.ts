import { z } from "zod";
import { roleSchema } from "./access.js";
const count = z.number().int().nonnegative();
const subject = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\r\n]/.test(value));
const messageText = z.string().trim().min(1).max(4000);
const pageInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
const deliveryState = z.enum([
  "pending",
  "processing",
  "accepted",
  "failed",
  "unknown",
  "cancelled",
]);
export const notificationAudienceInput = z.strictObject({
  role: roleSchema.nullable(),
  registration: z.enum(["any", "none", "confirmed", "cancelled"]),
  submission: z.enum(["any", "none", "draft", "submitted", "withdrawn"]),
  publishedOutcome: z.enum(["any", "accepted", "reject", "revision_requested"]),
});
export type NotificationAudience = z.infer<typeof notificationAudienceInput>;
export const notificationAudiencePreview = z.strictObject({
  items: z.array(z.strictObject({ id: z.uuid(), email: z.email() })).max(100),
  total: count,
  truncated: z.boolean(),
});
export type NotificationAudiencePreview = z.infer<
  typeof notificationAudiencePreview
>;
export const notificationTemplateInput = z.strictObject({
  id: z.uuid(),
  key: z.string().regex(/^[a-z0-9-]{1,80}$/),
  expectedVersion: count,
  name: z.string().trim().min(1).max(200),
  subject,
  text: messageText,
});
export const notificationTemplate = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  version: count,
  name: z.string(),
  subject: z.string(),
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type NotificationTemplate = z.infer<typeof notificationTemplate>;
export const notificationBatchInput = z.strictObject({
  idempotencyKey: z.uuid(),
  recipientIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((v) => new Set(v).size === v.length),
  subject,
  text: messageText,
  audience: notificationAudienceInput.nullable().default(null),
  templateVersionId: z.uuid().nullable().default(null),
  scheduledAt: z.iso.datetime().nullable().default(null),
});
export const notificationBatch = z.strictObject({
  id: z.uuid(),
  retryOf: z.uuid().nullable(),
  retriedAs: z.uuid().nullable(),
  retryableCount: count,
  subject: z.string(),
  text: z.string(),
  recipientCount: count,
  createdAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
  audience: notificationAudienceInput.nullable(),
  templateVersionId: z.uuid().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  statuses: z.array(z.strictObject({ status: deliveryState, count })),
});
export const notificationDelivery = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.email(),
  status: deliveryState,
  resultCode: z.string().nullable(),
  providerId: z.string().nullable(),
  attempts: count,
  nextAttemptAt: z.iso.datetime(),
  availableAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type NotificationDelivery = z.infer<typeof notificationDelivery>;
export const notificationBatchPage = z.strictObject({
  items: z.array(notificationBatch),
  nextOffset: count.nullable(),
});
export const notificationBatchEndpoints = {
  notificationAudiencePreview: {
    method: "post",
    path: "/api/notifications/audience-preview",
    input: notificationAudienceInput,
    output: notificationAudiencePreview,
  },
  notificationTemplateList: {
    method: "get",
    path: "/api/notifications/templates",
    input: pageInput,
    output: z.strictObject({
      items: z.array(notificationTemplate),
      nextOffset: count.nullable(),
    }),
  },
  notificationTemplateSave: {
    method: "post",
    path: "/api/notifications/templates",
    input: notificationTemplateInput,
    output: notificationTemplate,
  },
  notificationBatchDeliveries: {
    method: "get",
    path: "/api/notifications/batches/deliveries",
    input: pageInput.extend({ id: z.uuid() }),
    output: z.strictObject({
      items: z.array(notificationDelivery),
      nextOffset: count.nullable(),
    }),
  },
  notificationBatchRetry: {
    method: "post",
    path: "/api/notifications/batches/retry",
    input: z.strictObject({
      id: z.uuid(),
      idempotencyKey: z.uuid(),
      reason: z.string().trim().min(3).max(300),
    }),
    output: notificationBatch,
  },
  notificationBatchList: {
    method: "get",
    path: "/api/notifications/batches",
    input: pageInput,
    output: notificationBatchPage,
  },
  notificationBatchCreate: {
    method: "post",
    path: "/api/notifications/batches",
    input: notificationBatchInput,
    output: notificationBatch,
  },
  notificationBatchCancel: {
    method: "post",
    path: "/api/notifications/batches/cancel",
    input: z.strictObject({ id: z.uuid() }),
    output: notificationBatch,
  },
} as const;
export type NotificationBatch = z.infer<typeof notificationBatch>;
export type NotificationBatchPage = z.infer<typeof notificationBatchPage>;

export type NotificationBatchOptions = Pick<
  z.infer<typeof notificationBatchInput>,
  "audience" | "templateVersionId" | "scheduledAt"
>;
export type NotificationTemplateDraft = Omit<
  z.infer<typeof notificationTemplateInput>,
  "id"
>;
