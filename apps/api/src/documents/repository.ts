import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  receiptSchema,
  receiptSnapshotSchema,
  type ReceiptSnapshot,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";

type ReceiptRow = {
  id: string;
  order_id: string;
  state: "issued" | "void";
  current_revision: number;
  snapshot: unknown;
  void_reason: string | null;
  reissue_of: string | null;
  reissue_reason: string | null;
  source_number: string | null;
  successor_id: string | null;
  successor_number: string | null;
};
const projection = `r.id,r.order_id,r.state,r.current_revision,v.snapshot,x.reason AS void_reason,r.reissue_of,r.reissue_reason,source.number::text AS source_number,successor.id AS successor_id,successor.number::text AS successor_number`;
const joins = `FROM confsys.receipts r JOIN confsys.receipt_revisions v ON v.receipt_id=r.id AND v.revision=r.current_revision LEFT JOIN confsys.receipt_voids x ON x.receipt_id=r.id LEFT JOIN confsys.receipts source ON source.id=r.reissue_of LEFT JOIN confsys.receipts successor ON successor.reissue_of=r.id`;
function project(row: ReceiptRow) {
  return receiptSchema.parse({
    id: row.id,
    orderId: row.order_id,
    state: row.state,
    currentRevision: row.current_revision,
    snapshot: row.snapshot,
    voidReason: row.void_reason,
    reissuedFrom: row.reissue_of
      ? {
          id: row.reissue_of,
          number: `R-${row.source_number!.padStart(8, "0")}`,
        }
      : null,
    replacedBy: row.successor_id
      ? {
          id: row.successor_id,
          number: `R-${row.successor_number!.padStart(8, "0")}`,
        }
      : null,
    reissueReason: row.reissue_reason,
  });
}
export async function findReceipt(db: PoolClient, id: string) {
  const row = (
    await db.query<ReceiptRow>(`SELECT ${projection} ${joins} WHERE r.id=$1`, [
      id,
    ])
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return project(row);
}
export async function receiptForOrder(db: PoolClient, orderId: string) {
  const row = (
    await db.query<ReceiptRow>(
      `SELECT ${projection} ${joins} WHERE r.order_id=$1 ORDER BY r.number DESC LIMIT 1`,
      [orderId],
    )
  ).rows[0];
  return row ? project(row) : null;
}
export async function listReceipts(
  db: PoolClient,
  actorId: string,
  offset: number,
  administrative: boolean,
) {
  const rows = (
    await db.query<ReceiptRow>(
      `SELECT ${projection} ${joins} JOIN confsys.orders o ON o.id=r.order_id WHERE ($1 OR o.user_id=$2) ORDER BY r.number DESC LIMIT 21 OFFSET $3`,
      [administrative, actorId, offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map(project),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function receiptOrder(db: PoolClient, id: string) {
  const row = (
    await db.query<{
      id: string;
      user_id: string;
      state: string;
      amount: string;
      currency: string;
      registration_number: string;
      badge_name: string;
    }>(
      `SELECT o.id,o.user_id,o.state,o.amount::text,o.currency,r.number::text AS registration_number,r.badge_name FROM confsys.orders o JOIN confsys.registrations r ON r.id=o.registration_id WHERE o.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return row;
}
export async function paidBalance(db: PoolClient, orderId: string) {
  const row = (
    await db.query<{ paid: string; refunded: string }>(
      `SELECT coalesce((SELECT sum(a.amount) FROM confsys.payment_allocations a JOIN confsys.payments p ON p.id=a.payment_id WHERE a.order_id=$1 AND p.state='verified'),0)::text AS paid,coalesce((SELECT sum(f.amount) FROM confsys.refunds f JOIN confsys.payment_allocations a ON a.id=f.allocation_id WHERE a.order_id=$1),0)::text AS refunded`,
      [orderId],
    )
  ).rows[0]!;
  return BigInt(row.paid) - BigInt(row.refunded);
}
export async function orderItems(db: PoolClient, orderId: string) {
  return (
    await db.query<{ description: string; amount: string }>(
      "SELECT description,amount::text FROM confsys.order_items WHERE order_id=$1 ORDER BY id",
      [orderId],
    )
  ).rows;
}
export async function createReceipt(
  db: PoolClient,
  orderId: string,
  reissue?: { sourceId: string; reason: string },
) {
  const id = randomUUID();
  const row = (
    await db.query<{ number: string }>(
      "INSERT INTO confsys.receipts(id,order_id,state,current_revision,reissue_of,reissue_reason) VALUES($1,$2,'issued',1,$3,$4) RETURNING number::text",
      [id, orderId, reissue?.sourceId ?? null, reissue?.reason ?? null],
    )
  ).rows[0]!;
  return { id, number: `R-${row.number.padStart(8, "0")}` };
}
export async function appendRevision(
  db: PoolClient,
  receiptId: string,
  snapshot: ReceiptSnapshot,
  reason: string,
  actor: string,
) {
  await db.query(
    "INSERT INTO confsys.receipt_revisions(id,receipt_id,revision,snapshot,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), receiptId, snapshot.revision, snapshot, reason, actor],
  );
  await db.query(
    "UPDATE confsys.receipts SET current_revision=$2 WHERE id=$1",
    [receiptId, snapshot.revision],
  );
}
export async function voidReceipt(
  db: PoolClient,
  id: string,
  reason: string,
  actor: string,
) {
  await db.query(
    "INSERT INTO confsys.receipt_voids(receipt_id,reason,actor_id) VALUES($1,$2,$3)",
    [id, reason, actor],
  );
  await db.query("UPDATE confsys.receipts SET state='void' WHERE id=$1", [id]);
}
export async function receiptHistory(db: PoolClient, id: string) {
  const rows = (
    await db.query<{
      revision: number;
      snapshot: unknown;
      reason: string;
      created_at: Date;
    }>(
      "SELECT revision,snapshot,reason,created_at FROM confsys.receipt_revisions WHERE receipt_id=$1 ORDER BY revision DESC LIMIT 100",
      [id],
    )
  ).rows;
  return {
    items: rows.map((row) => ({
      revision: row.revision,
      snapshot: receiptSnapshotSchema.parse(row.snapshot),
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    })),
  };
}
export async function historicalSnapshot(
  db: PoolClient,
  id: string,
  revision: number,
) {
  const row = (
    await db.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM confsys.receipt_revisions WHERE receipt_id=$1 AND revision=$2",
      [id, revision],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return receiptSnapshotSchema.parse(row.snapshot);
}
export async function auditReceipt(
  db: PoolClient,
  actorId: string,
  id: string,
  event: string,
  reason: string,
  requestId: string,
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session',$4,$5,$6)",
    [randomUUID(), event, actorId, reason, { receiptId: id }, requestId],
  );
}
