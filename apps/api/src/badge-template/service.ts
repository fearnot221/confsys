import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import {
  badgeTemplateSave,
  type Permission,
  type BadgeTemplateDocument,
} from "@confsys/contracts";
import { renderBadges } from "@confsys/documents";
import QRCode from "qrcode";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { requirePermission } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { audit } from "../onsite/repository.js";
import * as repo from "./repository.js";
async function previewPdf(document: BadgeTemplateDocument | null) {
  return renderBadges(
    [
      {
        conferenceName: "名牌模板預覽 PREVIEW",
        name: "合成參加者",
        affiliation: "合成研究機構",
        registrationNumber: "PREVIEW",
        qrPng: await QRCode.toBuffer("CONFSYS_TEMPLATE_PREVIEW_NOT_A_PASS", {
          type: "png",
          errorCorrectionLevel: "M",
          margin: 2,
          width: 256,
        }),
      },
    ],
    document,
  );
}
export function createBadgeTemplateService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    permission: Permission,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(await rolesFor(db, actor.id), permission);
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.onsite_admin','true',true),set_config('app.badge_template_admin',$2,true)",
        [actor.id, String(permission === "documents.template.manage")],
      );
      return work(db, actor.id);
    });
  return {
    get: (raw: string | undefined) =>
      authorized(raw, "onsite.read", (db) => repo.current(db)),
    save: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = badgeTemplateSave.parse(input);
      return authorized(raw, "documents.template.manage", async (db, actor) => {
        await repo.lock(db);
        const before = await repo.current(db);
        if (before.version !== data.expectedVersion)
          throw new AuthError("CONFLICT");
        try {
          await previewPdf(data.document);
        } catch {
          throw new AuthError("INVALID_REQUEST");
        }
        await repo.save(db, actor, before.version + 1, data.document);
        await audit(
          db,
          actor,
          String(before.version + 1),
          "document.template.saved",
          "Updated bounded badge template",
          requestId,
        );
        return repo.current(db);
      });
    },
    preview: (raw: string | undefined) =>
      authorized(raw, "onsite.read", async (db) => {
        const template = await repo.current(db);
        return previewPdf(template.document);
      }),
  };
}
