import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { requirePermission } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { findFile, auditFile } from "../files/repository.js";
import { readPrivate, type FileStorageConfig } from "../files/storage.js";
import { financeContext } from "./repository.js";
// A payment reference grants finance readers this one evidence file, never an author's other files.
export function createPaymentEvidenceDownload(
  pool: Pool,
  config: ApiConfig,
  storage: FileStorageConfig,
) {
  return async (
    raw: string | undefined,
    paymentId: string,
    requestId: string,
  ) => {
    const authorized = <T>(
      work: (db: PoolClient, actorId: string, fileId: string) => Promise<T>,
    ) =>
      withIdentityTransaction(pool, async (db) => {
        await lockAccessShared(db);
        const actor = await sessionActor(db, raw, config, new Date(), true);
        requirePermission(await rolesFor(db, actor.id), "finance.read");
        await financeContext(db, actor.id, true);
        const row = (
          await db.query<{ evidence_file_id: string | null }>(
            "SELECT evidence_file_id FROM confsys.payments WHERE id=$1",
            [paymentId],
          )
        ).rows[0];
        if (!row?.evidence_file_id) throw new AuthError("NOT_FOUND");
        await db.query("SELECT set_config('app.authorized_file_id',$1,true)", [
          row.evidence_file_id,
        ]);
        return work(db, actor.id, row.evidence_file_id);
      });
    const file = await authorized(async (db, _actor, id) => {
      const f = await findFile(db, id);
      if (f.status !== "ready" || f.purpose !== "payment_evidence")
        throw new AuthError("NOT_FOUND");
      return f;
    });
    const bytes = await readPrivate(
      storage.root,
      file.storage_key,
      file.size_bytes,
      file.sha256,
    );
    return authorized(async (db, actor, id) => {
      const current = await findFile(db, id);
      if (current.id !== file.id || current.status !== "ready")
        throw new AuthError("NOT_FOUND");
      await auditFile(
        db,
        actor,
        id,
        "file.payment_evidence_downloaded",
        requestId,
      );
      return {
        bytes,
        mediaType: file.media_type,
        name: `payment-evidence-${paymentId}.${file.media_type === "application/pdf" ? "pdf" : file.media_type === "image/png" ? "png" : "jpg"}`,
      };
    });
  };
}
