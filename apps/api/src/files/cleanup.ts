import type { Pool } from "pg";
import { withIdentityTransaction } from "@confsys/db";
import { removeIncomplete } from "./storage.js";
// Interrupted transfers can only leave unreferenceable uploading rows. Run at startup/maintenance.
// A one-hour grace period exceeds request/scan deadlines; no ready/referenced file is touched.
export async function cleanupIncompleteUploads(pool: Pool, root: string) {
  const stale=await withIdentityTransaction(pool,async db=>(await db.query<{id:string;storage_key:string}>("UPDATE confsys.file_assets SET status='rejected' WHERE status='uploading' AND created_at < now()-interval '1 hour' RETURNING id,storage_key")).rows);
  for(const row of stale) await removeIncomplete(root,row.storage_key);
  return stale.length;
}
