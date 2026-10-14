import {z} from "zod";
export const onsiteToken=z.string().regex(/^cs1_[A-Za-z0-9_-]{43}$/);
export const onsitePass=z.strictObject({registrationId:z.uuid(),number:z.string(),badgeName:z.string(),affiliation:z.string(),token:onsiteToken,qrPath:z.string(),checkedInAt:z.iso.datetime().nullable()});
export type OnsitePass=z.infer<typeof onsitePass>;
export const onsiteBooking=z.strictObject({id:z.uuid(),label:z.string(),mealType:z.string(),quantity:z.number().int(),redeemed:z.number().int(),eligible:z.boolean()});
export const onsitePerson=z.strictObject({registrationId:z.uuid(),number:z.string(),badgeName:z.string(),affiliation:z.string(),eligible:z.boolean(),checkinId:z.uuid().nullable(),checkedInAt:z.iso.datetime().nullable(),bookings:z.array(onsiteBooking)});
export type OnsitePerson=z.infer<typeof onsitePerson>;
export const onsiteCheckin=z.strictObject({id:z.uuid(),registrationId:z.uuid(),active:z.boolean(),createdAt:z.iso.datetime()});
export const onsiteRedemption=z.strictObject({id:z.uuid(),bookingId:z.uuid(),quantity:z.number().int(),active:z.boolean(),createdAt:z.iso.datetime()});
export const onsitePassInput=z.strictObject({registrationId:z.uuid(),rotate:z.boolean().default(false)});
export const onsiteLookupInput=z.strictObject({token:onsiteToken});
export const onsiteCheckinInput=z.strictObject({token:onsiteToken,idempotencyKey:z.uuid()});
export const onsiteRedeemInput=z.strictObject({token:onsiteToken,bookingId:z.uuid(),quantity:z.number().int().min(1).max(20),idempotencyKey:z.uuid()});
export const onsiteUndoInput=z.strictObject({kind:z.enum(["checkin","redemption"]),id:z.uuid(),reason:z.string().trim().min(3).max(300)});
export const onsiteListInput=z.strictObject({search:z.string().trim().max(100).default(""),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const onsiteList=z.strictObject({items:z.array(onsitePerson),nextOffset:z.number().int().nullable()});
export const onsiteEndpoints={
 onsitePass:{method:"post",path:"/api/onsite/pass",input:onsitePassInput,output:onsitePass},
 onsiteLookup:{method:"post",path:"/api/onsite/lookup",input:onsiteLookupInput,output:onsitePerson},
 onsiteCheckin:{method:"post",path:"/api/onsite/checkin",input:onsiteCheckinInput,output:onsiteCheckin},
 onsiteRedeem:{method:"post",path:"/api/onsite/redeem",input:onsiteRedeemInput,output:onsiteRedemption},
 onsiteUndo:{method:"post",path:"/api/onsite/undo",input:onsiteUndoInput,output:z.strictObject({ok:z.literal(true)})},
 onsiteDirectory:{method:"get",path:"/api/onsite/directory",input:onsiteListInput,output:onsiteList},
} as const;
