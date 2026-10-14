import {z} from 'zod';
import {minorAmount} from './registration.js';
const reason=z.string().trim().min(3).max(300);
export const paymentInput=z.strictObject({idempotencyKey:z.uuid(),amount:minorAmount.refine(v=>BigInt(v)>0n),currency:z.string().regex(/^[A-Z]{3}$/),reference:z.string().trim().min(3).max(100),evidenceFileId:z.uuid().nullable()});
export const paymentSchema=z.strictObject({id:z.uuid(),state:z.enum(['submitted','verified','rejected']),amount:minorAmount,currency:z.string(),reference:z.string(),createdAt:z.iso.datetime(),allocated:minorAmount,refunded:minorAmount});
export type Payment=z.infer<typeof paymentSchema>;
export const allocationSchema=z.strictObject({id:z.uuid(),paymentId:z.uuid(),orderId:z.uuid(),amount:minorAmount,refunded:minorAmount});
export const financeOrderSchema=z.strictObject({id:z.uuid(),registrationNumber:z.string(),badgeName:z.string(),state:z.enum(['open','cancelled']),amount:minorAmount,currency:z.string(),paid:minorAmount,refunded:minorAmount});
export type FinanceOrder=z.infer<typeof financeOrderSchema>;
export const financePage=z.strictObject({offset:z.coerce.number().int().min(0).max(100000).default(0),scope:z.enum(['own','admin']).default('own')});
export const financeDashboard=z.strictObject({payments:z.array(paymentSchema),orders:z.array(financeOrderSchema),allocations:z.array(allocationSchema),nextOffset:z.number().int().nullable()});
export const paymentVerifyInput=z.strictObject({id:z.uuid(),action:z.enum(['verify','reject']),reason});
export const paymentAllocateInput=z.strictObject({idempotencyKey:z.uuid(),paymentId:z.uuid(),orderId:z.uuid(),amount:minorAmount.refine(v=>BigInt(v)>0n),reason});
export const refundInput=z.strictObject({idempotencyKey:z.uuid(),allocationId:z.uuid(),amount:minorAmount.refine(v=>BigInt(v)>0n),reference:z.string().trim().min(3).max(100),reason});
export const payerGrantInput=z.strictObject({orderId:z.uuid(),payerEmail:z.email().max(254),remove:z.boolean()});
export const financeResult=z.strictObject({id:z.uuid(),changed:z.boolean()});
export const financeEndpoints={
 financeDashboard:{method:'get',path:'/api/finance/dashboard',input:financePage,output:financeDashboard},
 paymentSubmit:{method:'post',path:'/api/finance/payments',input:paymentInput,output:paymentSchema},
 paymentVerify:{method:'post',path:'/api/finance/verify',input:paymentVerifyInput,output:paymentSchema},
 paymentAllocate:{method:'post',path:'/api/finance/allocate',input:paymentAllocateInput,output:financeResult},
 paymentRefund:{method:'post',path:'/api/finance/refund',input:refundInput,output:financeResult},
 payerGrant:{method:'post',path:'/api/finance/payer',input:payerGrantInput,output:financeResult},
} as const;
