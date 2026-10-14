import type { PoolClient } from "pg";
// The database returns only a scoped boolean, never historical email addresses.
// This is a denial check; it must never be used to grant manuscript ownership.
export async function isRevisionAuthorAccount(
  db: PoolClient,
  revisionId: string,
  userId: string,
) {
  return !!(
    await db.query(
      "SELECT 1 FROM confsys.submission_author_conflicts WHERE revision_id=$1 AND user_id=$2",
      [revisionId, userId],
    )
  ).rowCount;
}
