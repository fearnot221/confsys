import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { withIdentityTransaction } from "@confsys/db";
import {
  receiptIssueInput,
  receiptCorrectInput,
  receiptVoidInput,
  receiptSnapshotSchema,
  type ReceiptSnapshot,
} from "@confsys/contracts";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { permissionsFor, requirePermission } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import * as repo from "./repository.js";
import { renderReceipt } from "./pdf.js";

export function createReceiptsService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    administrative: boolean,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true),
        roles = await rolesFor(db, actor.id);
      if (administrative) requirePermission(roles, "finance.receipt");
      const manage = permissionsFor(roles).some((p) => p === "finance.receipt");
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin',$2,true)",
        [actor.id, String(manage)],
      );
      return work(db, actor.id);
    });
  const financeLock = (db: PoolClient) =>
    db.query("SELECT singleton FROM confsys.registration_state FOR UPDATE");
  return {
    list(raw: string | undefined, offset: number, administrative = false) {
      return authorized(raw, administrative, (db, actor) =>
        repo.listReceipts(db, actor, offset, administrative),
      );
    },
    issue(raw: string | undefined, input: unknown, requestId: string) {
      const data = receiptIssueInput.parse(input);
      return authorized(raw, true, async (db, actor) => {
        await financeLock(db);
        const order = await repo.receiptOrder(db, data.orderId),
          existing = await repo.receiptForOrder(db, data.orderId);
        if (existing) {
          if (
            existing.state !== "issued" ||
            existing.snapshot.buyerName !== data.buyerName ||
            existing.snapshot.buyerTaxId !== data.buyerTaxId ||
            existing.snapshot.buyerAddress !== data.buyerAddress
          )
            throw new AuthError("CONFLICT");
          return existing;
        }
        if (
          order.state !== "open" ||
          (await repo.paidBalance(db, order.id)) < BigInt(order.amount)
        )
          throw new AuthError("CONFLICT");
        const created = await repo.createReceipt(db, order.id),
          brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        const snapshot: ReceiptSnapshot = receiptSnapshotSchema.parse({
          schemaVersion: 1,
          conferenceName: brand.conferenceName,
          number: created.number,
          revision: 1,
          issuedAt: new Date().toISOString(),
          registrationNumber: order.registration_number,
          attendeeName: order.badge_name,
          amount: order.amount,
          currency: order.currency,
          items: await repo.orderItems(db, order.id),
          buyerName: data.buyerName,
          buyerTaxId: data.buyerTaxId,
          buyerAddress: data.buyerAddress,
        });
        await repo.appendRevision(db, created.id, snapshot, data.reason, actor);
        await repo.auditReceipt(
          db,
          actor,
          created.id,
          "receipt.issued",
          data.reason,
          requestId,
        );
        await enqueueBusinessNotification(
          db,
          { CONFERENCE_NAME: snapshot.conferenceName },
          {
            userId: order.user_id,
            eventKey: `receipt:${created.id}:issued`,
            subject: "收據已發行",
            text: `收據 ${created.number} 已發行。請登入 ${config.PUBLIC_APP_ORIGIN}/receipts 查看。`,
            requestId,
          },
        );
        return repo.findReceipt(db, created.id);
      });
    },
    correct(raw: string | undefined, input: unknown, requestId: string) {
      const data = receiptCorrectInput.parse(input);
      return authorized(raw, true, async (db, actor) => {
        await financeLock(db);
        const current = await repo.findReceipt(db, data.receiptId);
        if (
          current.state !== "issued" ||
          current.currentRevision !== data.expectedRevision ||
          current.currentRevision >= 100
        )
          throw new AuthError("CONFLICT");
        const snapshot: ReceiptSnapshot = {
          ...current.snapshot,
          revision: current.currentRevision + 1,
          buyerName: data.buyerName,
          buyerTaxId: data.buyerTaxId,
          buyerAddress: data.buyerAddress,
        };
        await repo.appendRevision(db, current.id, snapshot, data.reason, actor);
        await repo.auditReceipt(
          db,
          actor,
          current.id,
          "receipt.corrected",
          data.reason,
          requestId,
        );
        const order = await repo.receiptOrder(db, current.orderId);
        await enqueueBusinessNotification(
          db,
          { CONFERENCE_NAME: snapshot.conferenceName },
          {
            userId: order.user_id,
            eventKey: `receipt:${current.id}:revision:${snapshot.revision}`,
            subject: "收據資料已更正",
            text: `收據 ${snapshot.number} 已建立第 ${snapshot.revision} 版。請登入 ${config.PUBLIC_APP_ORIGIN}/receipts 查看。`,
            requestId,
          },
        );
        return repo.findReceipt(db, current.id);
      });
    },
    void(raw: string | undefined, input: unknown, requestId: string) {
      const data = receiptVoidInput.parse(input);
      return authorized(raw, true, async (db, actor) => {
        await financeLock(db);
        const current = await repo.findReceipt(db, data.receiptId);
        if (current.currentRevision !== data.expectedRevision)
          throw new AuthError("CONFLICT");
        if (current.state === "void") {
          if (current.voidReason === data.reason) return current;
          throw new AuthError("CONFLICT");
        }
        await repo.voidReceipt(db, current.id, data.reason, actor);
        await repo.auditReceipt(
          db,
          actor,
          current.id,
          "receipt.voided",
          data.reason,
          requestId,
        );
        const order = await repo.receiptOrder(db, current.orderId);
        await enqueueBusinessNotification(
          db,
          { CONFERENCE_NAME: current.snapshot.conferenceName },
          {
            userId: order.user_id,
            eventKey: `receipt:${current.id}:void`,
            subject: "收據已作廢",
            text: `收據 ${current.snapshot.number} 已作廢。作廢不代表已退款；請登入 ${config.PUBLIC_APP_ORIGIN}/receipts 查看。`,
            requestId,
          },
        );
        return repo.findReceipt(db, current.id);
      });
    },
    history(raw: string | undefined, id: string) {
      return authorized(raw, false, async (db) => {
        await repo.findReceipt(db, id);
        return repo.receiptHistory(db, id);
      });
    },
    async download(
      raw: string | undefined,
      id: string,
      revision: number,
      requestId: string,
    ) {
      const data = await authorized(raw, false, async (db) => ({
        receipt: await repo.findReceipt(db, id),
        snapshot: await repo.historicalSnapshot(db, id, revision),
      }));
      const bytes = await renderReceipt(data.snapshot, data.receipt.state);
      return authorized(raw, false, async (db, actor) => {
        const current = await repo.findReceipt(db, id);
        // Concurrent voiding must not return an unmarked receipt prepared before it.
        if (current.state !== data.receipt.state)
          throw new AuthError("CONFLICT");
        await repo.auditReceipt(
          db,
          actor,
          id,
          "receipt.downloaded",
          `Download revision ${revision}`,
          requestId,
        );
        return {
          bytes,
          name: `receipt-${data.snapshot.number}-v${revision}.pdf`,
        };
      });
    },
  };
}
