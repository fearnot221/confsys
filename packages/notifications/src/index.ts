import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { seal } from "./secrets.js";
export { seal, unseal } from "./secrets.js";
export const AUTH_MAIL_QUEUE = "identity-notifications-v1";
export async function enqueueIdentityMail(
  client: PoolClient,
  input: {
    conferenceName: string;
    userId: string;
    tokenId: string | null;
    kind: "verify" | "reset" | "password_changed" | "email_change";
    requestId: string;
    expiresAt: Date;
    link: string;
    key: string;
    keyVersion: string;
  },
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO confsys.notifications(id, scope, user_id, token_id, kind, request_id, expires_at, conference_name)
    VALUES ($1, 'identity', $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.userId,
      input.tokenId,
      input.kind,
      input.requestId,
      input.expiresAt,
      input.conferenceName,
    ],
  );
  await client.query(
    `INSERT INTO confsys.notification_secrets(notification_id,key_version,ciphertext,expires_at) VALUES ($1,$2,$3,$4)`,
    [
      id,
      input.keyVersion,
      seal(input.link, id, input.key, input.keyVersion),
      input.expiresAt,
    ],
  );
  return id;
}
export { enqueueBusinessNotification } from './business.js';

export { notificationBatchPermission, type NotificationBatchKind } from './batch-policy.js';
