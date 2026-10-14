import { beforeAll,afterAll,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture,password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createReceiptsService } from "../../apps/api/src/documents/service.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
const f=authFixture(),auth=createAuthService(f.app,f.config),service=createReceiptsService(f.app,f.config),access=createAccessService(f.app,f.config),rid=()=>randomUUID();
async function account(){const email=f.email();await auth.requestMail("register",email,rid());await auth.consume("verify",(await f.link(email)).token,password,rid());const l=await auth.login(email,password,rid());return{id:l.account.user.id,email,raw:l.raw};}
let owner:Awaited<ReturnType<typeof account>>,other:Awaited<ReturnType<typeof account>>,admin:Awaited<ReturnType<typeof account>>,finance:Awaited<ReturnType<typeof account>>,orderId:string,paymentId:string,version:number;
const buyer={buyerName:"國立合成研究大學",buyerTaxId:"12345678",buyerAddress:"臺北市合成路一號",reason:"Synthetic receipt issue"};
beforeAll(async()=>{
 f.migrate();owner=await account();other=await account();admin=await account();finance=await account();
 await bootstrapAdministrator(f.admin,{conferenceName:f.config.CONFERENCE_NAME,origin:f.config.PUBLIC_APP_ORIGIN},{targetId:admin.id,apply:true,reason:"Synthetic receipt bootstrap",confirmOrigin:f.config.PUBLIC_APP_ORIGIN},rid());admin.raw=(await auth.login(admin.email,password,rid())).raw;
 await access.mutate(admin.raw,finance.id,{action:"grant",role:"finance",reason:"Synthetic receipt finance role"},rid());finance.raw=(await auth.login(finance.email,password,rid())).raw;
 version=Number((await f.admin.query("SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions")).rows[0].version);
 await f.admin.query("INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,'{}',$2)",[version,admin.id]);
 const registrationId=rid();orderId=rid();paymentId=rid();
 await f.admin.query("INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'一般報名','confirmed','陳怡君','合成研究所','{}','synthetic',$5,'synthetic')",[registrationId,owner.id,version,rid(),rid()]);
 await f.admin.query("INSERT INTO confsys.orders(id,registration_id,user_id,state,amount,currency) VALUES($1,$2,$3,'open',150000,'TWD')",[orderId,registrationId,owner.id]);
 await f.admin.query("INSERT INTO confsys.order_items(id,order_id,description,amount,price_snapshot) VALUES($1,$2,'一般報名費',150000,'{}')",[rid(),orderId]);
 await f.admin.query("INSERT INTO confsys.payments(id,payer_id,state,amount,currency,reference,idempotency_key,request_hash,verified_by) VALUES($1,$2,'verified',150000,'TWD',$3,$4,'synthetic',$5)",[paymentId,owner.id,rid(),rid(),admin.id]);
});
afterAll(async()=>{
 const ids=(await f.admin.query("SELECT id FROM confsys.receipts WHERE order_id=$1",[orderId])).rows.map(r=>r.id);
 await f.admin.query("DELETE FROM confsys.receipt_voids WHERE receipt_id=ANY($1::uuid[])",[ids]);await f.admin.query("DELETE FROM confsys.receipt_revisions WHERE receipt_id=ANY($1::uuid[])",[ids]);await f.admin.query("DELETE FROM confsys.receipts WHERE id=ANY($1::uuid[])",[ids]);
 await f.admin.query("DELETE FROM confsys.payment_allocations WHERE payment_id=$1",[paymentId]);await f.admin.query("DELETE FROM confsys.payments WHERE id=$1",[paymentId]);await f.admin.query("DELETE FROM confsys.order_items WHERE order_id=$1",[orderId]);await f.admin.query("DELETE FROM confsys.orders WHERE id=$1",[orderId]);await f.admin.query("DELETE FROM confsys.registrations WHERE user_id=$1",[owner.id]);await f.admin.query("DELETE FROM confsys.registration_config_versions WHERE version=$1",[version]);await f.cleanup();
});
it("receipt issuance requires explicit permission and full verified payment; concurrent repeat gets one number/snapshot/outbox",async()=>{
 await expect(service.issue(owner.raw,{...buyer,orderId},rid())).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(service.issue(finance.raw,{...buyer,orderId},rid())).rejects.toMatchObject({code:"CONFLICT"});
 await f.admin.query("INSERT INTO confsys.payment_allocations(id,payment_id,order_id,amount,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,150000,$4,$5,'synthetic')",[rid(),paymentId,orderId,admin.id,rid()]);
 const results=await Promise.all([service.issue(finance.raw,{...buyer,orderId},rid()),service.issue(finance.raw,{...buyer,orderId},rid())]);expect(results[0]).toEqual(results[1]);
 expect(results[0]?.snapshot).toMatchObject({amount:"150000",currency:"TWD",buyerName:buyer.buyerName});
 expect((await f.admin.query("SELECT count(*) FROM confsys.notifications WHERE event_key=$1",[`receipt:${results[0]!.id}:issued`])).rows[0].count).toBe("1");
 expect((await service.list(owner.raw,0)).items).toHaveLength(1);expect((await service.list(other.raw,0)).items).toHaveLength(0);
 await expect(service.download(other.raw,results[0]!.id,1,rid())).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await f.app.query("SELECT * FROM confsys.receipts WHERE id=$1",[results[0]!.id])).rowCount).toBe(0);
 await expect(f.worker.query("SELECT * FROM confsys.receipts")).rejects.toMatchObject({code:"42501"});
});
it("corrections preserve number/amount/original snapshot, stale edits fail and historical PDFs remain downloadable",async()=>{
 const receipt=(await service.list(owner.raw,0)).items[0]!;
 const corrected=await service.correct(finance.raw,{...buyer,receiptId:receipt.id,expectedRevision:1,buyerName:"合成研究基金會",reason:"Synthetic buyer correction"},rid());
 expect(corrected.snapshot.number).toBe(receipt.snapshot.number);expect(corrected.snapshot.amount).toBe(receipt.snapshot.amount);expect(corrected.currentRevision).toBe(2);
 const history=await service.history(owner.raw,receipt.id);expect(history.items.map(r=>r.revision)).toEqual([2,1]);expect(history.items[1]?.snapshot.buyerName).toBe(buyer.buyerName);
 await expect(service.correct(finance.raw,{...buyer,receiptId:receipt.id,expectedRevision:1},rid())).rejects.toMatchObject({code:"CONFLICT"});
 const pdf=await service.download(owner.raw,receipt.id,1,rid());expect(pdf.bytes.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.name).toContain(receipt.snapshot.number);
 await expect(f.app.query("UPDATE confsys.receipt_revisions SET reason='overwrite' WHERE false")).rejects.toMatchObject({code:"42501"});
});
it("audit failure rolls back correction; void is explicit and idempotent, revoked sessions cannot download",async()=>{
 const receipt=(await service.list(owner.raw,0)).items[0]!,failure=rid();
 await f.admin.query(`CREATE FUNCTION confsys.receipt_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`);
 await f.admin.query("CREATE TRIGGER receipt_test_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.receipt_test_failure()");
 try{await expect(service.correct(finance.raw,{...buyer,receiptId:receipt.id,expectedRevision:2},failure)).rejects.toThrow();expect((await service.list(owner.raw,0)).items[0]?.currentRevision).toBe(2);}finally{await f.admin.query("DROP TRIGGER receipt_test_failure ON confsys.auth_audit");await f.admin.query("DROP FUNCTION confsys.receipt_test_failure()");}
 const input={receiptId:receipt.id,expectedRevision:2,reason:"Synthetic void reason"};const a=await service.void(finance.raw,input,rid()),b=await service.void(finance.raw,input,rid());expect(a).toEqual(b);expect(a.state).toBe("void");
 expect((await f.admin.query("SELECT count(*) FROM confsys.refunds WHERE allocation_id IN(SELECT id FROM confsys.payment_allocations WHERE order_id=$1)",[orderId])).rows[0].count).toBe("0");
 await access.mutate(admin.raw,owner.id,{action:"revoke_sessions",reason:"Synthetic receipt revocation"},rid());await expect(service.download(owner.raw,receipt.id,1,rid())).rejects.toMatchObject({code:"SESSION_EXPIRED"});
});
