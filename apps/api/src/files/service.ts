import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { fileUploadInput, fileListInput } from "@confsys/contracts";
import { sessionActor } from "../auth/session.js";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { requirePermission, permissionsFor } from "../access/policy.js";
import { AuthError } from "../auth/errors.js";
import * as repo from "./repository.js";
import { digest, prepareContent, readPrivate, removeIncomplete, scanContent, writePrivate, type FileStorageConfig } from "./storage.js";

export function createFilesService(pool: Pool, config: ApiConfig, storage: FileStorageConfig) {
  const authorized = <T>(raw: string | undefined, work: (db: PoolClient, actor: string, mediaManager: boolean) => Promise<T>) => withIdentityTransaction(pool, async db => {
    await lockAccessShared(db);
    const actor = await sessionActor(db,raw,config,new Date(),true);
    const roles = await rolesFor(db,actor.id);
    return work(db,actor.id,permissionsFor(roles).some(p => p === "files.media.manage"));
  });
  const owned = async (db: PoolClient,id: string,actor: string,mediaManager: boolean) => {
    const row = await repo.findFile(db,id);
    if (row.owner_id !== actor && !(mediaManager && row.purpose === "site_media")) throw new AuthError("NOT_FOUND");
    return row;
  };
  const finishScan = async (raw: string | undefined,id: string,bytes: Buffer,requestId: string) => {
    const result = await scanContent(bytes,storage);
    return authorized(raw,async(db,actor,mediaManager) => {
      const row = await owned(db,id,actor,mediaManager);
      const status = result === "clean" ? "ready" : result === "infected" ? "rejected" : "quarantined";
      await repo.setStatus(db,id,status);
      await repo.auditFile(db,actor,id,`file.scan_${status}`,requestId);
      return repo.projectFile(await repo.findFile(db,row.id));
    });
  };
  return {
    list(raw: string | undefined,input: unknown) {
      const q = fileListInput.parse(input);
      return authorized(raw,(db,actor,mediaManager)=>repo.listFiles(db,actor,q.offset,q.purpose,mediaManager));
    },
    async upload(raw: string | undefined,input: unknown,requestId: string) {
      const data = fileUploadInput.parse(input);
      // Authenticate before expensive parsing and again after all external work.
      await authorized(raw,async(db,actor)=>{
        if(data.purpose === "site_media") requirePermission(await rolesFor(db,actor),"files.media.manage");
      });
      const prepared = await prepareContent(data.content,data.purpose), id = randomUUID(), key = randomUUID();
      await authorized(raw,async(db,actor)=>{
        if(data.purpose === "site_media") requirePermission(await rolesFor(db,actor),"files.media.manage");
        await repo.createFile(db,{id,owner_id:actor,purpose:data.purpose,original_name:data.name,media_type:prepared.mediaType,size_bytes:prepared.bytes.length,sha256:digest(prepared.bytes),storage_key:key});
        await repo.auditFile(db,actor,id,"file.upload_started",requestId);
      });
      try { await writePrivate(storage.root,key,prepared.bytes); }
      catch(error) {
        // A failed write is never exposed. Cleanup only the generated key for this attempt.
        await removeIncomplete(storage.root,key);
        await withIdentityTransaction(pool,db=>repo.setStatus(db,id,"rejected"));
        throw error;
      }
      await withIdentityTransaction(pool,db=>repo.setStatus(db,id,"quarantined"));
      return finishScan(raw,id,prepared.bytes,requestId);
    },
    async retry(raw: string | undefined,id: string,requestId: string) {
      const row = await authorized(raw,async(db,actor,manager)=>{
        const found=await owned(db,id,actor,manager);
        if(found.status !== "quarantined") throw new AuthError("CONFLICT");
        return found;
      });
      const bytes = await readPrivate(storage.root,row.storage_key,row.size_bytes,row.sha256);
      return finishScan(raw,id,bytes,requestId);
    },
    async download(raw: string | undefined,id: string,requestId: string) {
      const row = await authorized(raw,(db,actor,manager)=>owned(db,id,actor,manager));
      if(row.status !== "ready") throw new AuthError("CONFLICT");
      const bytes = await readPrivate(storage.root,row.storage_key,row.size_bytes,row.sha256);
      // Recheck after disk I/O so a revoked session cannot complete a queued download.
      return authorized(raw,async(db,actor,manager)=>{
        const current=await owned(db,id,actor,manager);
        if(current.status !== "ready") throw new AuthError("CONFLICT");
        await repo.auditFile(db,actor,id,"file.downloaded",requestId);
        return {bytes,mediaType:row.media_type,name:row.original_name};
      });
    },
    async publicMedia(id: string) {
      const row = await withIdentityTransaction(pool,async db=>{
        const file=await repo.findFile(db,id);
        if(file.purpose !== "site_media" || file.status !== "ready" || !(await repo.isPublishedMedia(db,id))) throw new AuthError("NOT_FOUND");
        return file;
      });
      const bytes = await readPrivate(storage.root,row.storage_key,row.size_bytes,row.sha256);
      await withIdentityTransaction(pool,async db=>{
        if(!(await repo.isPublishedMedia(db,id))) throw new AuthError("NOT_FOUND");
      });
      return {bytes,mediaType:row.media_type};
    },
  };
}
