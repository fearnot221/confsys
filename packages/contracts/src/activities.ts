import {z} from 'zod';
import {minorAmount} from './registration.js';
export const activityDocument=z.strictObject({name:z.string().trim().min(1).max(160),kind:z.enum(['meal','banquet','activity']),startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),deadline:z.iso.datetime(),capacity:z.number().int().min(1).max(100000),amount:minorAmount,currency:z.string().regex(/^[A-Z]{3}$/),mealTypes:z.array(z.string().trim().min(1).max(80)).max(20),active:z.boolean()});
export const activitySchema=z.strictObject({id:z.uuid(),version:z.number().int().positive(),document:activityDocument,available:z.number().int().min(0)});
export const activityCatalog=z.strictObject({items:z.array(activitySchema)});
export const activitySave=z.strictObject({id:z.uuid(),expectedVersion:z.number().int().min(0),document:activityDocument,reason:z.string().trim().min(3).max(300)});
export const activityBook=z.strictObject({idempotencyKey:z.uuid(),activityId:z.uuid(),version:z.number().int().positive(),registrationId:z.uuid(),quantity:z.number().int().min(1).max(20),mealType:z.string().max(80)});
export const activityBooking=z.strictObject({id:z.uuid(),registrationId:z.uuid(),activityId:z.uuid(),quantity:z.number().int(),mealType:z.string(),state:z.enum(['reserved','cancelled']),orderId:z.uuid(),snapshot:activityDocument,createdAt:z.iso.datetime()});
export const activityBookings=z.strictObject({items:z.array(activityBooking),nextOffset:z.number().int().nullable()});
export const activityPage=z.strictObject({offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const activityCancel=z.strictObject({id:z.uuid(),reason:z.string().trim().min(3).max(300)});
export type ActivityDocument=z.infer<typeof activityDocument>;
export type ActivityBooking=z.infer<typeof activityBooking>;
export const activityEndpoints={
 activitiesCatalog:{method:'get',path:'/api/activities',output:activityCatalog},
 activitiesSave:{method:'post',path:'/api/activities/configure',input:activitySave,output:activitySchema},
 activitiesBook:{method:'post',path:'/api/activities/book',input:activityBook,output:activityBooking},
 activitiesMine:{method:'get',path:'/api/activities/mine',input:activityPage,output:activityBookings},
 activitiesAdmin:{method:'get',path:'/api/activities/admin',input:activityPage,output:activityBookings},
 activitiesCancel:{method:'post',path:'/api/activities/cancel',input:activityCancel,output:activityBooking},
} as const;
