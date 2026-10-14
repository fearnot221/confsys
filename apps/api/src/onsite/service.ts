import {randomUUID} from "node:crypto";
import QRCode from "qrcode";
import type {Pool,PoolClient} from "pg";
import type {ApiConfig} from "@confsys/config";
import {withIdentityTransaction} from "@confsys/db";
import {onsitePass,onsitePassInput,onsiteLookupInput,onsiteCheckinInput,onsiteRedeemInput,onsiteUndoInput,type Permission} from "@confsys/contracts";
import {lockAccessShared,rolesFor} from "../access/repository.js";
import {requirePermission} from "../access/policy.js";
import {sessionActor} from "../auth/session.js";
import {AuthError} from "../auth/errors.js";
import {passHash,passToken} from "./token.js";
import * as repo from "./repository.js";
export function createOnsiteService(pool:Pool,config:ApiConfig) {
 const authorized=<T>(raw:string|undefined,permission:Permission|null,work:(db:PoolClient,actor:string)=>Promise<T>)=>withIdentityTransaction(pool,async db=>{
  await lockAccessShared(db);const actor=await sessionActor(db,raw,config,new Date(),true);
  if(permission)requirePermission(await rolesFor(db,actor.id),permission);
  await db.query("SELECT set_config('app.actor_id',$1,true),set_config('app.onsite_admin',$2,true)",[actor.id,String(permission!==null)]);
  return work(db,actor.id);
 });
 const lock=(db:PoolClient)=>db.query("SELECT singleton FROM confsys.registration_state FOR UPDATE");
 async function resolve(db:PoolClient,token:string) {
  const row=await repo.tokenByHash(db,passHash(token));
  if(passHash(passToken(row.token_id,config.QR_SIGNING_KEY))!==row.token_hash)throw new AuthError("NOT_FOUND");
  return row.registration_id;
 }
 return {
  pass(raw:string|undefined,input:unknown,requestId:string) {
   const data=onsitePassInput.parse(input);
   return authorized(raw,null,async(db,actor)=>{
    await lock(db);const r=await repo.registration(db,data.registrationId);
    if(r.user_id!==actor)throw new AuthError("NOT_FOUND");
    if(r.state!=="confirmed")throw new AuthError("CONFLICT");
    let saved=await repo.tokenForRegistration(db,r.id);
    if(!saved||data.rotate||saved.token_hash!==passHash(passToken(saved.token_id,config.QR_SIGNING_KEY))) {
     const tokenId=randomUUID(),hash=passHash(passToken(tokenId,config.QR_SIGNING_KEY));await repo.saveToken(db,r.id,tokenId,hash);
     saved={registration_id:r.id,token_id:tokenId,token_hash:hash};
     await repo.audit(db,actor,r.id,"onsite.pass.issued",data.rotate?"Rotated onsite pass":"Issued onsite pass",requestId);
    }
    const checkin=await repo.currentCheckin(db,r.id);
    return onsitePass.parse({registrationId:r.id,number:r.number,badgeName:r.badge_name,affiliation:r.affiliation,token:passToken(saved.token_id,config.QR_SIGNING_KEY),qrPath:`/api/onsite/qr/${r.id}`,checkedInAt:checkin?.created_at.toISOString()??null});
   });
  },
  async qr(raw:string|undefined,id:string) {
   const token=await authorized(raw,null,async(db,actor)=>{const r=await repo.registration(db,id);if(r.user_id!==actor||r.state!=="confirmed")throw new AuthError("NOT_FOUND");const row=await repo.tokenForRegistration(db,id);if(!row||row.token_hash!==passHash(passToken(row.token_id,config.QR_SIGNING_KEY)))throw new AuthError("NOT_FOUND");return passToken(row.token_id,config.QR_SIGNING_KEY);});
   const bytes=await QRCode.toBuffer(token,{type:"png",width:320,margin:4,errorCorrectionLevel:"M"});
   return authorized(raw,null,async(db,actor)=>{const r=await repo.registration(db,id),row=await repo.tokenForRegistration(db,id);if(r.user_id!==actor||r.state!=="confirmed"||row?.token_hash!==passHash(token))throw new AuthError("NOT_FOUND");return bytes;});
  },
  directory(raw:string|undefined,search:string,offset:number){return authorized(raw,"onsite.read",db=>repo.directory(db,search,offset));},
  lookup(raw:string|undefined,input:unknown){const data=onsiteLookupInput.parse(input);return authorized(raw,"onsite.read",async db=>repo.person(db,await resolve(db,data.token)));},
  checkin(raw:string|undefined,input:unknown,requestId:string) {
   const data=onsiteCheckinInput.parse(input);return authorized(raw,"onsite.checkin",async(db,actor)=>{
    await lock(db);const id=await resolve(db,data.token),previous=await repo.checkinByKey(db,data.idempotencyKey);
    if(previous){if(previous.registrationId!==id)throw new AuthError("CONFLICT");return previous;}
    const person=await repo.person(db,id);if(!person.eligible)throw new AuthError("CONFLICT");
    if(person.checkinId)return repo.checkinById(db,person.checkinId);
    const result=await repo.createCheckin(db,id,actor,data.idempotencyKey);await repo.audit(db,actor,result.id,"onsite.checked_in","Checked in",requestId);return result;
   });
  },
  redeem(raw:string|undefined,input:unknown,requestId:string) {
   const data=onsiteRedeemInput.parse(input);return authorized(raw,"onsite.redeem",async(db,actor)=>{
    await lock(db);const id=await resolve(db,data.token),hash=passHash(JSON.stringify([id,data.bookingId,data.quantity])),previous=await repo.redemptionByKey(db,data.idempotencyKey);
    if(previous){if(previous.request_hash!==hash)throw new AuthError("CONFLICT");return repo.redemptionById(db,previous.id);}
    const person=await repo.person(db,id),booking=person.bookings.find(b=>b.id===data.bookingId);
    if(!person.eligible||!booking?.eligible||booking.redeemed+data.quantity>booking.quantity)throw new AuthError("CONFLICT");
    const result=await repo.createRedemption(db,booking.id,data.quantity,actor,data.idempotencyKey,hash);await repo.audit(db,actor,result.id,"onsite.redeemed","Redeemed booking quantity",requestId);return result;
   });
  },
  undo(raw:string|undefined,input:unknown,requestId:string) {
   const data=onsiteUndoInput.parse(input);return authorized(raw,"onsite.undo",async(db,actor)=>{await lock(db);if(await repo.undo(db,data.kind,data.id,actor,data.reason))await repo.audit(db,actor,data.id,`onsite.${data.kind}.reversed`,data.reason,requestId);return {ok:true as const};});
  },
 };
}
