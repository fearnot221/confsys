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
    "SELECT set_config('app.actor_id',$1,true),set_config('app.registration_admin',$2,true),set_config('app.submissions_admin',$2,true),set_config('app.reviews_manage',$2,true),set_config('app.reporting_admin',$2,true)",
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
    items: rows.slice(0, 20).map((r) => ({
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
  await db.query(
    "SELECT set_config('app.finance_admin','true',true),set_config('app.onsite_admin','true',true),set_config('app.competitions_manage','true',true)",
  );
  // One statement has one MVCC snapshot across domains; no totals assembled from
  // unrelated timestamps. Currency totals remain exact text minor units.
  const row = (
    await db.query(`WITH group_payment_summary AS (
 SELECT p.id,p.payer_id,p.state,p.currency,p.amount,
 sum(a.amount) AS allocated,
 sum(coalesce((SELECT sum(r.amount) FROM confsys.refunds r WHERE r.allocation_id=a.id),0)) AS refunded
 FROM confsys.payments p JOIN confsys.payment_allocations a ON a.payment_id=p.id JOIN confsys.orders o ON o.id=a.order_id
 GROUP BY p.id,p.payer_id,p.state,p.currency,p.amount HAVING count(DISTINCT o.user_id)>=2
 ) SELECT statement_timestamp() AS as_of,
 (SELECT jsonb_build_object('draft',draft,'published',published) FROM confsys.reporting_program_totals) AS program,
 (SELECT published_at FROM confsys.reporting_program_totals) AS program_published_at,
 (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
 SELECT s.state,s.currency,count(*)::integer AS payments,count(DISTINCT s.payer_id)::integer AS payers,
 (SELECT count(DISTINCT o.user_id)::integer FROM confsys.payment_allocations a JOIN confsys.orders o ON o.id=a.order_id WHERE a.payment_id IN(SELECT id FROM group_payment_summary g WHERE g.state=s.state AND g.currency=s.currency)) AS participants,
 sum(s.amount)::text AS "declaredAmount",sum(s.allocated)::text AS "allocatedAmount",sum(s.refunded)::text AS "refundedAmount"
 FROM group_payment_summary s GROUP BY s.state,s.currency ORDER BY s.currency,s.state)x) AS "groupPayments",
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,count(*)::integer AS count FROM confsys.registrations GROUP BY state ORDER BY state)x) AS registrations,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,count(*)::integer AS count FROM confsys.submissions GROUP BY state ORDER BY state)x) AS submissions,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,count(*)::integer AS count FROM confsys.review_assignments GROUP BY state ORDER BY state)x) AS reviews,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,currency,count(*)::integer AS count,sum(amount)::text AS amount FROM confsys.orders GROUP BY state,currency ORDER BY currency,state)x) AS orders,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*)::integer AS count FROM confsys.registrations GROUP BY date ORDER BY date)x) AS "registrationDates",
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT ticket_id AS "ticketId",ticket_name AS "ticketName",state,count(*)::integer AS count FROM confsys.registrations GROUP BY ticket_id,ticket_name,state ORDER BY ticket_id,ticket_name,state)x) AS tickets,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,currency,count(*)::integer AS count,sum(amount)::text AS amount FROM confsys.payments GROUP BY state,currency ORDER BY currency,state)x) AS payments,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT p.currency,count(*)::integer AS count,sum(a.amount)::text AS amount FROM confsys.payment_allocations a JOIN confsys.payments p ON p.id=a.payment_id GROUP BY p.currency ORDER BY p.currency)x) AS allocations,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT p.currency,count(*)::integer AS count,sum(r.amount)::text AS amount FROM confsys.refunds r JOIN confsys.payment_allocations a ON a.id=r.allocation_id JOIN confsys.payments p ON p.id=a.payment_id GROUP BY p.currency ORDER BY p.currency)x) AS refunds,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT b.activity_id AS "activityId",b.state,count(*)::integer AS bookings,sum(b.quantity)::integer AS quantity,sum(coalesce((SELECT sum(r.quantity) FROM confsys.onsite_redemptions r WHERE r.booking_id=b.id AND r.active),0))::integer AS "redeemedQuantity" FROM confsys.activity_bookings b GROUP BY b.activity_id,b.state ORDER BY b.activity_id,b.state)x) AS activities,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT CASE WHEN active THEN 'active' ELSE 'reversed' END AS state,count(*)::integer AS count FROM confsys.onsite_checkins GROUP BY active ORDER BY active)x) AS checkins,
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,count(*)::integer AS count FROM confsys.competition_entries GROUP BY state ORDER BY state)x) AS "competitionEntries",
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT state,count(*)::integer AS count FROM confsys.competition_assignments GROUP BY state ORDER BY state)x) AS "competitionAssignments",
  (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT status AS state,count FROM confsys.reporting_notification_totals ORDER BY status)x) AS notifications
 `)
  ).rows[0];
  const { as_of, program_published_at, program, ...totals } = row;
  return reportingStats.parse({
    ...totals,
    program: {
      ...program,
      publishedAt: program_published_at?.toISOString() ?? null,
    },
    asOf: as_of.toISOString(),
    timezone: "UTC",
  });
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
    results: results.slice(0, 100).map(({ published_at, ...r }) => ({
      ...r,
      publishedAt: published_at.toISOString(),
    })),
    truncated:
      Math.max(registrations.length, submissions.length, results.length) > 100,
  });
}
