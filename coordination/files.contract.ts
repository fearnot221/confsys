import { z } from "zod";
export const filePurposes = ["manuscript", "payment_evidence", "site_media"] as const;
export const fileUploadInput = z.strictObject({
  purpose: z.enum(filePurposes),
  name: z.string().min(1).max(180).regex(/^[^\x00-\x1f\x7f/\\]+$/),
  content: z.string().min(4).max(11184812).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const fileAssetSchema = z.strictObject({
  id: z.uuid(), purpose: z.enum(filePurposes), name: z.string(),
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  size: z.number().int().min(1).max(8388608), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["uploading", "quarantined", "ready", "rejected"]), createdAt: z.string(),
});
export type FileAsset = z.infer<typeof fileAssetSchema>;
export type FilePurpose = typeof filePurposes[number];
export const fileListSchema = z.strictObject({ items: z.array(fileAssetSchema).max(50), nextOffset: z.number().int().nullable() });
export const fileListInput = z.strictObject({ offset: z.coerce.number().int().min(0).max(100000).default(0), purpose: z.enum(filePurposes).optional() });
export const fileEndpoints = {
  filesList: {method: "get", path: "/api/files", input: fileListInput, output: fileListSchema},
  filesUpload: {method: "post", path: "/api/files", input: fileUploadInput, output: fileAssetSchema},
  filesRetry: {method: "post", path: "/api/files/:id/scan", input: z.strictObject({}), output: fileAssetSchema},
} as const;
