import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  fileAssetSchema,
  type FileAsset,
  type FilePurpose,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export type StoredFile = {
  id: string;
  owner_id: string;
  purpose: FilePurpose;
  original_name: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  status: FileAsset["status"];
  created_at: Date;
};
export function projectFile(row: StoredFile): FileAsset {
  return fileAssetSchema.parse({
    id: row.id,
    purpose: row.purpose,
    name: row.original_name,
    mediaType: row.media_type,
    size: row.size_bytes,
    sha256: row.sha256,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  });
}
export async function findFile(db: PoolClient, id: string) {
  const row = (
    await db.query<StoredFile>(
      "SELECT * FROM confsys.file_assets WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return row;
}
export async function listFiles(
  db: PoolClient,
  actor: string,
  offset: number,
  purpose?: FilePurpose,
  mediaManager = false,
) {
  const rows = (
    await db.query<StoredFile>(
      `SELECT * FROM confsys.file_assets WHERE (owner_id=$1 OR ($4 AND purpose='site_media')) AND ($2::text IS NULL OR purpose=$2) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $3`,
      [actor, purpose ?? null, offset, mediaManager],
    )
  ).rows;
  return {
    items: rows.slice(0, 50).map(projectFile),
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}
export async function createFile(
  db: PoolClient,
  data: Omit<StoredFile, "created_at" | "status">,
) {
  const quota = (
    await db.query<{ count: string; total: string }>(
      "SELECT count(*),coalesce(sum(size_bytes),0) AS total FROM confsys.file_assets WHERE owner_id=$1",
      [data.owner_id],
    )
  ).rows[0]!;
  if (
    Number(quota.count) >= 100 ||
    Number(quota.total) + data.size_bytes > 200 * 1024 * 1024
  )
    throw new AuthError("CONFLICT");
  await db.query(
    "INSERT INTO confsys.file_assets(id,owner_id,purpose,original_name,media_type,size_bytes,sha256,storage_key,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploading')",
    [
      data.id,
      data.owner_id,
      data.purpose,
      data.original_name,
      data.media_type,
      data.size_bytes,
      data.sha256,
      data.storage_key,
    ],
  );
}
export async function setStatus(
  db: PoolClient,
  id: string,
  status: FileAsset["status"],
) {
  const changed = await db.query(
    "UPDATE confsys.file_assets SET status=$2 WHERE id=$1 AND status IN ('uploading','quarantined') AND status IS DISTINCT FROM $2",
    [id, status],
  );
  return changed.rowCount === 1;
}
export async function auditFile(
  db: PoolClient,
  actorId: string,
  id: string,
  event: string,
  requestId: string,
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session','Private file operation',$4,$5)",
    [randomUUID(), event, actorId, JSON.stringify({ fileId: id }), requestId],
  );
}
export async function assertReadyOwnedFiles(
  db: PoolClient,
  actorId: string,
  ids: readonly string[],
  purpose: FilePurpose = "manuscript",
) {
  if (ids.length > 10 || new Set(ids).size !== ids.length)
    throw new AuthError("INVALID_REQUEST");
  await db.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
  for (const id of ids) {
    const file = await findFile(db, id);
    if (file.owner_id !== actorId || file.purpose !== purpose)
      throw new AuthError("NOT_FOUND");
    if (file.status !== "ready") throw new AuthError("CONFLICT");
  }
}
export async function referenceFiles(
  db: PoolClient,
  ids: readonly string[],
  resourceType: "site_publication" | "submission_revision" | "payment_evidence",
  resourceId: string,
) {
  for (const id of ids)
    await db.query(
      "INSERT INTO confsys.file_references(file_id,resource_type,resource_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, resourceType, resourceId],
    );
}
export async function validateMediaReferences(
  db: PoolClient,
  ids: readonly string[],
) {
  for (const id of ids) {
    const file = await findFile(db, id);
    if (
      file.purpose !== "site_media" ||
      file.status !== "ready" ||
      !file.media_type.startsWith("image/")
    )
      throw new AuthError("INVALID_REQUEST");
  }
}
export async function referenceMedia(
  db: PoolClient,
  ids: readonly string[],
  publicationId: string,
) {
  await validateMediaReferences(db, ids);
  await referenceFiles(db, ids, "site_publication", publicationId);
}
export async function isPublishedMedia(db: PoolClient, id: string) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.file_references r JOIN confsys.site_state s ON r.resource_id=s.active_publication_id WHERE r.file_id=$1 AND r.resource_type='site_publication'",
      [id],
    )
  ).rowCount;
}

export async function fileContext(
  db: PoolClient,
  actorId: string,
  mediaManager = false,
) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.files_media_manager',$2,true)",
    [actorId, String(mediaManager)],
  );
}
export async function authorizedFileContext(db: PoolClient, id: string) {
  await db.query("SELECT set_config('app.authorized_file_id',$1,true)", [id]);
}
export async function publicMediaContext(db: PoolClient, id: string) {
  await db.query("SELECT set_config('app.public_media_file_id',$1,true)", [id]);
}
export async function finishTransfer(
  db: PoolClient,
  id: string,
  key: string,
  status: "quarantined" | "rejected",
) {
  await db.query(
    "SELECT set_config('app.upload_file_id',$1,true),set_config('app.upload_storage_key',$2,true)",
    [id, key],
  );
  await setStatus(db, id, status);
}
