import {z} from 'zod';
import {notificationBatch,notificationBatchPage} from './notification-batches.js';
const page=z.strictObject({offset:z.coerce.number().int().min(0).max(1000000).default(0)});
export const financeReminderPreview=z.strictObject({items:z.array(z.strictObject({id:z.uuid(),email:z.email(),balances:z.array(z.strictObject({currency:z.string(),amount:z.string().regex(/^[0-9]+$/)}))})).max(100),total:z.number().int().nonnegative(),nextOffset:z.number().int().nullable()});
export const financeReminderCreate=z.strictObject({idempotencyKey:z.uuid(),recipientIds:z.array(z.uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),reason:z.string().trim().min(3).max(300)});
export const financeReminderEndpoints={
 financeReminderPreview:{method:'get',path:'/api/finance/reminders/audience',input:page,output:financeReminderPreview},
 financeReminderList:{method:'get',path:'/api/finance/reminders',input:page,output:notificationBatchPage},
 financeReminderCreate:{method:'post',path:'/api/finance/reminders',input:financeReminderCreate,output:notificationBatch},
 financeReminderCancel:{method:'post',path:'/api/finance/reminders/cancel',input:z.strictObject({id:z.uuid(),reason:z.string().trim().min(3).max(300)}),output:notificationBatch},
} as const;
export type FinanceReminderPreview=z.infer<typeof financeReminderPreview>;
