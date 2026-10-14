import { z } from "zod";
import { minorAmount } from "./registration.js";
const name = z.string().trim().min(1).max(160),
  reason = z.string().trim().min(3).max(300);
export const receiptBuyer = z.strictObject({
  buyerName: name,
  buyerTaxId: z.string().trim().max(30),
  buyerAddress: z.string().trim().max(300),
});
export const receiptSnapshotSchema = receiptBuyer.extend({
  schemaVersion: z.literal(1),
  conferenceName: name,
  number: z.string(),
  revision: z.number().int().positive(),
  issuedAt: z.iso.datetime(),
  registrationNumber: z.string(),
  attendeeName: name,
  amount: minorAmount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  reissuedFromNumber: z.string().optional(),
  items: z
    .array(
      z.strictObject({ description: z.string().max(300), amount: minorAmount }),
    )
    .min(1)
    .max(100),
});
export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>;
export const receiptSchema = z.strictObject({
  id: z.uuid(),
  orderId: z.uuid(),
  state: z.enum(["issued", "void"]),
  currentRevision: z.number().int().positive(),
  snapshot: receiptSnapshotSchema,
  voidReason: z.string().nullable(),
  reissuedFrom: z
    .strictObject({ id: z.uuid(), number: z.string() })
    .nullable()
    .default(null),
  replacedBy: z
    .strictObject({ id: z.uuid(), number: z.string() })
    .nullable()
    .default(null),
  reissueReason: z.string().nullable().default(null),
});
export type Receipt = z.infer<typeof receiptSchema>;
export const receiptList = z.strictObject({
  items: z.array(receiptSchema),
  nextOffset: z.number().int().nullable(),
});
export const receiptIssueInput = receiptBuyer.extend({
  orderId: z.uuid(),
  reason,
});
export const receiptCorrectInput = receiptBuyer.extend({
  receiptId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  reason,
});
export const receiptReissueInput = receiptCorrectInput;
export const receiptDetailInput = z.strictObject({ id: z.uuid() });
export const receiptVoidInput = z.strictObject({
  receiptId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  reason,
});
export const receiptListInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const receiptHistorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        revision: z.number().int().positive(),
        snapshot: receiptSnapshotSchema,
        reason,
        createdAt: z.iso.datetime(),
      }),
    )
    .max(100),
});
export const receiptEndpoints = {
  receiptDetail: {
    method: "get",
    path: "/api/receipts/detail",
    input: receiptDetailInput,
    output: receiptSchema,
  },
  receiptReissue: {
    method: "post",
    path: "/api/receipts/reissue",
    input: receiptReissueInput,
    output: receiptSchema,
  },
  receiptMine: {
    method: "get",
    path: "/api/receipts/mine",
    input: receiptListInput,
    output: receiptList,
  },
  receiptAdmin: {
    method: "get",
    path: "/api/receipts/admin",
    input: receiptListInput,
    output: receiptList,
  },
  receiptIssue: {
    method: "post",
    path: "/api/receipts/issue",
    input: receiptIssueInput,
    output: receiptSchema,
  },
  receiptCorrect: {
    method: "post",
    path: "/api/receipts/correct",
    input: receiptCorrectInput,
    output: receiptSchema,
  },
  receiptVoid: {
    method: "post",
    path: "/api/receipts/void",
    input: receiptVoidInput,
    output: receiptSchema,
  },
} as const;
