import type { PoolClient, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { registrationConfigResult, registrationSchema, type RegistrationConfig, type RegistrationInput } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
type Db=PoolClient|Pool;
export async function configuration(db:Db) {
 const row=(await db.query<{version:number|null;document:unknown}>(`SELECT s.version,v.document FROM confsys.registration_state s LEFT JOIN confsys.registration_config_versions v ON v.version=s.version`)).rows[0];
 return registrationConfigResult.parse({version:row?.version??0,document:row?.document??null});
}
export async function lockConfiguration(db:PoolClient) {await db.query('SELECT singleton FROM confsys.registration_state FOR UPDATE');}
export async function saveConfiguration(db:PoolClient,document:RegistrationConfig,version:number,actor:string) {
 await db.query('INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,$2,$3)',[version,JSON.stringify(document),actor]);
 await db.query('UPDATE confsys.registration_state SET version=$1',[version]);
}
export async function context(db:PoolClient,actor:string,admin:boolean) {await db.query("SELECT set_config('app.actor_id',$1,true),set_config('app.registration_admin',$2,true)",[actor,String(admin)]);}
const projection=`SELECT r.id,r.number::text,r.state,r.ticket_name AS "ticketName",r.badge_name AS "badgeName",r.affiliation,r.config_version AS "configVersion",r.answers,r.created_at,
 CASE WHEN o.id IS NULL THEN null ELSE jsonb_build_object('id',o.id,'state',o.state,'amount',o.amount::text,'currency',o.currency,'paid','0','refunded','0') END AS "order"
 FROM confsys.registrations r LEFT JOIN confsys.orders o ON o.registration_id=r.id`;
function dto(row:Record<string,unknown>) {const {created_at,...rest}=row;return registrationSchema.parse({...rest,createdAt:(created_at as Date).toISOString()});}
export async function detail(db:Db,id:string) {const row=(await db.query(`${projection} WHERE r.id=$1`,[id])).rows[0];if(!row) throw new AuthError('NOT_FOUND');return dto(row);}
export async function list(db:Db,offset:number,owner?:string) {const rows=(await db.query(`${projection} WHERE ($2::uuid IS NULL OR r.user_id=$2) ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET $1`,[offset,owner??null])).rows;return {items:rows.slice(0,20).map(dto),nextOffset:rows.length>20?offset+20:null};}
export async function prior(db:Db,owner:string,key:string) {return (await db.query<{id:string;request_hash:string}>('SELECT id,request_hash FROM confsys.registrations WHERE user_id=$1 AND idempotency_key=$2',[owner,key])).rows[0];}
export async function hasActive(db:Db,owner:string) {return !!(await db.query("SELECT id FROM confsys.registrations WHERE user_id=$1 AND state<>'cancelled'",[owner])).rowCount;}
export async function capacity(db:Db,ticket:string) {return (await db.query<{used:number}>('SELECT used FROM confsys.registration_capacity WHERE ticket_id=$1',[ticket])).rows[0]?.used??0;}
export async function create(db:PoolClient,owner:string,input:RegistrationInput,document:RegistrationConfig,ticket:RegistrationConfig['tickets'][number],amount:string,state:'confirmed'|'waitlisted',hash:string) {
 const id=randomUUID();
 await db.query('INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,owner,input.configVersion,ticket.id,ticket.name,state,input.badgeName,input.affiliation,JSON.stringify(input.answers),document.consent,input.idempotencyKey,hash]);
 if(state==='confirmed') {
 const order=randomUUID();
 await db.query("INSERT INTO confsys.orders(id,registration_id,user_id,state,amount,currency) VALUES($1,$2,$3,'open',$4,$5)",[order,id,owner,amount,document.currency]);
 await db.query('INSERT INTO confsys.order_items(id,order_id,description,amount,price_snapshot) VALUES($1,$2,$3,$4,$5)',[randomUUID(),order,ticket.name,amount,JSON.stringify({version:input.configVersion,ticket,currency:document.currency})]);
 }
 return detail(db,id);
}
export async function cancel(db:PoolClient,id:string) {await db.query("UPDATE confsys.registrations SET state='cancelled' WHERE id=$1",[id]);await db.query("UPDATE confsys.orders SET state='cancelled' WHERE registration_id=$1",[id]);return detail(db,id);}
