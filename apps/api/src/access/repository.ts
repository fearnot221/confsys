import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  directoryAccountSchema,
  roleSchema,
  type Role,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
type Connection = Pool | PoolClient;
export async function rolesFor(db: Connection, id: string): Promise<Role[]> {
  return (
    await db.query<{ role: string }>(
      "SELECT role FROM confsys.user_roles WHERE user_id=$1 ORDER BY role",
      [id],
    )
  ).rows.map((row) => roleSchema.parse(row.role));
}
export async function lockAccess(db: PoolClient) {
  const row = (
    await db.query<{ initialized_user_id: string | null }>(
      "SELECT initialized_user_id FROM confsys.access_control WHERE singleton=true FOR UPDATE",
    )
  ).rows[0];
  if (!row) throw new Error("Access control migration required");
  return row;
}
export async function assertAdministratorRemains(db: PoolClient) {
  const result = await db.query(
    `SELECT 1 FROM confsys.users u JOIN confsys.user_roles r ON r.user_id=u.id WHERE r.role='conference_admin' AND u.state='active' AND u.verified_at IS NOT NULL AND u.password_hash IS NOT NULL LIMIT 1`,
  );
  if (!result.rowCount) throw new AuthError("LAST_ADMIN");
}
const projection = `u.id,u.email,u.state,(u.verified_at IS NOT NULL) AS verified, ARRAY(SELECT role FROM confsys.user_roles r WHERE r.user_id=u.id ORDER BY role) AS roles`;
export async function accountById(db: Connection, id: string) {
  const row = (
    await db.query(`SELECT ${projection} FROM confsys.users u WHERE u.id=$1`, [
      id,
    ])
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return directoryAccountSchema.parse(row);
}
export async function directory(
  db: Connection,
  query: {
    search: string;
    state?: string | undefined;
    offset: number;
    limit: number;
  },
) {
  const rows = (
    await db.query(
      `SELECT ${projection} FROM confsys.users u WHERE position(lower($1) in u.email)>0 AND ($2::text IS NULL OR u.state=$2) ORDER BY u.email,u.id LIMIT $3 OFFSET $4`,
      [query.search, query.state ?? null, query.limit + 1, query.offset],
    )
  ).rows;
  return {
    items: rows
      .slice(0, query.limit)
      .map((row) => directoryAccountSchema.parse(row)),
    nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
  };
}
export async function recordAccess(
  db: PoolClient,
  event: {
    action: string;
    targetId: string;
    actorId: string | null;
    source: "session" | "operator_cli";
    reason: string;
    before: string;
    after: string;
    requestId: string;
  },
) {
  await db.query(
    `INSERT INTO confsys.auth_audit(id,event,user_id,actor_id,source,reason,before_value,after_value,request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      event.action,
      event.targetId,
      event.actorId,
      event.source,
      event.reason,
      event.before,
      event.after,
      event.requestId,
    ],
  );
}
export async function auditPage(
  db: Connection,
  query: { offset: number; limit: number },
) {
  const rows = (
    await db.query<{
      id: string;
      event: string;
      targetId: string | null;
      actorId: string | null;
      source: string;
      reason: string | null;
      before: string | null;
      after: string | null;
      requestId: string;
      created_at: Date;
    }>(
      `SELECT id,event,user_id AS "targetId",actor_id AS "actorId",source,reason,before_value AS before,after_value AS after,request_id AS "requestId",created_at FROM confsys.auth_audit ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`,
      [query.limit + 1, query.offset],
    )
  ).rows;
  return {
    items: rows
      .slice(0, query.limit)
      .map(({ created_at, ...row }) => ({
        ...row,
        createdAt: created_at.toISOString(),
      })),
    nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
  };
}
export async function grantRole(db: PoolClient, userId: string, role: Role) {
  return !!(
    await db.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [userId, role],
    )
  ).rowCount;
}
export async function removeRole(db: PoolClient, userId: string, role: Role) {
  return !!(
    await db.query(
      "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role=$2",
      [userId, role],
    )
  ).rowCount;
}
export async function changeAccountState(
  db: PoolClient,
  userId: string,
  state: "active" | "disabled",
) {
  return !!(
    await db.query(
      "UPDATE confsys.users SET state=$2 WHERE id=$1 AND state<>$2",
      [userId, state],
    )
  ).rowCount;
}
export async function completeBootstrap(db: PoolClient, userId: string) {
  await db.query(
    "UPDATE confsys.access_control SET initialized_user_id=$1,initialized_at=now() WHERE singleton=true",
    [userId],
  );
}
export async function requireOperatorConnection(db: PoolClient) {
  const result = await db.query("SELECT current_user");
  if (result.rows[0]?.current_user !== "confsys_migrator")
    throw new AuthError("FORBIDDEN");
}
