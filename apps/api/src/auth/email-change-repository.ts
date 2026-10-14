import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
export async function createEmailChangeToken(
  db: PoolClient,
  userId: string,
  sourceEmail: string,
  email: string,
  version: number,
  hash: string,
) {
  const id = randomUUID();
  const row = (
    await db.query<{ expires_at: Date }>(
      "INSERT INTO confsys.auth_tokens(id,user_id,email,purpose,source_email,credential_version,token_hash,expires_at) VALUES($1,$2,$3,'email_change',$4,$5,$6,now()+interval '30 minutes') RETURNING expires_at",
      [id, userId, email, sourceEmail, version, hash],
    )
  ).rows[0]!;
  return { id, expiresAt: row.expires_at };
}
export async function emailChangeToken(db: PoolClient, hash: string) {
  return (
    await db.query<{
      id: string;
      user_id: string;
      email: string;
      source_email: string;
      credential_version: number;
      eligible: boolean;
    }>(
      "SELECT id,user_id,email,source_email,credential_version,(used_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) AS eligible FROM confsys.auth_tokens WHERE token_hash=$1 AND purpose='email_change'",
      [hash],
    )
  ).rows[0];
}
export async function rememberVerifiedEmail(db: PoolClient, userId: string) {
  await db.query(
    "INSERT INTO confsys.verified_email_history(user_id,email,verified_at) SELECT id,email,verified_at FROM confsys.users WHERE id=$1 AND verified_at IS NOT NULL ON CONFLICT DO NOTHING",
    [userId],
  );
}
export async function replaceEmail(
  db: PoolClient,
  userId: string,
  email: string,
) {
  await db.query(
    "UPDATE confsys.users SET email=$2,verified_at=now(),credential_version=credential_version+1 WHERE id=$1",
    [userId, email],
  );
}
