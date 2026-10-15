import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
// The caller's domain transaction owns authorization and the event key. Content is
// an immutable generic notification, never a manuscript or unpublished decision.
export async function enqueueBusinessNotification(
  db: PoolClient,
  config: Pick<ApiConfig, "CONFERENCE_NAME">,
  input: {
    userId: string;
    eventKey: string;
    subject: string;
    text: string;
    requestId: string;
    batchId?: string;
    notBefore?: string;
  },
) {
  if (
    (input.notBefore !== undefined &&
      (!input.notBefore.endsWith("Z") ||
        !Number.isFinite(Date.parse(input.notBefore)))) ||
    !input.eventKey ||
    input.eventKey.length > 200 ||
    !input.subject ||
    input.subject.length > 200 ||
    /[\r\n]/.test(input.subject) ||
    !input.text ||
    input.text.length > 4000
  )
    throw new Error("Invalid business notification");
  const brand = config.CONFERENCE_NAME;
  await db.query(
    `INSERT INTO confsys.notifications(id,scope,user_id,kind,request_id,expires_at,conference_name,event_key,message_subject,message_text,batch_id,next_attempt_at,available_at) VALUES($1,'business',$2,'business',$3,greatest(coalesce($9::timestamptz,now()),now())+interval '7 days',$4,$5,$6,$7,$8,coalesce($9::timestamptz,now()),coalesce($9::timestamptz,now())) ON CONFLICT(event_key) DO NOTHING`,
    [
      randomUUID(),
      input.userId,
      input.requestId,
      brand,
      input.eventKey,
      input.subject,
      input.text,
      input.batchId ?? null,
      input.notBefore ?? null,
    ],
  );
}
