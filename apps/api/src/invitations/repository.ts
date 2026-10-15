import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { invitationSchema, type Role } from "@confsys/contracts";
import { seal } from "@confsys/notifications";
export type InvitationRow = {
  id: string;
  user_id: string;
  email: string;
  role: Role;
  issuer_id: string;
  issuer_credential_version: number;
  recipient_credential_version: number;
  idempotency_key: string;
  reason: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  invalidated?: boolean;
};
export function invitationProjection(row: InvitationRow, now = new Date()) {
  return invitationSchema.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.accepted_at
      ? "accepted"
      : row.revoked_at || row.invalidated
        ? "revoked"
        : row.expires_at <= now
          ? "expired"
          : "pending",
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  });
}
export async function listInvitations(
  db: PoolClient,
  page: { limit: number; offset: number },
) {
  const rows = (
    await db.query<InvitationRow>(
      `SELECT i.*, (u.state<>'active' OR u.credential_version<>i.recipient_credential_version OR issuer.state<>'active' OR issuer.credential_version<>i.issuer_credential_version OR NOT EXISTS (SELECT 1 FROM confsys.user_roles r WHERE r.user_id=issuer.id AND r.role='conference_admin')) AS invalidated FROM confsys.role_invitations i JOIN confsys.users u ON u.id=i.user_id JOIN confsys.users issuer ON issuer.id=i.issuer_id ORDER BY i.created_at DESC,i.id DESC LIMIT $1 OFFSET $2`,
      [page.limit + 1, page.offset],
    )
  ).rows;
  return {
    items: rows.slice(0, page.limit).map((row) => invitationProjection(row)),
    nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
  };
}
export async function invitationByKey(
  db: PoolClient,
  issuerId: string,
  key: string,
) {
  return (
    await db.query<InvitationRow>(
      "SELECT * FROM confsys.role_invitations WHERE issuer_id=$1 AND idempotency_key=$2",
      [issuerId, key],
    )
  ).rows[0];
}
export async function invitationByHash(db: PoolClient, hash: string) {
  return (
    await db.query<InvitationRow>(
      "SELECT * FROM confsys.role_invitations WHERE token_hash=$1",
      [hash],
    )
  ).rows[0];
}
export async function lockInvitation(db: PoolClient, id: string) {
  return (
    await db.query<InvitationRow>(
      "SELECT * FROM confsys.role_invitations WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
}
export async function insertInvitation(
  db: PoolClient,
  input: {
    id: string;
    userId: string;
    email: string;
    role: Role;
    issuerId: string;
    issuerVersion: number;
    recipientVersion: number;
    hash: string;
    idempotencyKey: string;
    reason: string;
    expiresAt: Date;
  },
) {
  const row = (
    await db.query<InvitationRow>(
      `INSERT INTO confsys.role_invitations
    (id,user_id,email,role,issuer_id,issuer_credential_version,recipient_credential_version,token_hash,idempotency_key,reason,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        input.id,
        input.userId,
        input.email,
        input.role,
        input.issuerId,
        input.issuerVersion,
        input.recipientVersion,
        input.hash,
        input.idempotencyKey,
        input.reason,
        input.expiresAt,
      ],
    )
  ).rows[0];
  if (!row) throw new Error("Invitation insert failed");
  return row;
}
export async function closeInvitation(
  db: PoolClient,
  id: string,
  accepted: boolean,
  now: Date,
) {
  const result = await db.query(
    accepted
      ? "UPDATE confsys.role_invitations SET accepted_at=$2 WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>$2"
      : "UPDATE confsys.role_invitations SET revoked_at=$2 WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL",
    [id, now],
  );
  return !!result.rowCount;
}
export async function enqueueInvitation(
  db: PoolClient,
  input: {
    invitationId: string;
    userId: string;
    requestId: string;
    expiresAt: Date;
    conferenceName: string;
    link: string;
    key: string;
    keyVersion: string;
  },
) {
  // Same transactional outbox and encrypted secret storage as identity mail.
  const id = randomUUID();
  await db.query(
    `INSERT INTO confsys.notifications(id,scope,user_id,kind,request_id,expires_at,conference_name,invitation_id)
    VALUES ($1,'identity',$2,'role_invitation',$3,$4,$5,$6)`,
    [
      id,
      input.userId,
      input.requestId,
      input.expiresAt,
      input.conferenceName,
      input.invitationId,
    ],
  );
  await db.query(
    "INSERT INTO confsys.notification_secrets(notification_id,key_version,ciphertext,expires_at) VALUES ($1,$2,$3,$4)",
    [
      id,
      input.keyVersion,
      seal(input.link, id, input.key, input.keyVersion),
      input.expiresAt,
    ],
  );
}
