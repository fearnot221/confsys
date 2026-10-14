import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { lockAccessShared } from "../access/repository.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { auditFile, findFile } from "./repository.js";
import { readPrivate, type FileStorageConfig } from "./storage.js";

export type ReviewFilePolicy = (
  db: PoolClient,
  actorId: string,
  assignmentId: string,
  fileId: string,
) => Promise<void>;

// Review owns assignment/conflict/blind-release rules. The injected server policy is
// mandatory and runs before and after disk I/O; callers cannot substitute a user DTO.
export function createReviewFileDownload(
  pool: Pool,
  config: ApiConfig,
  storage: FileStorageConfig,
  authorizeReviewFile: ReviewFilePolicy,
) {
  return async (
    raw: string | undefined,
    assignmentId: string,
    fileId: string,
    requestId: string,
  ) => {
    const authorized = <T>(work: (db: PoolClient, actorId: string) => Promise<T>) =>
      withIdentityTransaction(pool, async (db) => {
        await lockAccessShared(db);
        const actor = await sessionActor(db, raw, config, new Date(), true);
        await authorizeReviewFile(db, actor.id, assignmentId, fileId);
        return work(db, actor.id);
      });
    const file = await authorized(async (db) => {
      const row = await findFile(db, fileId);
      if (row.purpose !== "manuscript" || row.status !== "ready")
        throw new AuthError("NOT_FOUND");
      return row;
    });
    const bytes = await readPrivate(storage.root, file.storage_key, file.size_bytes, file.sha256);
    return authorized(async (db, actorId) => {
      const current = await findFile(db, fileId);
      if (current.status !== "ready") throw new AuthError("NOT_FOUND");
      await auditFile(db, actorId, fileId, "file.review_downloaded", requestId);
      const extension = file.media_type === "application/pdf" ? "pdf" : file.media_type === "image/png" ? "png" : "jpg";
      return { bytes, mediaType: file.media_type, name: `manuscript-${fileId}.${extension}` };
    });
  };
}
