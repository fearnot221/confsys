import { z } from 'zod';
export const exportJobInput=z.strictObject({purpose:z.string().trim().min(3).max(300),kind:z.enum(['registrations','submissions','emails']),idempotencyKey:z.uuid()});
export const exportJobSchema=z.strictObject({purpose:z.string(),id:z.uuid(),kind:z.enum(['registrations','submissions','emails']),status:z.enum(['pending','processing','ready','failed','cancelled','expired']),resultCode:z.string().nullable(),rows:z.string().nullable(),snapshotAt:z.iso.datetime().nullable(),createdAt:z.iso.datetime(),completedAt:z.iso.datetime().nullable(),expiresAt:z.iso.datetime()});
export const exportJobsPage=z.strictObject({items:z.array(exportJobSchema),nextOffset:z.number().int().nullable()});
export const exportJobEndpoints={
 exportJobList:{method:'get',path:'/api/reporting/export-jobs',input:z.strictObject({offset:z.coerce.number().int().min(0).max(1000000).default(0)}),output:exportJobsPage},
 exportJobCreate:{method:'post',path:'/api/reporting/export-jobs',input:exportJobInput,output:exportJobSchema},
} as const;
export type ExportJob=z.infer<typeof exportJobSchema>;
