import { z } from 'zod';
const count=z.number().int().nonnegative();
export const notificationBatchInput=z.strictObject({idempotencyKey:z.uuid(),recipientIds:z.array(z.uuid()).min(1).max(100).refine(v=>new Set(v).size===v.length),subject:z.string().trim().min(1).max(200).refine(v=>!/[\r\n]/.test(v)),text:z.string().trim().min(1).max(4000)});
export const notificationBatch=z.strictObject({id:z.uuid(),subject:z.string(),text:z.string(),recipientCount:count,createdAt:z.iso.datetime(),cancelledAt:z.iso.datetime().nullable(),statuses:z.array(z.strictObject({status:z.enum(['pending','processing','accepted','failed','unknown','cancelled']),count}))});
export const notificationBatchPage=z.strictObject({items:z.array(notificationBatch),nextOffset:count.nullable()});
export const notificationBatchEndpoints={
 notificationBatchList:{method:'get',path:'/api/notifications/batches',input:z.strictObject({offset:z.coerce.number().int().min(0).max(1000000).default(0)}),output:notificationBatchPage},
 notificationBatchCreate:{method:'post',path:'/api/notifications/batches',input:notificationBatchInput,output:notificationBatch},
 notificationBatchCancel:{method:'post',path:'/api/notifications/batches/cancel',input:z.strictObject({id:z.uuid()}),output:notificationBatch},
} as const;
export type NotificationBatch=z.infer<typeof notificationBatch>;
export type NotificationBatchPage=z.infer<typeof notificationBatchPage>;
