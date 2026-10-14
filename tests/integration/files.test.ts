import { Redis } from "ioredis";
import { buildApp } from "../../apps/api/src/app.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { registerFilesRoutes } from "../../apps/api/src/files/routes.js";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeSite } from "../helpers/site.js";
import { createSiteService } from "../../apps/api/src/site/service.js";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createFilesService } from "../../apps/api/src/files/service.js";
import { assertReadyOwnedFiles, referenceMedia } from "../../apps/api/src/files/repository.js";
import { cleanupIncompleteUploads } from "../../apps/api/src/files/cleanup.js";
import { scanContent, privatePath } from "../../apps/api/src/files/storage.js";
import { withIdentityTransaction } from "@confsys/db";
const f=authFixture(),auth=createAuthService(f.app,f.config),access=createAccessService(f.app,f.config),rid=()=>randomUUID();
const png="iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=";
let baseline:Record<string,unknown>;
let root:string,files:ReturnType<typeof createFilesService>,pending:ReturnType<typeof createFilesService>;
async function account(){const email=f.email();await auth.requestMail("register",email,rid());await auth.consume("verify",(await f.link(email)).token,password,rid());const l=await auth.login(email,password,rid());return {id:l.account.user.id,email,raw:l.raw};}
let owner:Awaited<ReturnType<typeof account>>,other:Awaited<ReturnType<typeof account>>,admin:Awaited<ReturnType<typeof account>>;
const scanner={scannerHost:"127.0.0.1",scannerPort:Number(process.env.CLAMAV_PORT ?? 53310)};
beforeAll(async()=>{
  f.migrate();baseline=(await f.admin.query("SELECT * FROM confsys.site_state")).rows[0];root=await mkdtemp(join(tmpdir(),"confsys-private-integration-"));
  files=createFilesService(f.app,f.config,{root,...scanner});pending=createFilesService(f.app,f.config,{root,...scanner,scannerPort:1});
  owner=await account();other=await account();admin=await account();
  await bootstrapAdministrator(f.admin,{conferenceName:f.config.CONFERENCE_NAME,origin:f.config.PUBLIC_APP_ORIGIN},{targetId:admin.id,apply:true,reason:"Synthetic files test",confirmOrigin:f.config.PUBLIC_APP_ORIGIN},rid());
  admin.raw=(await auth.login(admin.email,password,rid())).raw;
});
afterAll(async()=>{
  if(baseline) await f.admin.query("UPDATE confsys.site_state SET draft_version=$1,document=$2,active_publication_id=$3",[baseline.draft_version,baseline.document,baseline.active_publication_id]);
  await f.admin.query("DELETE FROM confsys.file_references WHERE file_id IN(SELECT id FROM confsys.file_assets WHERE owner_id IN(SELECT id FROM confsys.users WHERE email LIKE $1))",[`${f.prefix}%`]);
  await f.admin.query("DELETE FROM confsys.file_assets WHERE owner_id IN(SELECT id FROM confsys.users WHERE email LIKE $1)",[`${f.prefix}%`]);
  await f.admin.query("DELETE FROM confsys.site_publications WHERE published_by IN(SELECT id FROM confsys.users WHERE email LIKE $1)",[`${f.prefix}%`]);
  await f.cleanup();if(root)await rm(root,{recursive:true,force:true});
});
it("real local ClamAV detects EICAR; unavailable scanner quarantines files, retry checks content before release",async()=>{
  const eicar=Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  expect(await scanContent(eicar,{root,...scanner})).toBe("infected");
  const upload=await pending.upload(owner.raw,{purpose:"manuscript",name:"paper.png",content:png},rid());
  expect(upload.status).toBe("quarantined");
  await expect(pending.download(owner.raw,upload.id,rid())).rejects.toMatchObject({code:"CONFLICT"});
  await expect(withIdentityTransaction(f.app,db=>assertReadyOwnedFiles(db,owner.id,[upload.id]))).rejects.toMatchObject({code:"CONFLICT"});
  expect((await files.retry(owner.raw,upload.id,rid())).status).toBe("ready");
  expect((await files.download(owner.raw,upload.id,rid())).bytes.length).toBeGreaterThan(0);
  await withIdentityTransaction(f.app,db=>assertReadyOwnedFiles(db,owner.id,[upload.id]));
  for(const raw of [other.raw,admin.raw]) await expect(files.download(raw,upload.id,rid())).rejects.toMatchObject({code:"NOT_FOUND"});
  expect((await files.list(other.raw,{})).items).toHaveLength(0);
  await expect(files.publicMedia(upload.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(withIdentityTransaction(f.app,db=>assertReadyOwnedFiles(db,other.id,[upload.id]))).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("ordinary accounts cannot upload public media; admin media remains private until active publication reference",async()=>{
  await expect(files.upload(owner.raw,{purpose:"site_media",name:"hero.png",content:png},rid())).rejects.toMatchObject({code:"FORBIDDEN"});
  const media=await files.upload(admin.raw,{purpose:"site_media",name:"hero.png",content:png},rid());expect(media.status).toBe("ready");
  await expect(files.publicMedia(media.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  // A reference to an inactive publication is not public; current pointer is required.
  await withIdentityTransaction(f.app,db=>referenceMedia(db,[media.id],rid()));
  await expect(files.publicMedia(media.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  const site=createSiteService(f.app,f.config),draft=await site.draft(admin.raw),document=completeSite("Media test");
  document.media={logoId:media.id,heroId:media.id};
  const saved=await site.save(admin.raw,{expectedVersion:draft.draftVersion,document},rid());
  await expect(files.publicMedia(media.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  const publication=await site.publish(admin.raw,{expectedVersion:saved.draftVersion},rid());
  expect((await files.publicMedia(media.id)).mediaType).toBe("image/png");
  const next=await site.save(admin.raw,{expectedVersion:saved.draftVersion,document:completeSite("No media draft")},rid());
  expect((await files.publicMedia(media.id)).bytes.length).toBeGreaterThan(0);
  await site.publish(admin.raw,{expectedVersion:next.draftVersion},rid());
  await expect(files.publicMedia(media.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  const restored=await site.restore(admin.raw,{expectedVersion:next.draftVersion,publicationId:publication.publicationId},rid());
  await site.publish(admin.raw,{expectedVersion:restored.draftVersion},rid());
  expect((await files.publicMedia(media.id)).bytes.length).toBeGreaterThan(0);
  await expect(f.app.query("DELETE FROM confsys.file_assets WHERE id=$1",[media.id])).rejects.toMatchObject({code:"42501"});
  await expect(f.app.query("UPDATE confsys.file_assets SET storage_key=$2 WHERE id=$1",[media.id,rid()])).rejects.toMatchObject({code:"42501"});
});
it("malformed file and traversal names rejected; revoked session cannot retry or download; integrity corruption fails closed",async()=>{
  await expect(files.upload(owner.raw,{purpose:"manuscript",name:"../x.png",content:png},rid())).rejects.toThrow();
  await expect(files.upload(owner.raw,{purpose:"manuscript",name:"fake.pdf",content:Buffer.from("%PDF-1.7\n%%EOF").toString("base64")},rid())).rejects.toMatchObject({code:"UNSUPPORTED_MEDIA_TYPE"});
  const file=await files.upload(other.raw,{purpose:"manuscript",name:"synthetic.png",content:png},rid());
  const row=(await f.admin.query("SELECT storage_key FROM confsys.file_assets WHERE id=$1",[file.id])).rows[0];
  await writeFile(privatePath(root,row.storage_key),Buffer.from("corrupt"));
  await expect(files.download(other.raw,file.id,rid())).rejects.toThrow("integrity");
  await access.mutate(admin.raw,other.id,{action:"revoke_sessions",reason:"Synthetic revocation"},rid());
  await expect(files.download(other.raw,file.id,rid())).rejects.toMatchObject({code:"SESSION_EXPIRED"});
});
it("abandoned uploads become rejected, private bytes removed and quotas remain durable",async()=>{
  const id=rid(),key=rid();
  await f.admin.query("INSERT INTO confsys.file_assets(id,owner_id,purpose,original_name,media_type,size_bytes,sha256,storage_key,status,created_at) VALUES($1,$2,'manuscript','abandoned.pdf','application/pdf',1,$3,$4,'uploading',now()-interval '2 hours')",[id,owner.id,"0".repeat(64),key]);
  await writeFile(privatePath(root,key),Buffer.from("x"));
  expect(await cleanupIncompleteUploads(f.app,root)).toBeGreaterThanOrEqual(1);
  expect((await f.admin.query("SELECT status FROM confsys.file_assets WHERE id=$1",[id])).rows[0].status).toBe("rejected");
  await expect(files.download(owner.raw,id,rid())).rejects.toMatchObject({code:"CONFLICT"});
});
it("HTTP upload enforces CSRF/origin/body bounds and private download headers without leaking storage keys",async()=>{
  const up=async()=>{},server=buildApp({postgres:up,redis:up,worker:up}),redis=new Redis(f.config.REDIS_URL);
  await registerAuthRoutes(server,{config:f.config,service:auth,limit:createRateLimiter(redis,f.config.CSRF_SIGNING_KEY,`files-${rid()}`)});
  registerFilesRoutes(server,f.config,files);
  const host=new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    const csrf=await server.inject({url:"/api/auth/csrf",headers:{host}}),cookie=csrf.cookies.map(c=>`${c.name}=${c.value}`).join("; ");
    const headers={host,cookie:`dev-session=${owner.raw}; ${cookie}`,origin:f.config.PUBLIC_APP_ORIGIN,"x-csrf-token":csrf.json().csrfToken};
    const payload={purpose:"payment_evidence",name:"payment.png",content:png};
    for(const extra of [{origin:"https://evil.invalid"},{"x-csrf-token":""}]) expect((await server.inject({method:"POST",url:"/api/files",payload,headers:{...headers,...extra}})).statusCode).toBe(403);
    expect((await server.inject({method:"POST",url:"/api/files",payload:{...payload,ownerId:other.id},headers})).statusCode).toBe(400);
    expect((await server.inject({method:"POST",url:"/api/files",payload:{...payload,content:"A".repeat(11_200_000)},headers})).statusCode).toBe(413);
    const upload=await server.inject({method:"POST",url:"/api/files",payload,headers});expect(upload.statusCode).toBe(200);expect(upload.json().status).toBe("ready");expect(upload.body).not.toMatch(/storage_key|owner_id/);
    const download=await server.inject({url:`/api/files/${upload.json().id}/download`,headers});expect(download.statusCode).toBe(200);expect(download.headers["cache-control"]).toBe("no-store");expect(download.headers["x-content-type-options"]).toBe("nosniff");expect(download.headers["content-disposition"]).toContain("attachment");
    expect((await server.inject({url:`/api/files/${upload.json().id}/download`,headers:{host}})).statusCode).toBe(401);
    expect((await server.inject({url:`/api/media/${upload.json().id}`,headers:{host}})).statusCode).toBe(404);
  }finally{redis.disconnect();await server.close();}
});
