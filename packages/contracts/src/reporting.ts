import { z } from "zod";
const page = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
const id = z.uuid();
const count = z.number().int().nonnegative();
const stat = z.strictObject({ state: z.string(), count });
const note = z.strictObject({
  id,
  subject: z.string(),
  text: z.string(),
  status: z.enum([
    "pending",
    "processing",
    "accepted",
    "failed",
    "unknown",
    "cancelled",
  ]),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export const notificationPage = z.strictObject({
  items: z.array(note),
  nextOffset: count.nullable(),
});
export const reportingStats = z.strictObject({
  asOf: z.iso.datetime(),
  timezone: z.literal("UTC"),
  registrationDates: z.array(z.strictObject({ date: z.string(), count })),
  tickets: z.array(
    z.strictObject({
      ticketId: z.string(),
      ticketName: z.string(),
      state: z.string(),
      count,
    }),
  ),
  payments: z.array(
    z.strictObject({
      state: z.string(),
      currency: z.string(),
      count,
      amount: z.string(),
    }),
  ),
  allocations: z.array(
    z.strictObject({ currency: z.string(), count, amount: z.string() }),
  ),
  refunds: z.array(
    z.strictObject({ currency: z.string(), count, amount: z.string() }),
  ),
  activities: z.array(
    z.strictObject({
      activityId: id,
      state: z.string(),
      bookings: count,
      quantity: count,
      redeemedQuantity: count,
    }),
  ),
  checkins: z.array(stat),
  competitionEntries: z.array(stat),
  competitionAssignments: z.array(stat),
  notifications: z.array(stat),
  registrations: z.array(stat),
  submissions: z.array(stat),
  reviews: z.array(stat),
  orders: z.array(
    z.strictObject({
      state: z.string(),
      currency: z.string(),
      count,
      amount: z.string(),
    }),
  ),
});
export const exportInput = z.strictObject({
  kind: z.enum(["registrations", "submissions", "emails"]),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export const exportPage = z.strictObject({
  filename: z.string(),
  csv: z.string(),
  rows: count,
  nextOffset: count.nullable(),
});
export const authorPreviewInput = z.strictObject({
  userId: id,
  reason: z.string().trim().min(3).max(300),
});
export const authorPreview = z.strictObject({
  userId: id,
  email: z.email(),
  readOnly: z.literal(true),
  registrations: z.array(
    z.strictObject({
      id,
      number: z.string(),
      state: z.string(),
      badgeName: z.string(),
    }),
  ),
  submissions: z.array(
    z.strictObject({
      id,
      number: z.string(),
      state: z.string(),
      title: z.string(),
      version: count,
    }),
  ),
  results: z.array(
    z.strictObject({
      submissionId: id,
      outcome: z.string(),
      authorMessage: z.string(),
      authorComments: z.array(z.string()),
      publishedAt: z.iso.datetime(),
    }),
  ),
  truncated: z.boolean(),
});
export const reportingEndpoints = {
  notificationList: {
    method: "get",
    path: "/api/notifications",
    input: page,
    output: notificationPage,
  },
  notificationRead: {
    method: "post",
    path: "/api/notifications/read",
    input: z.strictObject({ id }),
    output: z.strictObject({ read: z.literal(true) }),
  },
  reportingStats: {
    method: "get",
    path: "/api/reporting/stats",
    input: z.strictObject({}),
    output: reportingStats,
  },
  reportingExport: {
    method: "post",
    path: "/api/reporting/export",
    input: exportInput,
    output: exportPage,
  },
  authorPreview: {
    method: "post",
    path: "/api/reporting/author-preview",
    input: authorPreviewInput,
    output: authorPreview,
  },
} as const;
export type NotificationPage = z.infer<typeof notificationPage>;
export type ReportingStats = z.infer<typeof reportingStats>;
export type ExportPage = z.infer<typeof exportPage>;
export type AuthorPreview = z.infer<typeof authorPreview>;
