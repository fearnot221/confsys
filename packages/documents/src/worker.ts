import {randomUUID,createHash} from "node:crypto";
import {Queue,Worker} from "bullmq";
import QRCode from "qrcode";
import type {Pool,PoolClient} from "pg";
import {diagnostic,redisOptions,type WorkerConfig} from "@confsys/config";
import {withIdentityTransaction} from "@confsys/db";
import {badgeJobSnapshot} from "@confsys/contracts";
import {permissionsFor} from "@confsys/policy";
import {renderBadges} from "./index.js";
import {passHash,passToken} from "./token.js";
const queueName="document-jobs-v1";
type Claim={id:string;snapshot:unknown;claim_id:string;attempts:number};
async function audit(db:PoolClient,id:string,event:string){await db.query("INSERT INTO confsys.auth_audit(id,event,event_id,request_id) VALUES($1,$2,$3,$3)",[randomUUID(),event,id]);}
async function authorized(db:PoolClient,id:string) {
 await db.query("SELECT singleton FROM confsys.access_control WHERE singleton=true FOR SHARE");
 const row=(await db.query<{requester_active:boolean;roles:string[];tokens_current:boolean}>("SELECT requester_active,roles,tokens_current FROM confsys.document_job_eligibility WHERE id=$1",[id])).rows[0];
 return !!row&&row.requester_active&&row.tokens_current&&permissionsFor(row.roles).includes("onsite.read");
}
export async function recoverDocumentJobs(pool:Pool) {
 await pool.query("UPDATE confsys.document_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,result_code='LEASE_EXPIRED',claim_id=NULL,lease_until=NULL WHERE status='processing' AND lease_until<now()");
}
export async function processDocumentJob(pool:Pool,config:Pick<WorkerConfig,"QR_SIGNING_KEY">,id:string) {
 const claim=await withIdentityTransaction(pool,async db=>{
  if(!await authorized(db,id)){await db.query("UPDATE confsys.document_jobs SET status='cancelled',result_code='INELIGIBLE',completed_at=now() WHERE id=$1 AND status='pending'",[id]);return null;}
  return(await db.query<Claim>("UPDATE confsys.document_jobs SET status='processing',claim_id=$2,lease_until=now()+interval '120 seconds',attempts=attempts+1,result_code=NULL WHERE id=$1 AND status='pending' AND attempts<3 RETURNING id,snapshot,claim_id,attempts",[id,randomUUID()])).rows[0]??null;
 });
 if(!claim)return;
 try {
  const snapshot=badgeJobSnapshot.parse(claim.snapshot),badges=[];
  for(const badge of snapshot.badges){const token=passToken(badge.tokenId,config.QR_SIGNING_KEY);if(passHash(token)!==badge.tokenHash)throw new Error("KEY_ROTATED");badges.push({conferenceName:snapshot.conferenceName,name:badge.name,affiliation:badge.affiliation,registrationNumber:badge.registrationNumber,qrPng:await QRCode.toBuffer(token,{type:"png",width:320,margin:4,errorCorrectionLevel:"M"})});}
  const pdf=await renderBadges(badges);if(pdf.byteLength>16_777_216)throw new Error("OUTPUT_TOO_LARGE");
  await withIdentityTransaction(pool,async db=>{
   const allowed=await authorized(db,id);
   const changed=await db.query("UPDATE confsys.document_jobs SET status=$3,result_code=$4,pdf=$5,sha256=$6,completed_at=now(),lease_until=NULL WHERE id=$1 AND claim_id=$2 AND status='processing'",[id,claim.claim_id,allowed?"ready":"cancelled",allowed?null:"INELIGIBLE",allowed?pdf:null,allowed?createHash("sha256").update(pdf).digest("hex"):null]);
   if(changed.rowCount)await audit(db,id,allowed?"document.ready":"document.cancelled");
  });
 }catch(error){
  // Persist only a bounded diagnostic code. Renderer errors may contain display text.
  const code=error instanceof Error&&error.message==="KEY_ROTATED"?"KEY_ROTATED":error instanceof Error&&error.message==="OUTPUT_TOO_LARGE"?"OUTPUT_TOO_LARGE":"RENDER_FAILED";
  await pool.query("UPDATE confsys.document_jobs SET status='failed',result_code=$3,completed_at=now(),lease_until=NULL WHERE id=$1 AND claim_id=$2 AND status='processing'",[id,claim.claim_id,code]);
 }
}
export async function dispatchDocumentJobs(pool:Pool,queue:Queue) {
 await recoverDocumentJobs(pool);
 const rows=(await pool.query<{id:string}>("SELECT id FROM confsys.document_jobs WHERE status='pending' ORDER BY created_at LIMIT 25")).rows;
 for(const row of rows)await queue.add("badges",{id:row.id},{jobId:row.id,removeOnComplete:true,removeOnFail:true,attempts:1});
}
export function startDocumentWorker(pool:Pool,config:WorkerConfig,name=queueName) {
 const queue=new Queue(name,{connection:redisOptions(config.REDIS_URL)}),worker=new Worker(name,async job=>{const data:unknown=job.data;if(job.name!=="badges"||!data||typeof data!=="object"||!("id" in data)||typeof data.id!=="string"||!/^[0-9a-f-]{36}$/.test(data.id)||Object.keys(data).length!==1)throw new Error("Invalid document job reference");await processDocumentJob(pool,config,data.id);},{connection:redisOptions(config.REDIS_URL),concurrency:1});
 queue.on("error",()=>diagnostic("document-dispatcher","queue_unavailable"));worker.on("error",()=>diagnostic("document-worker","queue_unavailable"));worker.on("failed",job=>diagnostic("document-worker","job_failed",job?.id?{eventId:job.id}:{}));
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>=Promise.resolve();
 const tick=async()=>{try{await dispatchDocumentJobs(pool,queue);}catch{diagnostic("document-dispatcher","dispatch_unavailable");}if(!stopped)timer=setTimeout(()=>{inFlight=tick();},1000);};inFlight=tick();
 return {worker,async close(){stopped=true;if(timer)clearTimeout(timer);await inFlight;await worker.close();await queue.close();}};
}
