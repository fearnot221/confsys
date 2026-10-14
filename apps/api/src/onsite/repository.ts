import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { onsitePerson, onsiteCheckin, onsiteRedemption } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export async function registration(db:PoolClient,id:string) {
 const row=(await db.query<{id:string;user_id:string;number:string;badge_name:string;affiliation:string;state:string;settled:boolean}>(`SELECT r.id,r.user_id,r.number::text,r.badge_name,r.affiliation,r.state,coalesce(s.settled,false) AS settled FROM confsys.registrations r LEFT JOIN confsys.orders o ON o.registration_id=r.id AND o.kind='registration' LEFT JOIN confsys.order_settlement_status s ON s.order_id=o.id WHERE r.id=$1`,[id])).rows[0];
 if(!row)throw new AuthError("NOT_FOUND");return row;
}
export async function tokenForRegistration(db:PoolClient,id:string) {return(await db.query<{registration_id:string;token_id:string;token_hash:string}>("SELECT registration_id,token_id,token_hash FROM confsys.onsite_tokens WHERE registration_id=$1",[id])).rows[0];}
export async function tokenByHash(db:PoolClient,hash:string) {const row=(await db.query<{registration_id:string;token_id:string;token_hash:string}>("SELECT registration_id,token_id,token_hash FROM confsys.onsite_tokens WHERE token_hash=$1",[hash])).rows[0];if(!row)throw new AuthError("NOT_FOUND");return row;}
export async function saveToken(db:PoolClient,registrationId:string,tokenId:string,hash:string) {await db.query("INSERT INTO confsys.onsite_tokens(registration_id,token_id,token_hash) VALUES($1,$2,$3) ON CONFLICT(registration_id) DO UPDATE SET token_id=excluded.token_id,token_hash=excluded.token_hash,created_at=now()",[registrationId,tokenId,hash]);}
export async function currentCheckin(db:PoolClient,id:string) {return(await db.query<{id:string;created_at:Date}>("SELECT id,created_at FROM confsys.onsite_checkins WHERE registration_id=$1 AND active",[id])).rows[0];}
export async function person(db:PoolClient,id:string) {
 const r=await registration(db,id),checkin=await currentCheckin(db,id);
 const bookings=(await db.query<{id:string;label:string;meal_type:string;quantity:number;redeemed:number;eligible:boolean}>(`SELECT b.id,b.snapshot->>'name' AS label,b.meal_type,b.quantity,coalesce((SELECT sum(x.quantity) FROM confsys.onsite_redemptions x WHERE x.booking_id=b.id AND x.active),0)::integer AS redeemed,(b.state='reserved' AND coalesce(s.settled,false)) AS eligible FROM confsys.activity_bookings b LEFT JOIN confsys.order_settlement_status s ON s.order_id=b.order_id WHERE b.registration_id=$1 ORDER BY b.created_at,b.id`,[id])).rows;
 return onsitePerson.parse({registrationId:r.id,number:r.number,badgeName:r.badge_name,affiliation:r.affiliation,eligible:r.state==="confirmed"&&r.settled,checkinId:checkin?.id??null,checkedInAt:checkin?.created_at.toISOString()??null,bookings:bookings.map(b=>({id:b.id,label:b.label,mealType:b.meal_type,quantity:b.quantity,redeemed:b.redeemed,eligible:b.eligible&&r.state==="confirmed"}))});
}
export async function directory(db:PoolClient,search:string,offset:number) {
 const ids=(await db.query<{id:string}>("SELECT id FROM confsys.registrations WHERE position(lower($1) in lower(badge_name||' '||number::text))>0 ORDER BY number LIMIT 21 OFFSET $2",[search,offset])).rows;
 const items=[];for(const row of ids.slice(0,20))items.push(await person(db,row.id));
 return {items,nextOffset:ids.length>20?offset+20:null};
}
function projectCheckin(row:{id:string;registration_id:string;active:boolean;created_at:Date}) {return onsiteCheckin.parse({id:row.id,registrationId:row.registration_id,active:row.active,createdAt:row.created_at.toISOString()});}
export async function checkinByKey(db:PoolClient,key:string) {const row=(await db.query<{id:string;registration_id:string;active:boolean;created_at:Date}>("SELECT id,registration_id,active,created_at FROM confsys.onsite_checkins WHERE idempotency_key=$1",[key])).rows[0];return row?projectCheckin(row):null;}
export async function checkinById(db:PoolClient,id:string) {const row=(await db.query<{id:string;registration_id:string;active:boolean;created_at:Date}>("SELECT id,registration_id,active,created_at FROM confsys.onsite_checkins WHERE id=$1",[id])).rows[0];if(!row)throw new AuthError("NOT_FOUND");return projectCheckin(row);}
export async function createCheckin(db:PoolClient,registrationId:string,actor:string,key:string) {const id=randomUUID();await db.query("INSERT INTO confsys.onsite_checkins(id,registration_id,actor_id,idempotency_key) VALUES($1,$2,$3,$4)",[id,registrationId,actor,key]);return checkinById(db,id);}
export async function redemptionById(db:PoolClient,id:string) {const row=(await db.query<{id:string;booking_id:string;quantity:number;active:boolean;created_at:Date}>("SELECT id,booking_id,quantity,active,created_at FROM confsys.onsite_redemptions WHERE id=$1",[id])).rows[0];if(!row)throw new AuthError("NOT_FOUND");return onsiteRedemption.parse({id:row.id,bookingId:row.booking_id,quantity:row.quantity,active:row.active,createdAt:row.created_at.toISOString()});}
export async function redemptionByKey(db:PoolClient,key:string) {return(await db.query<{id:string;request_hash:string}>("SELECT id,request_hash FROM confsys.onsite_redemptions WHERE idempotency_key=$1",[key])).rows[0];}
export async function createRedemption(db:PoolClient,bookingId:string,quantity:number,actor:string,key:string,hash:string) {const id=randomUUID();await db.query("INSERT INTO confsys.onsite_redemptions(id,booking_id,quantity,actor_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)",[id,bookingId,quantity,actor,key,hash]);return redemptionById(db,id);}
export async function undo(db:PoolClient,kind:"checkin"|"redemption",id:string,actor:string,reason:string) {
 const current=kind==="checkin"?await checkinById(db,id):await redemptionById(db,id);
 if(!current.active)return false;
 if(kind==="checkin") {await db.query("INSERT INTO confsys.onsite_checkin_reversals(checkin_id,actor_id,reason) VALUES($1,$2,$3)",[id,actor,reason]);await db.query("UPDATE confsys.onsite_checkins SET active=false WHERE id=$1",[id]);}
 else {await db.query("INSERT INTO confsys.onsite_redemption_reversals(redemption_id,actor_id,reason) VALUES($1,$2,$3)",[id,actor,reason]);await db.query("UPDATE confsys.onsite_redemptions SET active=false WHERE id=$1",[id]);}
 return true;
}
export async function audit(db:PoolClient,actor:string,id:string,event:string,reason:string,requestId:string) {await db.query("INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session',$4,$5,$6)",[randomUUID(),event,actor,reason,{resourceId:id},requestId]);}
