import {badgeTemplate} from "./badge-template.js";
import {z} from "zod";
export const badgeJobSnapshot=z.strictObject({template:badgeTemplate.optional(),conferenceName:z.string().min(1).max(160),badges:z.array(z.strictObject({registrationId:z.uuid(),tokenId:z.uuid(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().max(160),affiliation:z.string().max(300),registrationNumber:z.string().max(30)})).min(1).max(100)});
export const documentJob=z.strictObject({id:z.uuid(),kind:z.literal("badges"),status:z.enum(["pending","processing","ready","failed","cancelled"]),count:z.number().int(),attempts:z.number().int(),resultCode:z.string().nullable(),createdAt:z.iso.datetime(),completedAt:z.iso.datetime().nullable()});
export type DocumentJob=z.infer<typeof documentJob>;
export const documentJobCreateInput=z.strictObject({registrationIds:z.array(z.uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),idempotencyKey:z.uuid()});
export const documentJobList=z.strictObject({items:z.array(documentJob),nextOffset:z.number().int().nullable()});
export const documentJobEndpoints={documentJobCreate:{method:"post",path:"/api/document-jobs",input:documentJobCreateInput,output:documentJob},documentJobList:{method:"get",path:"/api/document-jobs",input:z.strictObject({offset:z.coerce.number().int().min(0).max(100000).default(0)}),output:documentJobList}} as const;
