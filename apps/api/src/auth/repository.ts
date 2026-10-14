import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
export type UserRow = {
  id: string;
  email: string;
  state: "pending" | "active" | "disabled";
  password_hash: string | null;
  credential_version: number;
};
export type TokenRow = {
  id: string;
  user_id: string;
  email: string;
  purpose: "verify" | "reset";
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
};
type Connection = Pool | PoolClient;
export async function findUser(db: Connection, email: string) {
  return (
    await db.query<UserRow>(
      "SELECT id,email,state,password_hash,credential_version FROM confsys.users WHERE email=$1",
      [email],
    )
  ).rows[0];
}
export async function lockUser(db: PoolClient, id: string) {
  return (
    await db.query<UserRow>(
      "SELECT id,email,state,password_hash,credential_version FROM confsys.users WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
}
export async function ensurePendingUser(db: PoolClient, email: string) {
  await db.query(
    "INSERT INTO confsys.users(id,email) VALUES ($1,$2) ON CONFLICT(email) DO NOTHING",
    [randomUUID(), email],
  );
  const user = await findUser(db, email);
  if (!user) throw new Error("Identity insert missing");
  return lockUser(db, user.id);
}
export async function findToken(db: Connection, hash: string) {
  return (
    await db.query<TokenRow>(
      "SELECT id,user_id,email,purpose,expires_at,used_at,revoked_at FROM confsys.auth_tokens WHERE token_hash=$1",
      [hash],
    )
  ).rows[0];
}
export async function audit(
  db: Connection,
  event: string,
  userId: string | null,
  requestId: string,
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,user_id,request_id) VALUES ($1,$2,$3,$4)",
    [randomUUID(), event, userId, requestId],
  );
}
export async function revokeTokens(
  db: PoolClient,
  userId: string,
  purpose: string,
  now: Date,
) {
  await db.query(
    "UPDATE confsys.auth_tokens SET revoked_at=$3 WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL AND revoked_at IS NULL",
    [userId, purpose, now],
  );
}
export async function revokeSessions(
  db: PoolClient,
  userId: string,
  now: Date,
) {
  await db.query(
    "UPDATE confsys.sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL",
    [userId, now],
  );
}
export async function insertToken(
  db: PoolClient,
  token: {
    id: string;
    userId: string;
    email: string;
    purpose: "verify" | "reset";
    hash: string;
    expiresAt: Date;
  },
) {
  await db.query(
    "INSERT INTO confsys.auth_tokens(id,user_id,email,purpose,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      token.id,
      token.userId,
      token.email,
      token.purpose,
      token.hash,
      token.expiresAt,
    ],
  );
}
export async function markTokenUsed(db: PoolClient, id: string, now: Date) {
  await db.query("UPDATE confsys.auth_tokens SET used_at=$2 WHERE id=$1", [
    id,
    now,
  ]);
}
export async function replaceCredential(
  db: PoolClient,
  userId: string,
  hash: string,
  now: Date,
) {
  await db.query(
    "UPDATE confsys.users SET password_hash=$2, state='active', verified_at=COALESCE(verified_at,$3), credential_version=credential_version+1 WHERE id=$1",
    [userId, hash, now],
  );
}
export async function insertSession(
  db: PoolClient,
  session: {
    userId: string;
    hash: string;
    version: number;
    now: Date;
    expiresAt: Date;
  },
) {
  await db.query(
    "INSERT INTO confsys.sessions(id,user_id,token_hash,credential_version,created_at,last_seen_at,expires_at,password_verified_at) VALUES ($1,$2,$3,$4,$5,$5,$6,$5)",
    [
      randomUUID(),
      session.userId,
      session.hash,
      session.version,
      session.now,
      session.expiresAt,
    ],
  );
}
export async function touchValidSession(
  db: Connection,
  hash: string,
  now: Date,
  idleCutoff: Date,
) {
  return (
    await db.query<{ id: string; email: string }>(
      `UPDATE confsys.sessions s SET last_seen_at=GREATEST(s.last_seen_at,$2) FROM confsys.users u
    WHERE s.user_id=u.id AND s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2
    AND s.last_seen_at>$3 AND u.state='active' AND s.credential_version=u.credential_version RETURNING u.id,u.email`,
      [hash, now, idleCutoff],
    )
  ).rows[0];
}
export async function revokeSession(db: PoolClient, hash: string, now: Date) {
  return (
    (
      await db.query<{ user_id: string }>(
        "UPDATE confsys.sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE token_hash=$1 RETURNING user_id",
        [hash, now],
      )
    ).rows[0]?.user_id ?? null
  );
}
export async function advanceCredentialVersion(db: PoolClient, userId: string) {
  await db.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [userId],
  );
}
export async function sessionByHash(db: Connection, hash: string) {
  return (
    await db.query<{ user_id: string; password_verified_at: Date | null }>(
      "SELECT user_id,password_verified_at FROM confsys.sessions WHERE token_hash=$1",
      [hash],
    )
  ).rows[0];
}
export async function recordPasswordProof(
  db: PoolClient,
  hash: string,
  now: Date,
) {
  await db.query(
    "UPDATE confsys.sessions SET password_verified_at=$2 WHERE token_hash=$1",
    [hash, now],
  );
}
