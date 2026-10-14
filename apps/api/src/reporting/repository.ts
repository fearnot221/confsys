import type { PoolClient } from "pg";
import {
  notificationPage,
  reportingStats,
  authorPreview,
} from "@confsys/contracts";
import { csvDocument } from "./policy.js";
const pageSize = 100;
export async function context(db: PoolClient, actorId: string, admin: boolean) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.registration_admin',$2,true),set_config('app.submissions_admin',$2,true),set_config('app.reviews_manage',$2,true)",
    [actorId, String(admin)],
  );
}
export async function notifications(db: PoolClient, offset: number) {
  const rows = (
    await db.query(
      `SELECT f.id,f.subject,f.text,f.status,f.created_at,r.read_at FROM confsys.user_notification_feed f LEFT JOIN confsys.notification_reads r ON r.notification_id=f.id ORDER BY f.created_at DESC,f.id DESC LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
  return notificationPage.parse({
    items: rows
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        subject: r.subject,
        text: r.text,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        readAt: r.read_at?.toISOString() ?? null,
      })),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  });
}
export async function markRead(db: PoolClient, actorId: string, id: string) {
  const found = await db.query(
    "SELECT id FROM confsys.user_notification_feed WHERE id=$1",
    [id],
  );
  if (!found.rowCount) return false;
  await db.query(
    "INSERT INTO confsys.notification_reads(notification_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [id, actorId],
  );
  return true;
}
export async function stats(db: PoolClient) {
  const registrations = (
    await db.query(
      "SELECT state,count(*)::integer AS count FROM confsys.registrations GROUP BY state ORDER BY state",
    )
  ).rows;
  const submissions = (
    await db.query(
      "SELECT state,count(*)::integer AS count FROM confsys.submissions GROUP BY state ORDER BY state",
    )
  ).rows;
  const reviews = (
    await db.query(
      "SELECT state,count(*)::integer AS count FROM confsys.review_assignments GROUP BY state ORDER BY state",
    )
  ).rows;
  const orders = (
    await db.query(
      "SELECT state,currency,count(*)::integer AS count,sum(amount)::text AS amount FROM confsys.orders GROUP BY state,currency ORDER BY currency,state",
    )
  ).rows;
  return reportingStats.parse({ registrations, submissions, reviews, orders });
}
export async function exportRows(
  db: PoolClient,
  kind: "registrations" | "submissions" | "emails",
  offset: number,
) {
  let headers: string[], values: unknown[][];
  if (kind === "registrations") {
    headers = [
      "registration_id",
      "number",
      "state",
      "email",
      "badge_name",
      "affiliation",
      "ticket",
    ];
    const rows = (
      await db.query(
        "SELECT r.id,r.number::text,r.state,u.email,r.badge_name,r.affiliation,r.ticket_name FROM confsys.registrations r JOIN confsys.users u ON u.id=r.user_id ORDER BY r.number,r.id LIMIT $1 OFFSET $2",
        [pageSize + 1, offset],
      )
    ).rows;
    values = rows.map((r) => [
      r.id,
      r.number,
      r.state,
      r.email,
      r.badge_name,
      r.affiliation,
      r.ticket_name,
    ]);
  } else if (kind === "submissions") {
    headers = [
      "submission_id",
      "number",
      "state",
      "owner_email",
      "title",
      "track",
      "version",
      "submitted_version",
    ];
    const rows = (
      await db.query(
        "SELECT s.id,s.number::text,s.state,u.email,s.document->>'title' AS title,s.document->>'trackId' AS track,s.version,s.submitted_version FROM confsys.submissions s JOIN confsys.users u ON u.id=s.owner_id ORDER BY s.number,s.id LIMIT $1 OFFSET $2",
        [pageSize + 1, offset],
      )
    ).rows;
    values = rows.map((r) => [
      r.id,
      r.number,
      r.state,
      r.email,
      r.title,
      r.track,
      r.version,
      r.submitted_version,
    ]);
  } else {
    headers = ["user_id", "email"];
    const rows = (
      await db.query(
        "SELECT u.id,u.email FROM confsys.users u WHERE u.state='active' AND u.verified_at IS NOT NULL ORDER BY u.id LIMIT $1 OFFSET $2",
        [pageSize + 1, offset],
      )
    ).rows;
    values = rows.map((r) => [r.id, r.email]);
  }
  return {
    filename: `${kind}-${offset + 1}-${offset + Math.min(values.length, pageSize)}.csv`,
    csv: csvDocument(headers, values.slice(0, pageSize)),
    rows: Math.min(values.length, pageSize),
    nextOffset: values.length > pageSize ? offset + pageSize : null,
  };
}
export async function preview(db: PoolClient, userId: string, email: string) {
  const registrations = (
    await db.query(
      'SELECT id,number::text,state,badge_name AS "badgeName" FROM confsys.registrations WHERE user_id=$1 ORDER BY number LIMIT 101',
      [userId],
    )
  ).rows;
  const submissions = (
    await db.query(
      "SELECT id,number::text,state,document->>'title' AS title,version FROM confsys.submissions WHERE owner_id=$1 ORDER BY number LIMIT 101",
      [userId],
    )
  ).rows;
  const results = (
    await db.query(
      `SELECT s.id AS "submissionId",d.outcome,d.author_message AS "authorMessage",snap.author_comments AS "authorComments",p.published_at
 FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id JOIN confsys.review_publication_snapshots snap ON snap.decision_id=d.id
 WHERE s.owner_id=$1 ORDER BY s.number LIMIT 101`,
      [userId],
    )
  ).rows;
  return authorPreview.parse({
    userId,
    email,
    readOnly: true,
    registrations: registrations.slice(0, 100),
    submissions: submissions.slice(0, 100),
    results: results
      .slice(0, 100)
      .map(({ published_at, ...r }) => ({
        ...r,
        publishedAt: published_at.toISOString(),
      })),
    truncated:
      Math.max(registrations.length, submissions.length, results.length) > 100,
  });
}
