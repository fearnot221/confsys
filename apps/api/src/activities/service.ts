import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {ApiConfig} from '@confsys/config';
import {activitySave,activityBook,activityCancel,type Permission} from '@confsys/contracts';
import {withIdentityTransaction} from '@confsys/db';
import {enqueueBusinessNotification} from '@confsys/notifications';
import {sessionActor} from '../auth/session.js';
import {AuthError} from '../auth/errors.js';
import {lockAccessShared,rolesFor,recordAccess} from '../access/repository.js';
import {permissionsFor,requirePermission,assertRecentPassword} from '../access/policy.js';
import {context,lockConfiguration} from '../registration/repository.js';
import {effectivePublicSite} from '../site/branding.js';
import * as repo from './repository.js';
import {assertActivityCancellationAllowed} from './cancellation.js';
export function createActivitiesService(pool:Pool,config:ApiConfig){
 const authorized=<T>(raw:string|undefined,permission:Permission|null,work:(db:PoolClient,actor:string,admin:boolean)=>Promise<T>)=>withIdentityTransaction(pool,async db=>{await lockAccessShared(db);const actor=await sessionActor(db,raw,config,new Date(),true),roles=await rolesFor(db,actor.id),admin=permissionsFor(roles).includes('registration.manage');if(permission){requirePermission(roles,permission);if(permission==='registration.configure')assertRecentPassword(actor.passwordVerifiedAt,new Date());}await context(db,actor.id,admin);await lockConfiguration(db);return work(db,actor.id,admin);});
 const audit=(db:PoolClient,actor:string,event:string,id:string,reason:string,requestId:string)=>recordAccess(db,{action:event,targetId:actor,actorId:actor,source:'session',reason,before:'',after:id,requestId});
 return {
 catalog:()=>repo.catalog(pool),
 save:(raw:string|undefined,input:unknown,requestId:string)=>{const d=activitySave.parse(input);if(Date.parse(d.document.startsAt)>=Date.parse(d.document.endsAt)||Date.parse(d.document.deadline)>Date.parse(d.document.endsAt)||new Set(d.document.mealTypes).size!==d.document.mealTypes.length)throw new AuthError('INVALID_REQUEST');return authorized(raw,'registration.configure',async(db,actor)=>{const row=(await db.query<{version:number}>('SELECT version FROM confsys.activities WHERE id=$1',[d.id])).rows[0];if((row?.version??0)!==d.expectedVersion)throw new AuthError('CONFLICT');const used=(await db.query<{used:number}>('SELECT used FROM confsys.activity_capacity WHERE activity_id=$1',[d.id])).rows[0]?.used??0;if(d.document.capacity<used)throw new AuthError('CONFLICT');const result=await repo.save(db,d.id,d.expectedVersion+1,d.document,actor);await audit(db,actor,'activity.configured',d.id,d.reason,requestId);return result;});},
 mine:(raw:string|undefined,offset:number)=>authorized(raw,null,(db,actor)=>repo.list(db,offset,actor)),
 admin:(raw:string|undefined,offset:number)=>authorized(raw,'registration.manage',db=>repo.list(db,offset)),
 book:(raw:string|undefined,input:unknown,requestId:string)=>{const d=activityBook.parse(input),hash=createHash('sha256').update(JSON.stringify(d)).digest('hex');return authorized(raw,null,async(db,actor)=>{const old=await repo.prior(db,actor,d.idempotencyKey);if(old){if(old.request_hash!==hash)throw new AuthError('CONFLICT');return repo.detail(db,old.id);}const registration=(await db.query('SELECT id FROM confsys.registrations WHERE id=$1 AND user_id=$2 AND state=\'confirmed\'',[d.registrationId,actor])).rows[0];if(!registration)throw new AuthError('NOT_FOUND');const activity=await repo.activity(db,d.activityId),doc=activity.document;if(activity.version!==d.version||!doc.active||Date.now()>=Date.parse(doc.deadline)||d.quantity>activity.available)throw new AuthError('CONFLICT');if(doc.mealTypes.length?!doc.mealTypes.includes(d.mealType):d.mealType!=='')throw new AuthError('INVALID_REQUEST');const result=await repo.book(db,actor,d,doc,hash);await audit(db,actor,'activity.booked',result.id,'Participant booking',requestId);await enqueueBusinessNotification(db,{CONFERENCE_NAME:(await effectivePublicSite(db,config.CONFERENCE_NAME)).conferenceName},{userId:actor,eventKey:`activity:${result.id}`,subject:'活動預訂已建立 / Activity reserved',text:`請登入查看活動預訂及付款狀態。\n${config.PUBLIC_APP_ORIGIN}/activities`,requestId});return result;});},
 cancel:(raw:string|undefined,input:unknown,requestId:string)=>{const d=activityCancel.parse(input);return authorized(raw,null,async(db,actor,admin)=>{const current=await repo.detail(db,d.id);if(current.state==='cancelled')return current;await assertActivityCancellationAllowed(db,{bookingId:d.id},admin);const result=await repo.cancel(db,d.id,current.orderId);await audit(db,actor,'activity.cancelled',d.id,d.reason,requestId);return result;});},
 };
}
