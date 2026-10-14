import type { Pool } from "pg";
import { withIdentityTransaction } from "@confsys/db";
import { removeIncomplete } from "./storage.js";
// Interrupted transfers can only leave unreferenceable uploading rows. Run at startup/maintenance.
// A one-hour grace period exceeds request/scan deadlines; no ready/referenced file is touched.
export async function cleanupIncompleteUploads(pool: Pool, root: string) {
  return withIdentityTransaction(pool, async (db) => {
    const stale = (
      await db.query<{ id: string; storage_key: string }>(
        "SELECT id,storage_key FROM confsys.reject_stale_uploads()",
      )
    ).rows;
    // Commit rejection only after unlink succeeds. A crash after unlink is safe:
    // rollback keeps the uploading row retryable and ENOENT is idempotent.
    for (const row of stale) await removeIncomplete(root, row.storage_key);
    return stale.length;
  });
}
