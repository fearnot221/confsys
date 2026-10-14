import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFilesService} from '../../apps/api/src/files/service.js';
import {createPaymentEvidenceDownload} from '../../apps/api/src/finance/evidence.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {authFixture,password} from '../helpers/auth.js';
import {createAuthService} from '../../apps/api/src/auth/service.js';
import {createRegistrationService} from '../../apps/api/src/registration/service.js';
import {createFinanceService} from '../../apps/api/src/finance/service.js';
import {withIdentityTransaction} from '@confsys/db';
const f=authFixture(),auth=createAuthService(f.app,f.config),registration=createRegistrationService(f.app,f.config),finance=createFinanceService(f.app,f.config),rid=()=>randomUUID();
async function account(role?:string){const email=f.email();await auth.requestMail('register',email,rid());await auth.consume('verify',(await f.link(email)).token,password,rid());const login=await auth.login(email,password,rid());if(role)await f.admin.query('INSERT INTO confsys.user_roles(user_id,role) VALUES($1,$2)',[login.account.user.id,role]);return {id:login.account.user.id,raw:login.raw,email};}
let admin:Awaited<ReturnType<typeof account>>,fin:Awaited<ReturnType<typeof account>>,a:Awaited<ReturnType<typeof account>>,b:Awaited<ReturnType<typeof account>>,c:Awaited<ReturnType<typeof account>>;
let evidenceRoot:string|undefined;
let oldVersion:number|null,version=0;const ticket=rid();let registrationA:string,orderA:string,paymentId:string,allocationId:string;
const doc=()=>({opensAt:new Date(Date.now()-3600000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString(),currency:'TWD',timezone:'Asia/Taipei',consent:'Synthetic conference agreement',fields:[{key:'food',label:'Preference',type:'select',required:true,options:['standard','vegetarian']}],tickets:[{id:ticket,name:'Synthetic ticket',capacity:1,waitlist:true,rates:[{startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),amount:'1000'}]}]});
const input=(key=rid())=>({idempotencyKey:key,configVersion:version,ticketId:ticket,badgeName:'合成參與者',affiliation:'Synthetic university',consent:true,answers:{food:'vegetarian'}});
beforeAll(async()=>{f.migrate();oldVersion=(await f.admin.query('SELECT version FROM confsys.registration_state')).rows[0].version;admin=await account('conference_admin');fin=await account('finance');a=await account();b=await account();c=await account();version=(await registration.configure(admin.raw,{expectedVersion:oldVersion??0,document:doc()},rid())).version;});
afterAll(async()=>{
 const users=[admin?.id,fin?.id,a?.id,b?.id,c?.id].filter(Boolean);
 await f.admin.query('DELETE FROM confsys.refunds WHERE created_by=ANY($1::uuid[])',[users]);
 await f.admin.query('DELETE FROM confsys.payment_allocations WHERE created_by=ANY($1::uuid[])',[users]);
 await f.admin.query('DELETE FROM confsys.order_payers WHERE granted_by=ANY($1::uuid[])',[users]);
 await f.admin.query('DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])',[users]);
 await f.admin.query('DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))',[users]);
 await f.admin.query('DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])',[users]);
 await f.admin.query('DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])',[users]);
 await f.admin.query('UPDATE confsys.registration_state SET version=$1',[oldVersion]);
 await f.admin.query('DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])',[users]);await f.admin.query('DELETE FROM confsys.file_references WHERE file_id IN(SELECT id FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[]))',[users]);await f.admin.query('DELETE FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[])',[users]);await f.cleanup();if(evidenceRoot)await rm(evidenceRoot,{recursive:true,force:true});
});
it('role separation, no registration inference and validated configured form',async()=>{
 expect((await registration.mine(a.raw,0)).items).toEqual([]);
 await expect(registration.admin(a.raw,0)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(finance.dashboard(admin.raw,'admin',0)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(registration.configure(fin.raw,{expectedVersion:version,document:doc()},rid())).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(registration.create(a.raw,{...input(),answers:{food:'unknown'}},rid())).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
it('concurrent last seat never oversells; replay returns same immutable order and no duplicate outbox',async()=>{
 const one=input();const values=await Promise.all([registration.create(a.raw,one,rid()),registration.create(b.raw,input(),rid())]);
 expect(values.map(v=>v.state).sort()).toEqual(['confirmed','waitlisted']);
 const owner=values[0]!.state==='confirmed'?a:b;const waiting=owner===a?b:a;
 if(owner!==a){[a,b]=[b,a];}
 const confirmed=values.find(v=>v.state==='confirmed')!;registrationA=confirmed.id;orderA=confirmed.order!.id;
 expect(confirmed.order).toMatchObject({amount:'1000',currency:'TWD',paid:'0'});
 const ownerInput=owner===waiting?one:null;expect(ownerInput).toBeNull();
 // Recover the exact submitted key from this synthetic fixture only, then exercise service replay.
 const stored=(await f.admin.query('SELECT idempotency_key FROM confsys.registrations WHERE id=$1',[registrationA])).rows[0];
 const replay=await registration.create(a.raw,input(stored.idempotency_key),rid());expect(replay).toEqual(confirmed);
 await expect(registration.create(a.raw,{...input(stored.idempotency_key),badgeName:'Changed'},rid())).rejects.toMatchObject({code:'CONFLICT'});
 expect((await f.admin.query('SELECT count(*) FROM confsys.notifications WHERE event_key=$1',[`registration:${registrationA}`])).rows[0].count).toBe('1');
 expect((await registration.mine(b.raw,0)).items[0]!.order).toBeNull();
});
it('row policies deny foreign registration/order and context never leaks to pooled requests',async()=>{
 await expect(registration.cancel(c.raw,{id:registrationA,reason:'Foreign cancellation'},rid())).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await f.app.query('SELECT * FROM confsys.registrations')).rows).toEqual([]);
 expect((await f.app.query('SELECT * FROM confsys.orders')).rows).toEqual([]);
 expect((await finance.dashboard(c.raw,'own',0)).orders).toEqual([]);
});
it('submitted proof is not payment, verified amount allocates partially, group payer needs explicit owner grant',async()=>{
 const d={idempotencyKey:rid(),amount:'1000',currency:'TWD',reference:rid(),evidenceFileId:null};
 const payment=await finance.submit(c.raw,d,rid());paymentId=payment.id;expect(payment.state).toBe('submitted');
 expect((await finance.submit(c.raw,d,rid())).id).toBe(paymentId);
 await expect(finance.verify(a.raw,{id:paymentId,action:'verify',reason:'Try forged finance'},rid())).rejects.toMatchObject({code:'FORBIDDEN'});
 await finance.verify(fin.raw,{id:paymentId,action:'verify',reason:'Synthetic bank record checked'},rid());
 const allocation={idempotencyKey:rid(),paymentId,orderId:orderA,amount:'400',reason:'Partial group payment'};
 await expect(finance.allocate(fin.raw,allocation,rid())).rejects.toMatchObject({code:'FORBIDDEN'});
 await finance.payer(a.raw,{orderId:orderA,payerEmail:c.email,remove:false},rid());
 expect((await finance.dashboard(c.raw,'own',0)).orders.map(o=>o.id)).toContain(orderA);
 const result=await finance.allocate(fin.raw,allocation,rid());allocationId=result.id;
 expect(await finance.allocate(fin.raw,allocation,rid())).toEqual({id:allocationId,changed:false});
 expect((await registration.mine(a.raw,0)).items[0]!.order!.paid).toBe('400');
});
it('parallel allocation and refund limits are PostgreSQL authoritative; refunds do not silently change registration',async()=>{
 const allocate=()=>finance.allocate(fin.raw,{idempotencyKey:rid(),paymentId,orderId:orderA,amount:'600',reason:'Complete transfer allocation'},rid());
 const outcomes=await Promise.allSettled([allocate(),allocate()]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(outcomes.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'CONFLICT'}});
 const refund={idempotencyKey:rid(),allocationId,amount:'300',reference:rid(),reason:'Synthetic refund recorded'};
 const first=await finance.refund(fin.raw,refund,rid());expect(await finance.refund(fin.raw,refund,rid())).toEqual({id:first.id,changed:false});
 await expect(finance.refund(fin.raw,{...refund,idempotencyKey:rid(),reference:rid(),amount:'101'},rid())).rejects.toMatchObject({code:'CONFLICT'});
 expect((await registration.mine(a.raw,0)).items[0]!.state).toBe('confirmed');
 expect((await registration.mine(a.raw,0)).items[0]!.order!.refunded).toBe('300');
 await registration.cancel(a.raw,{id:registrationA,reason:'Participant cancellation'},rid());
 const cancelled=(await registration.mine(a.raw,0)).items[0]!;expect(cancelled.state).toBe('cancelled');expect(cancelled.order!.refunded).toBe('300');
});
it('audit/outbox failure rolls back registration and order, actual worker has no finance privilege',async()=>{
 const trigger=rid();await f.admin.query(`CREATE FUNCTION confsys.registration_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${trigger}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`);await f.admin.query('CREATE TRIGGER registration_test_failure BEFORE INSERT ON confsys.notifications FOR EACH ROW EXECUTE FUNCTION confsys.registration_test_failure()');
 try{await expect(registration.create(c.raw,input(),trigger)).rejects.toThrow();expect((await registration.mine(c.raw,0)).items).toEqual([]);}finally{await f.admin.query('DROP TRIGGER registration_test_failure ON confsys.notifications');await f.admin.query('DROP FUNCTION confsys.registration_test_failure()');}
 await expect(f.worker.query('SELECT * FROM confsys.payments')).rejects.toMatchObject({code:'42501'});
 await expect(withIdentityTransaction(f.app,async db=>{await db.query("SELECT set_config('app.actor_id',$1,true)",[c.id]);await db.query('INSERT INTO confsys.payment_allocations(id,payment_id,order_id,amount,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,1,$4,$5,\'bad\')',[rid(),paymentId,orderA,c.id,rid()]);})).rejects.toThrow();
});
it('edits bind the original form, retain immutable history, and FIFO promotion keeps the original fee',async()=>{
 const waiting=(await registration.mine(b.raw,0)).items[0]!;
 const edited=await registration.edit(b.raw,{id:waiting.id,expectedVersion:waiting.version,badgeName:'更新合成姓名',affiliation:'New synthetic institute',answers:{food:'standard'},reason:'Participant correction'},rid());
 expect(edited.version).toBe(waiting.version+1);expect(edited.order).toBeNull();
 await expect(registration.edit(c.raw,{id:waiting.id,expectedVersion:edited.version,badgeName:'Foreign',affiliation:'',answers:{food:'standard'},reason:'Unauthorized edit'},rid())).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(registration.edit(b.raw,{id:waiting.id,expectedVersion:waiting.version,badgeName:'Stale',affiliation:'',answers:{food:'standard'},reason:'Stale version edit'},rid())).rejects.toMatchObject({code:'CONFLICT'});
 const history=await registration.history(b.raw,waiting.id);expect(history.items[0]).toMatchObject({version:edited.version,before:{badgeName:'合成參與者'},after:{badgeName:'更新合成姓名'}});
 await expect(registration.history(c.raw,waiting.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 const newDoc=doc();newDoc.tickets[0]!.rates[0]!.amount='9900';await registration.configure(admin.raw,{expectedVersion:version,document:newDoc},rid());
 const input={id:waiting.id,expectedVersion:edited.version,reason:'Promote first waiting participant'};
 await expect(registration.promote(b.raw,input,rid())).rejects.toMatchObject({code:'FORBIDDEN'});
 const outcomes=await Promise.allSettled([registration.promote(admin.raw,input,rid()),registration.promote(admin.raw,input,rid())]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 const promoted=(await registration.mine(b.raw,0)).items[0]!;expect(promoted.state).toBe('confirmed');expect(promoted.order!.amount).toBe('1000');expect(promoted.configVersion).toBe(version);
 await expect(f.app.query('UPDATE confsys.registration_price_snapshots SET amount=1')).rejects.toMatchObject({code:'42501'});
 await expect(f.app.query("UPDATE confsys.registration_changes SET reason='tamper'")).rejects.toMatchObject({code:'42501'});
 expect((await f.admin.query('SELECT count(*) FROM confsys.notifications WHERE event_key=$1',[`registration-promoted:${waiting.id}`])).rows[0].count).toBe('1');
});

it('finance can download only linked ready evidence; admin and revoked finance cannot read it',async()=>{
 evidenceRoot=await mkdtemp(join(tmpdir(),'confsys-finance-evidence-'));const storage={root:evidenceRoot,scannerHost:'127.0.0.1',scannerPort:Number(process.env.CLAMAV_PORT)},files=createFilesService(f.app,f.config,storage),download=createPaymentEvidenceDownload(f.app,f.config,storage);
 const proof=await files.upload(c.raw,{purpose:'payment_evidence',name:'synthetic-proof.png',content:'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII='},rid());expect(proof.status).toBe('ready');
 const payment=await finance.submit(c.raw,{idempotencyKey:rid(),amount:'50',currency:'TWD',reference:rid(),evidenceFileId:proof.id},rid());expect(payment.evidenceFileId).toBe(proof.id);
 const result=await download(fin.raw,payment.id,rid());expect(result.mediaType).toBe('image/png');expect(result.bytes.length).toBeGreaterThan(0);expect(result.name).not.toContain('synthetic-proof');
 for(const raw of [admin.raw,a.raw,c.raw])await expect(download(raw,payment.id,rid())).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(download(fin.raw,rid(),rid())).rejects.toMatchObject({code:'NOT_FOUND'});
 await f.admin.query("DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='finance'",[fin.id]);await expect(download(fin.raw,payment.id,rid())).rejects.toMatchObject({code:'FORBIDDEN'});
});
